import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	DataTexture,
	DoubleSide,
	type Mesh,
	Vector3,
	type Texture,
} from "three";
import { OrbitControls as ThreeOrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CellStateManager } from "../sakura/cell-state-manager";
import { SegmentManager, loadAtlasTextures } from "../sakura/segment-manager";
import type { SegmentManifest } from "../sakura/types";

export const Route = createFileRoute("/")({ component: App });

// ─── Configuration ──────────────────────────────────────────────────────────

type LayerConfig = {
	z: number;
};

const NUM_LAYERS = 5;
const LAYER_SPACING = 1.4;

const layers: LayerConfig[] = Array.from({ length: NUM_LAYERS }, (_, i) => ({
	z: -i * LAYER_SPACING,
}));

/** Base path for sakura assets served from public/ */
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

// ─── Shaders ────────────────────────────────────────────────────────────────

const vertexShader = `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = `
precision highp float;
precision highp int;
precision highp sampler2D;

varying vec2 vUv;

uniform float uLayerIndex;
uniform float uLayerCount;
uniform float uPatternSeed;
uniform float uTime;
uniform float uVisibilityThreshold;

// Segment data textures
uniform sampler2D uSegmentUVTex;

// Cell state data textures
uniform sampler2D uCellStateTex;
uniform sampler2D uCellXformTex;

// Atlas texture (single page for now; extend to sampler2DArray later)
uniform sampler2D uAtlas0;

// Whether we have real atlas textures loaded
uniform float uHasAtlas;

#define NUM_SEEDS 150
#define ANIM_FADE 0.15
#define ANIM_PEAK 0.01
#define DEFORM_STRENGTH 0.45

// ─── Hash functions ─────────────────────────────────────────────────────────

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

