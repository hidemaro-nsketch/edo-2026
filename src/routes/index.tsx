import { Canvas, useFrame } from "@react-three/fiber";
import { createFileRoute } from "@tanstack/react-router";
import { button, useControls } from "leva";
import { useEffect, useMemo, useRef, useState } from "react";
import { DoubleSide, SRGBColorSpace, type Texture, TextureLoader } from "three";
import { LayerStack } from "../layered-shuffle/layer-stack";
import {
	DEFAULT_CONFIG,
	type LayerState,
	type ShuffleConfig,
} from "../layered-shuffle/types";
import { CameraRig } from "../render/CameraRig";
import { ConnectionLines } from "../render/ConnectionLines";
import { LayerMesh } from "../render/LayerMesh";
import { KIMONO_SIZE } from "../sakura/constants";
import { loadAtlasTextures } from "../sakura/segment-manager";
import type { SegmentInfo, SegmentManifest } from "../sakura/types";

export const Route = createFileRoute("/")({ component: App });

// ─── Constants ──────────────────────────────────────────────────────────────

const SAKURA_BASE_PATH = "/sakura";

// ─── Manifest loader ────────────────────────────────────────────────────────

async function loadManifest(): Promise<SegmentManifest | null> {
	try {
		const res = await fetch(`${SAKURA_BASE_PATH}/segments.manifest.json`);
		if (!res.ok) return null;
		return (await res.json()) as SegmentManifest;
	} catch {
		return null;
	}
}

// ─── Debug GUI ──────────────────────────────────────────────────────────────

type DebugGuiResult = ShuffleConfig & {
	bgOpacity: number;
	resetTrigger: number;
};

function useDebugGui(): DebugGuiResult {
	const resetTriggerRef = useRef(0);
	const [resetTrigger, setResetTrigger] = useState(0);

	const opacity = useControls("Opacity", {
		bgOpacity: { value: 1.0, min: 0, max: 1, step: 0.01 },
	});

	const generation = useControls("Generation", {
		shuffleDuration: { value: 2.0, min: 0.5, max: 10, step: 0.5 },
		switchIntervalMin: { value: 0.2, min: 0.05, max: 2, step: 0.05 },
		switchIntervalMax: { value: 0.5, min: 0.05, max: 2, step: 0.05 },
		fadeDuration: { value: 0.6, min: 0.1, max: 3, step: 0.1 },
	});

	const layers = useControls("Layers", {
		maxGenerations: { value: 10, min: 1, max: 20, step: 1 },
		layerSpacing: { value: 0.5, min: 0.1, max: 2, step: 0.1 },
		cameraRevealGen: { value: 5, min: 1, max: 10, step: 1 },
	});

	const collapse = useControls("Collapse", {
		collapseDuration: { value: 0.5, min: 0.1, max: 3, step: 0.1 },
		collapseStagger: { value: 0.3, min: 0, max: 2, step: 0.05 },
		holdAfterComplete: { value: 1.0, min: 0, max: 5, step: 0.1 },
	});

	useControls("Actions", {
		Reset: button(() => {
			resetTriggerRef.current += 1;
			setResetTrigger(resetTriggerRef.current);
		}),
	});

	return { ...opacity, ...generation, ...layers, ...collapse, resetTrigger };
}

// ─── Timing refs type ───────────────────────────────────────────────────────

type TimingRefs = {
	genStartTime: React.RefObject<number>;
	nextSwitchTime: React.RefObject<number>;
	holdStart: React.RefObject<number>;
};

function resetTimingRefs(refs: TimingRefs): void {
	refs.genStartTime.current = -1;
	refs.nextSwitchTime.current = -1;
	refs.holdStart.current = -1;
}

// ─── Phase handlers ─────────────────────────────────────────────────────────

function handleHolding(
	stack: LayerStack,
	now: number,
	config: ShuffleConfig,
	refs: TimingRefs,
	sync: (stack: LayerStack) => void,
): void {
	if (refs.holdStart.current < 0) {
		refs.holdStart.current = now;
	}
	if (now - refs.holdStart.current < config.holdAfterComplete) return;

	stack.reset();
	stack.initOriginalLayer();
	resetTimingRefs(refs);
	sync(stack);
}

function handleCollapsing(
	stack: LayerStack,
	delta: number,
	syncLayers: (layers: LayerState[]) => void,
): void {
	stack.updateCollapse(delta);
	syncLayers([...stack.getAliveLayers()]);
}

