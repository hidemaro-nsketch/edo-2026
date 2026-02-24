import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	CustomBlending,
	DoubleSide,
	FloatType,
	InstancedBufferAttribute,
	InstancedBufferGeometry,
	type Mesh,
	NearestFilter,
	OneFactor,
	OneMinusSrcAlphaFactor,
	PlaneGeometry,
	RGBAFormat,
	SRGBColorSpace,
	type Texture,
	TextureLoader,
	DataTexture,
} from "three";
import { OrbitControls as ThreeOrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { loadAtlasTextures } from "../sakura/segment-manager";
import type { SegmentManifest, SegmentInfo } from "../sakura/types";

export const Route = createFileRoute("/")({ component: App });

// ─── Configuration ──────────────────────────────────────────────────────────

/** Visible area in world units (matches kimono background) */
const KIMONO_SIZE = 5.2;

/** Segment switching timing */
const SWITCH_INTERVAL_MIN = 0.2; // seconds between switches (minimum)
const SWITCH_INTERVAL_MAX = 0.5; // seconds between switches (maximum)
const FADE_DURATION = 0.6; // seconds for cross-fade

/** Background opacity (0.0 = invisible, 1.0 = full) */
const BG_OPACITY = 1.0;

/** Reset mode timing */
const SHUFFLE_DURATION = 5.0; // seconds of shuffling before reset
const RESET_HOLD_DURATION = 1.0; // seconds to hold reset state
const RESET_HOP_DURATION = 0.4; // seconds per hop animation
const RESET_HOP_COUNT = 2; // number of hops (last hop returns home)
const RESET_STAGGER_SPREAD = 0.4; // seconds of stagger spread across all segments

const SAKURA_BASE_PATH = "/sakura";

async function loadManifest(): Promise<SegmentManifest | null> {
	try {
		const res = await fetch(`${SAKURA_BASE_PATH}/segments.manifest.json`);
		if (!res.ok) return null;
		return (await res.json()) as SegmentManifest;
	} catch {
		return null;
	}
}

// ─── Per-instance attribute layout ──────────────────────────────────────────

type InstanceData = {
	positions: Float32Array; // current display position (vec2)
	origPositions: Float32Array; // original home position (vec2)
	sizes: Float32Array; // vec2
	origSizes: Float32Array; // original home size (vec2)
	currUvRects: Float32Array; // vec4
	nextUvRects: Float32Array; // vec4
	origUvRects: Float32Array; // original UV rect (vec4)
	transitions: Float32Array; // vec2 [startTime, duration]
};

function buildInstanceData(segments: SegmentInfo[]): InstanceData {
	const count = segments.length;
	const positions = new Float32Array(count * 2);
	const origPositions = new Float32Array(count * 2);
	const sizes = new Float32Array(count * 2);
	const origSizes = new Float32Array(count * 2);
	const currUvRects = new Float32Array(count * 4);
	const nextUvRects = new Float32Array(count * 4);
	const origUvRects = new Float32Array(count * 4);
	const transitions = new Float32Array(count * 2);

	for (let i = 0; i < count; i++) {
		const seg = segments[i];

		// Position: bboxInSource center normalized to [-0.5, 0.5] then to world coords
		const cx =
			(seg.bboxInSource[0] + seg.bboxInSource[2] * 0.5) /
			seg.originalSize[0];
		const cy =
			(seg.bboxInSource[1] + seg.bboxInSource[3] * 0.5) /
			seg.originalSize[1];
		const px = (cx - 0.5) * KIMONO_SIZE;
		const py = -(cy - 0.5) * KIMONO_SIZE; // flip Y
		positions[i * 2] = px;
		positions[i * 2 + 1] = py;
		origPositions[i * 2] = px;
		origPositions[i * 2 + 1] = py;

		// Size: proportional to bbox in original image → world units
		const bboxW = seg.bboxInSource[2] / seg.originalSize[0];
		const bboxH = seg.bboxInSource[3] / seg.originalSize[1];
		const sw = bboxW * KIMONO_SIZE;
		const sh = bboxH * KIMONO_SIZE;
		sizes[i * 2] = sw;
		sizes[i * 2 + 1] = sh;
		origSizes[i * 2] = sw;
		origSizes[i * 2 + 1] = sh;

		// UV rect: start showing own segment
		const off = i * 4;
		currUvRects[off] = seg.uvRect[0];
		currUvRects[off + 1] = seg.uvRect[1];
		currUvRects[off + 2] = seg.uvRect[2];
		currUvRects[off + 3] = seg.uvRect[3];

		nextUvRects[off] = seg.uvRect[0];
		nextUvRects[off + 1] = seg.uvRect[1];
		nextUvRects[off + 2] = seg.uvRect[2];
		nextUvRects[off + 3] = seg.uvRect[3];

		origUvRects[off] = seg.uvRect[0];
		origUvRects[off + 1] = seg.uvRect[1];
		origUvRects[off + 2] = seg.uvRect[2];
		origUvRects[off + 3] = seg.uvRect[3];

		// Transition: startTime = -999 (not active), duration
		transitions[i * 2] = -999.0;
		transitions[i * 2 + 1] = FADE_DURATION;
	}

	return {
		positions,
		origPositions,
		sizes,
		origSizes,
		currUvRects,
		nextUvRects,
		origUvRects,
		transitions,
	};
}

// ─── Instance geometry builder ──────────────────────────────────────────────

type GeometryAttrs = {
	position_attr: InstancedBufferAttribute;
	size_attr: InstancedBufferAttribute;
	currUvRect: InstancedBufferAttribute;
	nextUvRect: InstancedBufferAttribute;
	transition: InstancedBufferAttribute;
};

function buildInstanceGeometry(
	instanceData: InstanceData,
	segmentCount: number,
): {
	geometry: InstancedBufferGeometry;
	attrs: GeometryAttrs;
	origPositions: Float32Array;
	origSizes: Float32Array;
	origUvRects: Float32Array;
} {
	const base = new PlaneGeometry(1, 1);
	const geo = new InstancedBufferGeometry();
	geo.index = base.index;
	geo.attributes.position = base.attributes.position;
	geo.attributes.uv = base.attributes.uv;

	const position_attr = new InstancedBufferAttribute(
		instanceData.positions,
		2,
	);
	const size_attr = new InstancedBufferAttribute(instanceData.sizes, 2);
	const currUvRect = new InstancedBufferAttribute(
		instanceData.currUvRects,
		4,
	);
	const nextUvRect = new InstancedBufferAttribute(
		instanceData.nextUvRects,
		4,
	);
	const transition = new InstancedBufferAttribute(
		instanceData.transitions,
		2,
	);

	geo.setAttribute("aPosition", position_attr);
	geo.setAttribute("aSize", size_attr);
	geo.setAttribute("aCurrUvRect", currUvRect);
	geo.setAttribute("aNextUvRect", nextUvRect);
	geo.setAttribute("aTransition", transition);

	geo.instanceCount = segmentCount;
	return {
		geometry: geo,
		attrs: { position_attr, size_attr, currUvRect, nextUvRect, transition },
		origPositions: instanceData.origPositions,
		origSizes: instanceData.origSizes,
		origUvRects: instanceData.origUvRects,
	};
}

// ─── Shaders ────────────────────────────────────────────────────────────────

const spriteVertexShader = /* glsl */ `
precision highp float;

attribute vec2 aPosition;
attribute vec2 aSize;
attribute vec4 aCurrUvRect;
attribute vec4 aNextUvRect;
attribute vec2 aTransition; // [startTime, duration]

uniform float uTime;

varying vec2 vUv;
varying vec4 vCurrUvRect;
varying vec4 vNextUvRect;
varying float vTransitionT;

void main() {
  vUv = uv;
  vCurrUvRect = aCurrUvRect;
  vNextUvRect = aNextUvRect;

  // Compute transition progress
  float elapsed = uTime - aTransition.x;
  float duration = aTransition.y;
  vTransitionT = clamp(elapsed / duration, 0.0, 1.0);
  // Smoothstep easing
  vTransitionT = vTransitionT * vTransitionT * (3.0 - 2.0 * vTransitionT);

  // Scale quad by segment size, position at segment location
  vec3 scaled = position * vec3(aSize, 1.0);
  vec3 worldPos = scaled + vec3(aPosition, 0.0);

  gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPos, 1.0);
}
`;

const spriteFragmentShader = /* glsl */ `
precision highp float;

varying vec2 vUv;
varying vec4 vCurrUvRect;
varying vec4 vNextUvRect;
varying float vTransitionT;

uniform sampler2D uAtlas;

void main() {
  // Sample current segment from atlas
  vec2 currAtlasUv = vCurrUvRect.xy + vUv * vCurrUvRect.zw;
  vec4 currColor = texture2D(uAtlas, currAtlasUv);

  // Sample next segment from atlas
  vec2 nextAtlasUv = vNextUvRect.xy + vUv * vNextUvRect.zw;
  vec4 nextColor = texture2D(uAtlas, nextAtlasUv);

  // Cross-fade between current and next (both are premultiplied alpha)
  vec4 color = mix(currColor, nextColor, vTransitionT);

  if (color.a < 0.1) {
    discard;
  }

  // Soften edges: scale both RGB and alpha together (premultiplied)
  float edgeAlpha = smoothstep(0.1, 0.3, color.a);
  gl_FragColor = vec4(color.rgb * edgeAlpha, color.a * edgeAlpha);
}
`;

// ─── Segment Switcher Hook ──────────────────────────────────────────────────

type SwitcherState = {
	segments: SegmentInfo[];
	currentSegIds: number[]; // which segment texture each slot is currently showing
	attrs: GeometryAttrs;
	origPositions: Float32Array;
	origSizes: Float32Array;
	origUvRects: Float32Array;
};

type CycleMode = "shuffling" | "hopping" | "holding";

// Per-slot hop waypoints: array of segment IDs for each hop target
type HopPlan = {
	targets: number[][]; // hopPlan.targets[hopIndex][slotIndex] = segmentId
	startTime: number;
	staggerDelays: number[]; // per-slot random delay [0, RESET_STAGGER_SPREAD]
};

function getSegmentWorldPos(
	seg: SegmentInfo,
): [number, number] {
	const cx =
		(seg.bboxInSource[0] + seg.bboxInSource[2] * 0.5) / seg.originalSize[0];
	const cy =
		(seg.bboxInSource[1] + seg.bboxInSource[3] * 0.5) / seg.originalSize[1];
	return [(cx - 0.5) * KIMONO_SIZE, -(cy - 0.5) * KIMONO_SIZE];
}

function getSegmentWorldSize(
	seg: SegmentInfo,
): [number, number] {
	const bboxW = seg.bboxInSource[2] / seg.originalSize[0];
	const bboxH = seg.bboxInSource[3] / seg.originalSize[1];
	return [bboxW * KIMONO_SIZE, bboxH * KIMONO_SIZE];
}

function useSegmentSwitcher(switcherState: SwitcherState | null) {
	const nextSwitchTimeRef = useRef(-1);
	const pendingTransitionsRef = useRef<Set<number>>(new Set());
	const modeRef = useRef<CycleMode>("shuffling");
	const cycleStartRef = useRef(-1);
	const hopPlanRef = useRef<HopPlan | null>(null);
	const lastHopIndexRef = useRef(-1);

	useFrame(({ clock }) => {
		if (!switcherState) return;
		const { segments, currentSegIds, attrs, origPositions, origSizes, origUvRects } =
			switcherState;
		const now = clock.getElapsedTime();

		// Initialize on first frame
		if (cycleStartRef.current < 0) {
			cycleStartRef.current = now;
			nextSwitchTimeRef.current = now + SWITCH_INTERVAL_MIN;
			return;
		}

		const mode = modeRef.current;

		// ─── HOLDING MODE: wait, then start shuffling again ───
		if (mode === "holding") {
			const hopPlan = hopPlanRef.current;
			const maxDelay = hopPlan ? Math.max(...hopPlan.staggerDelays) : 0;
			const totalHopTime = RESET_HOP_COUNT * RESET_HOP_DURATION + maxDelay;
			if (hopPlan && now - hopPlan.startTime >= totalHopTime + RESET_HOLD_DURATION) {
				modeRef.current = "shuffling";
				cycleStartRef.current = now;
				nextSwitchTimeRef.current = now + SWITCH_INTERVAL_MIN;
				hopPlanRef.current = null;
				lastHopIndexRef.current = -1;
			}
			return;
		}

		// ─── HOPPING MODE: 3-step hop animation ───
		if (mode === "hopping") {
			const hopPlan = hopPlanRef.current;
			if (!hopPlan) return;

			const posArr = attrs.position_attr.array as Float32Array;
			const sizeArr = attrs.size_attr.array as Float32Array;
			const currArr = attrs.currUvRect.array as Float32Array;
			const nextArr = attrs.nextUvRect.array as Float32Array;

			for (let i = 0; i < segments.length; i++) {
				// Per-slot staggered time
				const slotElapsed = now - hopPlan.startTime - hopPlan.staggerDelays[i];
				if (slotElapsed < 0) {
					// This slot hasn't started hopping yet — stay at current position
					continue;
				}

				const slotHopIndex = Math.min(
					Math.floor(slotElapsed / RESET_HOP_DURATION),
					RESET_HOP_COUNT - 1,
				);
				const hopLocalT = Math.min(
					(slotElapsed - slotHopIndex * RESET_HOP_DURATION) / RESET_HOP_DURATION,
					1.0,
				);
				// Ease-out cubic
				const eased = 1.0 - (1.0 - hopLocalT) * (1.0 - hopLocalT) * (1.0 - hopLocalT);

				// From: previous hop target (or current seg for hop 0)
				let fromSegId: number;
				if (slotHopIndex === 0) {
					fromSegId = currentSegIds[i];
				} else {
					fromSegId = hopPlan.targets[slotHopIndex - 1][i];
				}

				// To: current hop target
				const toSegId = hopPlan.targets[slotHopIndex][i];

				const fromSeg = segments[fromSegId];
				const toSeg = segments[toSegId];
				const [fromX, fromY] = getSegmentWorldPos(fromSeg);
				const [toX, toY] = getSegmentWorldPos(toSeg);
				const [fromW, fromH] = getSegmentWorldSize(fromSeg);
				const [toW, toH] = getSegmentWorldSize(toSeg);

				posArr[i * 2] = fromX + (toX - fromX) * eased;
				posArr[i * 2 + 1] = fromY + (toY - fromY) * eased;
				sizeArr[i * 2] = fromW + (toW - fromW) * eased;
				sizeArr[i * 2 + 1] = fromH + (toH - fromH) * eased;

				// UV interpolation
				const off = i * 4;
				for (let c = 0; c < 4; c++) {
					currArr[off + c] =
						fromSeg.uvRect[c] + (toSeg.uvRect[c] - fromSeg.uvRect[c]) * eased;
				}
				// Keep next = curr
				for (let c = 0; c < 4; c++) {
					nextArr[off + c] = currArr[off + c];
				}
			}

			attrs.position_attr.needsUpdate = true;
			attrs.position_attr.version++;
			attrs.size_attr.needsUpdate = true;
			attrs.size_attr.version++;
			attrs.currUvRect.needsUpdate = true;
			attrs.currUvRect.version++;
			attrs.nextUvRect.needsUpdate = true;
			attrs.nextUvRect.version++;

			// Kill any pending transitions
			const transArr = attrs.transition.array as Float32Array;
			for (let i = 0; i < segments.length; i++) {
				transArr[i * 2] = -999.0;
			}
			attrs.transition.needsUpdate = true;
			attrs.transition.version++;
			pendingTransitionsRef.current.clear();

			// Check if all hops are complete (including slowest staggered slot)
			const maxDelay = Math.max(...hopPlan.staggerDelays);
			const totalHopTime = RESET_HOP_COUNT * RESET_HOP_DURATION + maxDelay;
			const elapsed = now - hopPlan.startTime;
			if (elapsed >= totalHopTime) {
				// Snap to final (original) positions
				for (let i = 0; i < segments.length; i++) {
					posArr[i * 2] = origPositions[i * 2];
					posArr[i * 2 + 1] = origPositions[i * 2 + 1];
					sizeArr[i * 2] = origSizes[i * 2];
					sizeArr[i * 2 + 1] = origSizes[i * 2 + 1];
					currentSegIds[i] = i;
					const off = i * 4;
					for (let c = 0; c < 4; c++) {
						currArr[off + c] = origUvRects[off + c];
						nextArr[off + c] = origUvRects[off + c];
					}
				}
				attrs.position_attr.needsUpdate = true;
				attrs.position_attr.version++;
				attrs.size_attr.needsUpdate = true;
				attrs.size_attr.version++;
				attrs.currUvRect.needsUpdate = true;
				attrs.currUvRect.version++;
				attrs.nextUvRect.needsUpdate = true;
				attrs.nextUvRect.version++;

				modeRef.current = "holding";
			}
			return;
		}

		// ─── SHUFFLING MODE ───

		// Check if it's time to enter hop mode
		if (now - cycleStartRef.current >= SHUFFLE_DURATION) {
			// Build hop plan: for each hop, pick a random segment target per slot
			// Last hop (index RESET_HOP_COUNT-1) always targets the original segment (slot index)
			const targets: number[][] = [];
			for (let hop = 0; hop < RESET_HOP_COUNT; hop++) {
				const hopTargets: number[] = [];
				for (let i = 0; i < segments.length; i++) {
					if (hop === RESET_HOP_COUNT - 1) {
						// Last hop: return home
						hopTargets.push(i);
					} else {
						// Random segment position
						hopTargets.push(Math.floor(Math.random() * segments.length));
					}
				}
				targets.push(hopTargets);
			}
			const staggerDelays = segments.map(() => Math.random() * RESET_STAGGER_SPREAD);
			hopPlanRef.current = { targets, startTime: now, staggerDelays };
			lastHopIndexRef.current = -1;
			modeRef.current = "hopping";
			return;
		}

		// Complete finished transitions: swap curr ← next, update position/size
		for (const idx of pendingTransitionsRef.current) {
			const startTime = (attrs.transition.array as Float32Array)[idx * 2];
			const duration = (attrs.transition.array as Float32Array)[
				idx * 2 + 1
			];
			if (now - startTime >= duration) {
				// Copy next → curr
				for (let c = 0; c < 4; c++) {
					(attrs.currUvRect.array as Float32Array)[idx * 4 + c] = (
						attrs.nextUvRect.array as Float32Array
					)[idx * 4 + c];
				}
				attrs.currUvRect.needsUpdate = true;
				attrs.currUvRect.version++;
				// Reset transition
				(attrs.transition.array as Float32Array)[idx * 2] = -999.0;
				attrs.transition.needsUpdate = true;
				attrs.transition.version++;
				pendingTransitionsRef.current.delete(idx);
			}
		}

		// Check if it's time to trigger a new switch
		if (now < nextSwitchTimeRef.current) return;

		// Pick a random segment slot that isn't currently transitioning
		const available: number[] = [];
		for (let i = 0; i < segments.length; i++) {
			if (!pendingTransitionsRef.current.has(i)) {
				available.push(i);
			}
		}
		if (available.length === 0) {
			nextSwitchTimeRef.current =
				now +
				SWITCH_INTERVAL_MIN +
				Math.random() * (SWITCH_INTERVAL_MAX - SWITCH_INTERVAL_MIN);
			return;
		}

		const slotIdx =
			available[Math.floor(Math.random() * available.length)];

		// Pick a different segment texture
		let nextSegId: number;
		do {
			nextSegId = Math.floor(Math.random() * segments.length);
		} while (nextSegId === currentSegIds[slotIdx] && segments.length > 1);

		const nextSeg = segments[nextSegId];
		currentSegIds[slotIdx] = nextSegId;

		// Update next UV rect attribute
		const off = slotIdx * 4;
		(attrs.nextUvRect.array as Float32Array)[off] = nextSeg.uvRect[0];
		(attrs.nextUvRect.array as Float32Array)[off + 1] = nextSeg.uvRect[1];
		(attrs.nextUvRect.array as Float32Array)[off + 2] = nextSeg.uvRect[2];
		(attrs.nextUvRect.array as Float32Array)[off + 3] = nextSeg.uvRect[3];
		attrs.nextUvRect.needsUpdate = true;
		attrs.nextUvRect.version++;

		// Start transition
		(attrs.transition.array as Float32Array)[slotIdx * 2] = now;
		(attrs.transition.array as Float32Array)[slotIdx * 2 + 1] =
			FADE_DURATION;
		attrs.transition.needsUpdate = true;
		attrs.transition.version++;

		pendingTransitionsRef.current.add(slotIdx);
		nextSwitchTimeRef.current =
			now +
			SWITCH_INTERVAL_MIN +
			Math.random() * (SWITCH_INTERVAL_MAX - SWITCH_INTERVAL_MIN);
	});
}

// ─── Components ─────────────────────────────────────────────────────────────

function KimonoBackground({ texture }: { texture: Texture | null }) {
	if (!texture) return null;

	return (
		<mesh position={[0, 0, -0.1]}>
			<planeGeometry args={[KIMONO_SIZE, KIMONO_SIZE]} />
			<meshBasicMaterial
				map={texture}
				side={DoubleSide}
				transparent
				opacity={BG_OPACITY}
			/>
		</mesh>
	);
}

type SakuraOverlayProps = {
	segments: SegmentInfo[];
	atlasTexture: Texture;
};

function SakuraOverlay({ segments, atlasTexture }: SakuraOverlayProps) {
	const meshRef = useRef<Mesh>(null);

	const { geometry, switcherState, uniforms } = useMemo(() => {
		const instanceData = buildInstanceData(segments);
		const { geometry: geo, attrs: a, origPositions, origSizes, origUvRects } =
			buildInstanceGeometry(instanceData, segments.length);

		const currentSegIds = segments.map((s) => s.id);

		const emptyTex = new DataTexture(
			new Float32Array(4),
			1,
			1,
			RGBAFormat,
			FloatType,
		);
		emptyTex.minFilter = NearestFilter;
		emptyTex.magFilter = NearestFilter;
		emptyTex.needsUpdate = true;

		const u = {
			uTime: { value: 0 },
			uAtlas: { value: atlasTexture ?? emptyTex },
		};

		return {
			geometry: geo,
			switcherState: {
				segments,
				currentSegIds,
				attrs: a,
				origPositions,
				origSizes,
				origUvRects,
			} as SwitcherState,
			uniforms: u,
		};
	}, [segments, atlasTexture]);

	useEffect(() => {
		uniforms.uAtlas.value = atlasTexture;
	}, [atlasTexture, uniforms]);

	useFrame(({ clock }) => {
		uniforms.uTime.value = clock.getElapsedTime();
	});

	useSegmentSwitcher(switcherState);

	return (
		<mesh ref={meshRef} position={[0, 0, 0]}>
			<primitive object={geometry} attach="geometry" />
			<shaderMaterial
				vertexShader={spriteVertexShader}
				fragmentShader={spriteFragmentShader}
				transparent
				depthWrite={false}
				side={DoubleSide}
				uniforms={uniforms}
				blending={CustomBlending}
				blendSrc={OneFactor}
				blendDst={OneMinusSrcAlphaFactor}
			/>
		</mesh>
	);
}

function Scene() {
	const [segments, setSegments] = useState<SegmentInfo[]>([]);
	const [atlasTexture, setAtlasTexture] = useState<Texture | null>(null);
	const [kimonoTexture, setKimonoTexture] = useState<Texture | null>(null);

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

	if (segments.length === 0) return null;

	return (
		<>
			<color attach="background" args={["#020617"]} />
			<CameraControls />
			<KimonoBackground texture={kimonoTexture} />
			{atlasTexture && (
				<SakuraOverlay segments={segments} atlasTexture={atlasTexture} />
			)}
		</>
	);
}

// ─── Camera Controls ────────────────────────────────────────────────────────

function CameraControls() {
	const { camera, gl } = useThree();
	const controls = useMemo(
		() => new ThreeOrbitControls(camera, gl.domElement),
		[camera, gl.domElement],
	);

	useEffect(() => {
		controls.enableDamping = true;
		controls.dampingFactor = 0.08;
		controls.enablePan = false;
		controls.minDistance = 3.0;
		controls.maxDistance = 9.2;
		return () => controls.dispose();
	}, [controls]);

	useFrame(() => {
		controls.update();
	});

	return null;
}

// ─── App ────────────────────────────────────────────────────────────────────

function App() {
	return (
		<div className="h-[calc(100vh-72px)] min-h-[520px]">
			<Canvas camera={{ position: [0, 0, 4.5], fov: 44 }}>
				<Scene />
			</Canvas>
		</div>
	);
}