vec2 hash21(float p) {
  float x = hash11(p + 1.37);
  float y = hash11(p + 9.91);
  return vec2(x, y);
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 0.6666667, 0.3333333, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

// ─── Animation helpers ──────────────────────────────────────────────────────

float signedCircDist(float sweep, float phase) {
  float d = sweep - phase;
  return d - floor(d + 0.5);
}

float animPhase(float cellId) {
  return hash11(cellId * 3.17 + uLayerIndex * 5.3 + uPatternSeed * 2.7);
}

// ─── Segment texture lookup ─────────────────────────────────────────────────

vec4 getSegUV(float segId) {
  float u = (segId + 0.5) / 256.0;
  return texture2D(uSegmentUVTex, vec2(u, 0.5));
}

vec4 getCellState(float cellIdx, float layerIdx) {
  float u = (cellIdx + 0.5) / float(NUM_SEEDS);
  float v = (layerIdx + 0.5) / float(${NUM_LAYERS});
  return texture2D(uCellStateTex, vec2(u, v));
}

vec4 getCellXform(float cellIdx, float layerIdx) {
  float u = (cellIdx + 0.5) / float(NUM_SEEDS);
  float v = (layerIdx + 0.5) / float(${NUM_LAYERS});
  return texture2D(uCellXformTex, vec2(u, v));
}

vec4 sampleSegment(float segId, vec2 localUV) {
  vec4 uvRect = getSegUV(segId);
  vec2 uv = uvRect.xy + clamp(localUV, 0.0, 1.0) * uvRect.zw;
  return texture2D(uAtlas0, uv);
}

// ─── Main ───────────────────────────────────────────────────────────────────

void main() {
  vec2 uv = vUv;
  float nearest = 1e9;
  float id = 0.0;
  vec2 nearestSeedPos = vec2(0.0);

  float sweep = fract(uTime * 0.06);

  // Voronoi nearest-neighbor (same as before)
  for (int i = 0; i < NUM_SEEDS; i++) {
    float fi = float(i);

    float sd = signedCircDist(sweep, animPhase(fi));
    float transition = smoothstep(-ANIM_FADE, -ANIM_FADE * 0.5, sd)
                     * smoothstep(-ANIM_PEAK, -ANIM_FADE * 0.35, sd);

    vec2 perturbDir = vec2(hash11(fi * 7.3 + 1.1) - 0.5, hash11(fi * 11.7 + 2.3) - 0.5);
    vec2 point = 0.06 + 0.88 * hash21(fi + 19.73) + perturbDir * transition * DEFORM_STRENGTH;

    float d = distance(uv, point);

    if (d < nearest) {
      nearest = d;
      id = fi;
      nearestSeedPos = point;
    }
  }

  // Layer visibility (same as before)
  float guaranteedLayer = floor(hash11(id * 11.17 + 0.73 + uPatternSeed * 3.1) * uLayerCount);
  float isGuaranteedLayer = 1.0 - step(0.5, abs(uLayerIndex - guaranteedLayer));
  float randomVisible = step(uVisibilityThreshold, hash11(id * 7.13 + uLayerIndex * 17.0 + 3.1 + uPatternSeed * 9.7));
  float visibleCell = max(isGuaranteedLayer, randomVisible);

  // Sweep animation visibility (same as before)
  float sd = signedCircDist(sweep, animPhase(id));
  float animVisibility = smoothstep(ANIM_FADE, ANIM_PEAK, abs(sd));

  // ── Texture or fallback color ──

  vec3 color;
  float alpha;

  if (uHasAtlas > 0.5) {
    // Textured mode: sample from atlas
    vec4 cellState = getCellState(id, uLayerIndex);
    vec4 cellXform = getCellXform(id, uLayerIndex);

    float currSegId = cellState.r;
    float nextSegId = cellState.g;
    float blendT = cellState.b;

    // Per-cell UV: transform world UV to segment-local UV
    float cellRadius = max(nearest, 0.01) * 2.5;
    vec2 rel = (uv - nearestSeedPos) / cellRadius;

    float cs = cos(cellXform.r);
    float sn = sin(cellXform.r);
    mat2 R = mat2(cs, -sn, sn, cs);
    vec2 localUV = (R * rel) * cellXform.g * 0.5 + vec2(0.5) + cellXform.ba;

    // Sample and blend
    vec4 currColor = sampleSegment(currSegId, localUV);
    vec4 nextColor = sampleSegment(nextSegId, localUV);

    vec4 blended = mix(currColor, nextColor, blendT);

    color = blended.rgb;
    alpha = blended.a * visibleCell * animVisibility;
  } else {
    // Fallback: procedural color (original behavior)
    float baseHue = 0.55 + uLayerIndex * 0.03;
    float hueJitter = 0.06;
    float hueOffset = (hash11(id * 5.37 + 2.11) - 0.5) * hueJitter;
    float hue = fract(baseHue + hueOffset);
    vec3 fill = hsv2rgb(vec3(hue, 0.7, 0.95));
    float vignette = smoothstep(0.85, 0.15, nearest);
    fill *= mix(0.7, 1.05, vignette);

    color = fill;
    alpha = visibleCell * animVisibility;
  }

  if (alpha < 0.02) {
    discard;
  }

  gl_FragColor = vec4(color, alpha);
}
`;

// ─── Types ──────────────────────────────────────────────────────────────────

type VoronoiPlaneProps = {
	z: number;
	layerIndex: number;
	layerCount: number;
	patternSeed: number;
	segmentManager: SegmentManager | null;
	cellStateManager: CellStateManager | null;
};

// ─── Components ─────────────────────────────────────────────────────────────

function VoronoiPlane({
	z,
	layerIndex,
	layerCount,
	patternSeed,
	segmentManager,
	cellStateManager,
}: VoronoiPlaneProps) {
	const meshRef = useRef<Mesh>(null);
	const worldPosition = useMemo(() => new Vector3(), []);
	const viewPosition = useMemo(() => new Vector3(), []);
	const baseViewPosition = useMemo(() => new Vector3(), []);

	const emptyTex = useMemo(() => {
		const data = new Float32Array(4);
		const t = new DataTexture(data, 1, 1);
		t.needsUpdate = true;
		return t;
	}, []);

	const uniforms = useMemo(
		() => ({
			uLayerIndex: { value: layerIndex },
			uLayerCount: { value: layerCount },
			uPatternSeed: { value: patternSeed },
			uTime: { value: 0 },
			uVisibilityThreshold: { value: 0.5 },
			uSegmentUVTex: { value: emptyTex as DataTexture },
			uCellStateTex: { value: emptyTex as DataTexture },
			uCellXformTex: { value: emptyTex as DataTexture },
			uAtlas0: { value: emptyTex as Texture },
			uHasAtlas: { value: 0.0 },
		}),
		[layerCount, layerIndex, patternSeed, emptyTex],
	);

	// Update data texture uniforms when managers change
	useEffect(() => {
		if (segmentManager) {
			uniforms.uSegmentUVTex.value = segmentManager.segmentUVTex;
			if (segmentManager.atlasTextures.length > 0) {
				uniforms.uAtlas0.value = segmentManager.atlasTextures[0];
				uniforms.uHasAtlas.value = 1.0;
			}
		}
		if (cellStateManager) {
			uniforms.uCellStateTex.value = cellStateManager.cellStateTex;
			uniforms.uCellXformTex.value = cellStateManager.cellXformTex;
		}
	}, [segmentManager, cellStateManager, uniforms]);

	useFrame(({ camera, clock }) => {
		const mesh = meshRef.current;
		if (!mesh) return;

		uniforms.uTime.value = clock.getElapsedTime();

		// Perspective compensation (same as before)
		mesh.getWorldPosition(worldPosition);
		viewPosition.copy(worldPosition).applyMatrix4(camera.matrixWorldInverse);
		baseViewPosition.set(0, 0, 0).applyMatrix4(camera.matrixWorldInverse);

		const planeDepth = Math.max(0.001, -viewPosition.z);
		const baseDepth = Math.max(0.001, -baseViewPosition.z);
		const perspectiveCompensation = planeDepth / baseDepth;

		mesh.scale.set(perspectiveCompensation, perspectiveCompensation, 1);
	});

	return (
		<mesh ref={meshRef} position={[0, 0, z]}>
			<planeGeometry args={[8.4, 5.2]} />
			<shaderMaterial
				vertexShader={vertexShader}
				fragmentShader={fragmentShader}
				transparent
				depthWrite={false}
				side={DoubleSide}
				uniforms={uniforms}
			/>
		</mesh>
	);
}

function Scene() {
	const [patternSeed] = useState(() => Math.random() * 1000);
	const [segmentManager, setSegmentManager] = useState<SegmentManager | null>(
		null,
	);
	const [cellStateManager, setCellStateManager] =
		useState<CellStateManager | null>(null);

	// Initialize managers from public/sakura/ manifest
	useEffect(() => {
		let disposed = false;
		let sm: SegmentManager | null = null;
		let csm: CellStateManager | null = null;

		async function init() {
			const manifest = await loadManifest();
			if (!manifest) {
				console.warn("No segments.manifest.json found in public/sakura/");
				return;
			}
			if (disposed) return;

			sm = new SegmentManager(manifest);
			const allSegIds = manifest.segments.map((s: { id: number }) => s.id);
			csm = new CellStateManager(allSegIds);

			try {
				const textures = await loadAtlasTextures(manifest, `${SAKURA_BASE_PATH}/atlas`);
				if (disposed) return;
				sm.atlasTextures.push(...textures);
			} catch (err) {
				console.warn("Atlas loading failed, using procedural fallback:", err);
			}

			if (disposed) return;
			setSegmentManager(sm);
			setCellStateManager(csm);
			console.log(
				`Loaded manifest: ${manifest.segments.length} segments, ${manifest.atlas.pages.length} pages`,
			);
		}

		init();

		return () => {
			disposed = true;
			sm?.dispose();
			csm?.dispose();
		};
	}, []);

	// Update cell state each frame
	useFrame((_, delta) => {
		cellStateManager?.update(delta);
	});

	return (
		<>
			<color attach="background" args={["#020617"]} />
			<CameraControls />
			{layers.map((layer, index) => (
				<VoronoiPlane
					key={`layer-${index}`}
					z={layer.z}
					layerIndex={index}
					layerCount={layers.length}
					patternSeed={patternSeed}
					segmentManager={segmentManager}
					cellStateManager={cellStateManager}
				/>
			))}
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
		controls.minDistance = 4.2;
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
			<Canvas camera={{ position: [0, 0, 5.8], fov: 44 }}>
				<Scene />
			</Canvas>
		</div>
	);
}
