import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { createFileRoute } from "@tanstack/react-router";
import { button, useControls } from "leva";
import { useEffect, useMemo, useRef, useState } from "react";
import { DoubleSide, SRGBColorSpace, type Texture, TextureLoader } from "three";
import { BuildSystem } from "../layered-shuffle/build-system";
import { compilePlan } from "../layered-shuffle/compiled-plan";
import { DEFAULT_CONFIG, type ShuffleConfig } from "../layered-shuffle/types";
import { ConnectionLines } from "../render/ConnectionLines";
import { SegmentMeshes } from "../render/SegmentMeshes";
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

	const animation = useControls("Animation", {
		flightDuration: { value: 0.6, min: 0.1, max: 3, step: 0.1 },
		holdDuration: { value: 0.3, min: 0, max: 2, step: 0.1 },
	});

	const layers = useControls("Layers", {
		maxGenerations: { value: 10, min: 1, max: 20, step: 1 },
		layerSpacing: { value: 1.0, min: 0.1, max: 4, step: 0.1 },
	});

	const collapse = useControls("Collapse", {
		collapseDuration: { value: 0.1, min: 0.05, max: 3, step: 0.05 },
		collapseStagger: { value: 0.08, min: 0, max: 2, step: 0.01 },
		holdAfterComplete: { value: 1.0, min: 0, max: 5, step: 0.1 },
	});

	useControls("Actions", {
		Reset: button(() => {
			resetTriggerRef.current += 1;
			setResetTrigger(resetTriggerRef.current);
		}),
	});

	return { ...opacity, ...animation, ...layers, ...collapse, resetTrigger };
}

// ─── KimonoBackground ───────────────────────────────────────────────────────

function KimonoBackground({
	texture,
	opacity,
}: { texture: Texture | null; opacity: number }) {
	if (!texture) return null;

	const halfHeight = KIMONO_SIZE / 2;
	const yOffset = halfHeight / 2;

	return (
		<mesh
			position={[0, yOffset, -0.1]}
			renderOrder={0}
			onUpdate={(mesh) => {
				const uv = mesh.geometry.getAttribute("uv");
				if (uv && !(uv as any).__halfAdjusted) {
					for (let i = 0; i < uv.count; i++) {
						const v = uv.getY(i);
						uv.setY(i, 0.5 + v * 0.5);
					}
					uv.needsUpdate = true;
					(uv as any).__halfAdjusted = true;
				}
			}}
		>
			<planeGeometry args={[KIMONO_SIZE, halfHeight]} />
			<meshBasicMaterial
				map={texture}
				side={DoubleSide}
				transparent
				opacity={opacity}
				depthWrite={false}
			/>
		</mesh>
	);
}

// ─── ShuffleContent ─────────────────────────────────────────────────────────

type ShuffleContentProps = {
	segments: SegmentInfo[];
	atlasTexture: Texture;
	config: ShuffleConfig;
	resetTrigger: number;
};

function ShuffleContent({
	segments,
	atlasTexture,
	config,
	resetTrigger,
}: ShuffleContentProps) {
	const systemRef = useRef<BuildSystem | null>(null);
	const lastResetRef = useRef(0);

	// Initialize or reset the build system
	if (!systemRef.current) {
		const plan = compilePlan(segments, config);
		systemRef.current = new BuildSystem(plan, config);
	}

	// Handle reset
	if (resetTrigger !== lastResetRef.current) {
		lastResetRef.current = resetTrigger;
		const plan = compilePlan(segments, config);
		systemRef.current = new BuildSystem(plan, config);
	}

	const system = systemRef.current;

	return (
		<>
			<CameraAndLifecycle
				buildSystem={system}
				segments={segments}
				config={config}
			/>
			<SegmentMeshes
				segments={segments}
				atlasTexture={atlasTexture}
				buildSystem={system}
			/>
			<ConnectionLines buildSystem={system} />
		</>
	);
}

/** Handles idle→restart loop (camera is fixed at initial oblique view) */
function CameraAndLifecycle({
	buildSystem,
	segments,
	config,
}: {
	buildSystem: BuildSystem;
	segments: SegmentInfo[];
	config: ShuffleConfig;
}) {
	useFrame(() => {
		// Handle idle → restart loop
		if (buildSystem.state.phase === "idle") {
			const plan = compilePlan(segments, config);
			buildSystem.reset(plan);
		}
	});
	return null;
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
					`${SAKURA_BASE_PATH}/kimono_bg_inv.png`,
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
			flightDuration: gui.flightDuration ?? DEFAULT_CONFIG.flightDuration,
			holdDuration: gui.holdDuration ?? DEFAULT_CONFIG.holdDuration,
			layerSpacing: gui.layerSpacing ?? DEFAULT_CONFIG.layerSpacing,
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
			{/* <KimonoBackground texture={kimonoTexture} opacity={gui.bgOpacity} /> */}
			{atlasTexture && (
				<ShuffleContent
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
		<div className="h-100vh min-h-[520px]">
			<Canvas
				camera={{ fov: 35, position: [3, 3.3, 7], near: 0.1, far: 100 }}
			>
				<color attach="background" args={["black"]} />
				<OrbitControls target={[0, 0.4, 5]} />
				<Scene />
			</Canvas>
		</div>
	);
}