function handleFrozen(
	stack: LayerStack,
	now: number,
	config: ShuffleConfig,
	refs: TimingRefs,
	syncLayers: (layers: LayerState[]) => void,
	syncGen: (gen: number) => void,
): void {
	if (stack.isComplete()) {
		stack.startCollapse();
		syncLayers([...stack.getAliveLayers()]);
		return;
	}

	stack.startGeneration();
	refs.genStartTime.current = now;
	refs.nextSwitchTime.current = now + config.switchIntervalMin;
	syncGen(stack.currentGen);
	syncLayers([...stack.getAliveLayers()]);
}

function handleShuffling(
	stack: LayerStack,
	now: number,
	segments: SegmentInfo[],
	config: ShuffleConfig,
	refs: TimingRefs,
	syncLayers: (layers: LayerState[]) => void,
	syncGen: (gen: number) => void,
	bumpVersion: () => void,
): void {
	const elapsed = now - refs.genStartTime.current;

	if (elapsed >= config.shuffleDuration) {
		stack.freezeGeneration();
		syncLayers([...stack.getAliveLayers()]);
		syncGen(stack.currentGen);
		return;
	}

	if (now < refs.nextSwitchTime.current) return;

	const slotIdx = Math.floor(Math.random() * segments.length);
	const prevLayer = stack.layers[stack.layers.length - 1];
	let nextSegId: number;
	do {
		nextSegId = Math.floor(Math.random() * segments.length);
	} while (
		nextSegId === prevLayer.slotToSegId[slotIdx] &&
		segments.length > 1
	);

	stack.applyShuffle(slotIdx, nextSegId);

	refs.nextSwitchTime.current =
		now +
		config.switchIntervalMin +
		Math.random() * (config.switchIntervalMax - config.switchIntervalMin);

	bumpVersion();
}

// ─── Layered Shuffle Hook ───────────────────────────────────────────────────

type UseLayeredShuffleResult = {
	renderLayers: LayerState[];
	currentGen: number;
};

function useLayeredShuffle(
	segments: SegmentInfo[],
	config: ShuffleConfig,
	resetTrigger: number,
): UseLayeredShuffleResult {
	const stackRef = useRef<LayerStack | null>(null);
	const [aliveLayers, setAliveLayers] = useState<LayerState[]>([]);
	const [currentGen, setCurrentGen] = useState(0);
	const [shuffleVersion, setShuffleVersion] = useState(0);

	const genStartTimeRef = useRef(-1);
	const nextSwitchTimeRef = useRef(-1);
	const lastResetRef = useRef(0);
	const holdStartRef = useRef(-1);

	const timingRefs: TimingRefs = {
		genStartTime: genStartTimeRef,
		nextSwitchTime: nextSwitchTimeRef,
		holdStart: holdStartRef,
	};

	if (!stackRef.current) {
		stackRef.current = new LayerStack(segments.length, config);
		stackRef.current.initOriginalLayer();
	}

	const syncAll = (stack: LayerStack): void => {
		setAliveLayers(stack.getAliveLayers());
		setCurrentGen(0);
	};

	useFrame((_, delta) => {
		const stack = stackRef.current;
		if (!stack) return;
		const now = performance.now() / 1000;

		if (resetTrigger !== lastResetRef.current) {
			lastResetRef.current = resetTrigger;
			const newStack = new LayerStack(segments.length, config);
			newStack.initOriginalLayer();
			stackRef.current = newStack;
			resetTimingRefs(timingRefs);
			syncAll(newStack);
			return;
		}

		switch (stack.phase) {
			case "holding":
				handleHolding(stack, now, config, timingRefs, syncAll);
				return;
			case "collapsing":
				handleCollapsing(stack, delta, setAliveLayers);
				return;
			case "frozen":
				handleFrozen(
					stack,
					now,
					config,
					timingRefs,
					setAliveLayers,
					setCurrentGen,
				);
				return;
			case "shuffling":
				handleShuffling(
					stack,
					now,
					segments,
					config,
					timingRefs,
					setAliveLayers,
					setCurrentGen,
					() => setShuffleVersion((v) => v + 1),
				);
				return;
		}
	});

	const renderLayers = useMemo(() => {
		const stack = stackRef.current;
		if (!stack) return aliveLayers;

		if (stack.phase === "shuffling") {
			const pendingMapping = stack.getPendingSlotToSegId();
			if (pendingMapping.length > 0) {
				const liveLayer: LayerState = {
					gen: stack.currentGen,
					z: stack.currentGen * config.layerSpacing,
					alive: true,
					opacity: 1,
					slotToSegId: pendingMapping,
					changedSlots: [],
					linksFromPrev: [],
				};
				return [...aliveLayers, liveLayer];
			}
		}

		return aliveLayers;
		// shuffleVersion is needed to recompute live layer during shuffling
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [aliveLayers, config.layerSpacing, shuffleVersion]);

	return { renderLayers, currentGen };
}

// ─── KimonoBackground ───────────────────────────────────────────────────────

function KimonoBackground({
	texture,
	opacity,
}: { texture: Texture | null; opacity: number }) {
	if (!texture) return null;

	return (
		<mesh position={[0, 0, -0.1]}>
			<planeGeometry args={[KIMONO_SIZE, KIMONO_SIZE]} />
			<meshBasicMaterial
				map={texture}
				side={DoubleSide}
				transparent
				opacity={opacity}
			/>
		</mesh>
	);
}

// ─── LayeredShuffleContent ──────────────────────────────────────────────────

type LayeredShuffleContentProps = {
	segments: SegmentInfo[];
	atlasTexture: Texture;
	config: ShuffleConfig;
	resetTrigger: number;
};

function LayeredShuffleContent({
	segments,
	atlasTexture,
	config,
	resetTrigger,
}: LayeredShuffleContentProps) {
	const { renderLayers, currentGen } = useLayeredShuffle(
		segments,
		config,
		resetTrigger,
	);

	return (
		<>
			<CameraRig
				currentGen={currentGen}
				maxGenerations={config.maxGenerations}
				cameraRevealGen={config.cameraRevealGen}
				layerSpacing={config.layerSpacing}
			/>
			{renderLayers.map((layer) => (
				<LayerMesh
					key={layer.gen}
					layer={layer}
					segments={segments}
					atlasTexture={atlasTexture}
				/>
			))}
			<ConnectionLines
				layers={renderLayers}
				segments={segments}
				layerSpacing={config.layerSpacing}
			/>
		</>
	);
}

// ─── Scene ──────────────────────────────────────────────────────────────────

function Scene() {
	const [segments, setSegments] = useState<SegmentInfo[]>([]);
	const [atlasTexture, setAtlasTexture] = useState<Texture | null>(null);
	const [kimonoTexture, setKimonoTexture] = useState<Texture | null>(null);
	const gui = useDebugGui();

	useEffect(() => {
		let disposed = false;
		const textures: Texture[] = [];

		async function init() {
			const manifest = await loadManifest();
			if (!manifest || disposed) return;

			setSegments(manifest.segments);

			try {
				const loaded = await loadAtlasTextures(
					manifest,
					`${SAKURA_BASE_PATH}/atlas`,
				);
				if (disposed) return;
				textures.push(...loaded);
				if (loaded.length > 0) {
					setAtlasTexture(loaded[0]);
				}
			} catch (err) {
				console.warn("Atlas loading failed:", err);
			}

			try {
				const loader = new TextureLoader();
				const bgTex = await loader.loadAsync(
					`${SAKURA_BASE_PATH}/kimono_bg.png`,
				);
				if (disposed) return;
				bgTex.colorSpace = SRGBColorSpace;
				textures.push(bgTex);
				setKimonoTexture(bgTex);
			} catch (err) {
				console.warn("Kimono background loading failed:", err);
			}

			if (!disposed) {
				console.log(
					`Loaded: ${manifest.segments.length} segments, kimono background`,
				);
			}
		}

		init();

		return () => {
			disposed = true;
			for (const tex of textures) {
				tex.dispose();
			}
		};
	}, []);

	const config: ShuffleConfig = useMemo(
		() => ({
			maxGenerations:
				gui.maxGenerations ?? DEFAULT_CONFIG.maxGenerations,
			shuffleDuration: gui.shuffleDuration,
			switchIntervalMin: gui.switchIntervalMin,
			switchIntervalMax: gui.switchIntervalMax,
			fadeDuration: gui.fadeDuration,
			layerSpacing: gui.layerSpacing ?? DEFAULT_CONFIG.layerSpacing,
			cameraRevealGen:
				gui.cameraRevealGen ?? DEFAULT_CONFIG.cameraRevealGen,
			collapseDuration:
				gui.collapseDuration ?? DEFAULT_CONFIG.collapseDuration,
			collapseStagger:
				gui.collapseStagger ?? DEFAULT_CONFIG.collapseStagger,
			holdAfterComplete:
				gui.holdAfterComplete ?? DEFAULT_CONFIG.holdAfterComplete,
		}),
		[gui],
	);

	if (segments.length === 0) return null;

	return (
		<>
			<KimonoBackground texture={kimonoTexture} opacity={gui.bgOpacity} />
			{atlasTexture && (
				<LayeredShuffleContent
					segments={segments}
					atlasTexture={atlasTexture}
					config={config}
					resetTrigger={gui.resetTrigger}
				/>
			)}
		</>
	);
}

// ─── App ────────────────────────────────────────────────────────────────────

function App() {
	return (
		<div className="h-[calc(100vh-72px)] min-h-[520px]">
			<Canvas camera={{ position: [0, 0, 7], fov: 44 }}>
				<Scene />
			</Canvas>
		</div>
	);
}
