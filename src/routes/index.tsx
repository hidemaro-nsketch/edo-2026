import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	BufferAttribute,
	BufferGeometry,
	DataTexture,
	DoubleSide,
	FloatType,
	InstancedBufferAttribute,
	InstancedBufferGeometry,
	LineBasicMaterial,
	type Mesh,
	NearestFilter,
	PlaneGeometry,
	RGBAFormat,
	type Texture,
	Vector3,
} from "three";
import { OrbitControls as ThreeOrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { loadAtlasTextures } from "../sakura/segment-manager";
import type { SegmentManifest, SegmentInfo } from "../sakura/types";

export const Route = createFileRoute("/")({ component: App });

// ─── Configuration ──────────────────────────────────────────────────────────

const NUM_LAYERS = 5;
const LAYER_SPACING = 1.4;
const MAX_SEGMENTS = 256;

/** Visible area in world units */
const WORLD_WIDTH = 8.4;
const WORLD_HEIGHT = 5.2;

/** Kimono region size in world units (segments are placed relative to this) */
const KIMONO_WIDTH = WORLD_WIDTH;
const KIMONO_HEIGHT = WORLD_HEIGHT;

const layers = Array.from({ length: NUM_LAYERS }, (_, i) => ({
	z: -i * LAYER_SPACING,
}));

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

// ─── Segment DataTextures ───────────────────────────────────────────────────

type SegmentTextures = {
	/** [u0, v0, du, dv] per segment */
	uvTex: DataTexture;
	/** [width, height, aspect, 0] per segment (world-space) */
	sizeTex: DataTexture;
	/** [posX, posY, 0, 0] per segment (world-space position from bboxInSource) */
	posTex: DataTexture;
};

function buildSegmentTextures(segments: SegmentInfo[]): SegmentTextures {
	const uvData = new Float32Array(MAX_SEGMENTS * 4);
	const sizeData = new Float32Array(MAX_SEGMENTS * 4);
	const posData = new Float32Array(MAX_SEGMENTS * 4);

	for (const seg of segments) {
		const off = seg.id * 4;

		// UV rect
		uvData[off] = seg.uvRect[0];
		uvData[off + 1] = seg.uvRect[1];
		uvData[off + 2] = seg.uvRect[2];
		uvData[off + 3] = seg.uvRect[3];

		// Size: proportional to bbox in original kimono image → world units
		const bboxW = seg.bboxInSource[2] / seg.originalSize[0];
		const bboxH = seg.bboxInSource[3] / seg.originalSize[1];
		sizeData[off] = bboxW * KIMONO_WIDTH;
		sizeData[off + 1] = bboxH * KIMONO_HEIGHT;
		sizeData[off + 2] = bboxW / bboxH; // aspect
		sizeData[off + 3] = 0;

		// Position: bboxInSource center normalized to [-0.5, 0.5] then to world coords
		const cx = (seg.bboxInSource[0] + seg.bboxInSource[2] * 0.5) / seg.originalSize[0];
		const cy = (seg.bboxInSource[1] + seg.bboxInSource[3] * 0.5) / seg.originalSize[1];
		posData[off] = (cx - 0.5) * KIMONO_WIDTH;
		posData[off + 1] = -(cy - 0.5) * KIMONO_HEIGHT; // flip Y: image Y down → world Y up
		posData[off + 2] = 0;
		posData[off + 3] = 0;
	}

	const makeTex = (data: Float32Array) => {
		const tex = new DataTexture(data, MAX_SEGMENTS, 1, RGBAFormat, FloatType);
		tex.minFilter = NearestFilter;
		tex.magFilter = NearestFilter;
		tex.needsUpdate = true;
		return tex;
	};

	return { uvTex: makeTex(uvData), sizeTex: makeTex(sizeData), posTex: makeTex(posData) };
}

// ─── Instance geometry builder ──────────────────────────────────────────────

function buildInstanceGeometry(
	segmentCount: number,
	layerIndex: number,
	patternSeed: number,
): InstancedBufferGeometry {
	// One sprite per segment
	const count = segmentCount;

	const phases = new Float32Array(count);
	const spriteIds = new Float32Array(count);

	for (let i = 0; i < count; i++) {
		// Stagger phase per sprite so they don't all animate at once
		phases[i] = ((i / count) + layerIndex * 0.13 + patternSeed * 0.001) % 1.0;
		spriteIds[i] = i;
	}

	const base = new PlaneGeometry(1, 1);
	const geo = new InstancedBufferGeometry();
	geo.index = base.index;
	geo.attributes.position = base.attributes.position;
	geo.attributes.uv = base.attributes.uv;

	geo.setAttribute("aPhase", new InstancedBufferAttribute(phases, 1));
	geo.setAttribute("aSpriteId", new InstancedBufferAttribute(spriteIds, 1));

	geo.instanceCount = count;
	return geo;
}

// ─── Shaders ────────────────────────────────────────────────────────────────

const spriteVertexShader = /* glsl */ `
precision highp float;

attribute float aPhase;
attribute float aSpriteId;

uniform float uTime;
uniform float uPatternSeed;
uniform float uLayerIndex;
uniform float uLayerCount;
uniform float uVisibilityThreshold;
uniform float uSegmentCount;

uniform sampler2D uSegUVTex;
uniform sampler2D uSegSizeTex;
uniform sampler2D uSegPosTex;

varying vec2 vUv;
varying vec4 vUvRect;
varying float vAlpha;

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float signedCircDist(float sweep, float phase) {
  float d = sweep - phase;
  return d - floor(d + 0.5);
}

float texLookup(float segId) {
  return (floor(segId) + 0.5) / ${MAX_SEGMENTS}.0;
}

void main() {
  vUv = uv;

  float sweep = fract(uTime * 0.06);
  float sweepCycle = floor(uTime * 0.06);
  float sd = signedCircDist(sweep, aPhase);

  // Current and next segment IDs (change each sweep cycle)
  float currSegId = mod(aSpriteId + sweepCycle * 7.0 + uLayerIndex * 13.0, uSegmentCount);
  float nextSegId = mod(aSpriteId + (sweepCycle + 1.0) * 7.0 + uLayerIndex * 13.0, uSegmentCount);

  float currLookup = texLookup(currSegId);
  float nextLookup = texLookup(nextSegId);

  // Sweep visibility: 1.0 when fully visible, 0.0 at sweep edge
  float animVisibility = smoothstep(0.15, 0.01, abs(sd));

  // Transition factor: 0.0 = showing curr, 1.0 = showing next
  // Remap sd from [-0.5, 0.5] to transition: negative sd = approaching (curr), positive = departing (next)
  float transitionT = smoothstep(-0.02, 0.02, sd);

  // Read current and next segment data
  vec4 currUV = texture2D(uSegUVTex, vec2(currLookup, 0.5));
  vec4 nextUV = texture2D(uSegUVTex, vec2(nextLookup, 0.5));
  vec4 currSize = texture2D(uSegSizeTex, vec2(currLookup, 0.5));
  vec4 nextSize = texture2D(uSegSizeTex, vec2(nextLookup, 0.5));
  vec4 currPos = texture2D(uSegPosTex, vec2(currLookup, 0.5));
  vec4 nextPos = texture2D(uSegPosTex, vec2(nextLookup, 0.5));

  // Interpolate UV rect, size, and position
  vUvRect = mix(currUV, nextUV, transitionT);
  vec2 spriteSize = mix(currSize.xy, nextSize.xy, transitionT);
  vec2 spritePos = mix(currPos.xy, nextPos.xy, transitionT);

  // Layer visibility
  float guaranteedLayer = floor(hash11(aSpriteId * 11.17 + 0.73 + uPatternSeed * 3.1) * uLayerCount);
  float isGuaranteedLayer = 1.0 - step(0.5, abs(uLayerIndex - guaranteedLayer));
  float randomVisible = step(uVisibilityThreshold, hash11(aSpriteId * 7.13 + uLayerIndex * 17.0 + 3.1 + uPatternSeed * 9.7));
  float visibleCell = max(isGuaranteedLayer, randomVisible);

  vAlpha = animVisibility * visibleCell;

  // Scale quad by interpolated size, position at interpolated location
  vec3 scaled = position * vec3(spriteSize, 1.0);
  vec3 worldPos = scaled + vec3(spritePos, 0.0);

  gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPos, 1.0);
}
`;

const spriteFragmentShader = /* glsl */ `
precision highp float;

varying vec2 vUv;
varying vec4 vUvRect;
varying float vAlpha;

uniform sampler2D uAtlas;

void main() {
  vec2 atlasUv = vUvRect.xy + vUv * vUvRect.zw;
  vec4 texColor = texture2D(uAtlas, atlasUv);

  float alpha = texColor.a * vAlpha;
  if (alpha < 0.02) {
    discard;
  }

  gl_FragColor = vec4(texColor.rgb, alpha);
}
`;

// ─── Types ──────────────────────────────────────────────────────────────────

type SakuraLayerProps = {
	z: number;
	layerIndex: number;
	layerCount: number;
	patternSeed: number;
	segmentCount: number;
	segTextures: SegmentTextures | null;
	atlasTexture: Texture | null;
};

// ─── Components ─────────────────────────────────────────────────────────────

function SakuraLayer({
	z,
	layerIndex,
	layerCount,
	patternSeed,
	segmentCount,
	segTextures,
	atlasTexture,
}: SakuraLayerProps) {
	const meshRef = useRef<Mesh>(null);
	const worldPosition = useMemo(() => new Vector3(), []);
	const viewPosition = useMemo(() => new Vector3(), []);
	const baseViewPosition = useMemo(() => new Vector3(), []);

	const geometry = useMemo(
		() => buildInstanceGeometry(segmentCount, layerIndex, patternSeed),
		[segmentCount, layerIndex, patternSeed],
	);

	const emptyTex = useMemo(() => {
		const data = new Float32Array(4);
		const t = new DataTexture(data, 1, 1, RGBAFormat, FloatType);
		t.minFilter = NearestFilter;
		t.magFilter = NearestFilter;
		t.needsUpdate = true;
		return t;
	}, []);

	const uniforms = useMemo(
		() => ({
			uTime: { value: 0 },
			uPatternSeed: { value: patternSeed },
			uLayerIndex: { value: layerIndex },
			uLayerCount: { value: layerCount },
			uVisibilityThreshold: { value: 0.5 },
			uSegmentCount: { value: segmentCount },
			uSegUVTex: { value: segTextures?.uvTex ?? emptyTex },
			uSegSizeTex: { value: segTextures?.sizeTex ?? emptyTex },
			uSegPosTex: { value: segTextures?.posTex ?? emptyTex },
			uAtlas: { value: atlasTexture ?? emptyTex },
		}),
		[patternSeed, layerIndex, layerCount, segmentCount, segTextures, atlasTexture, emptyTex],
	);

	useEffect(() => {
		if (segTextures) {
			uniforms.uSegUVTex.value = segTextures.uvTex;
			uniforms.uSegSizeTex.value = segTextures.sizeTex;
			uniforms.uSegPosTex.value = segTextures.posTex;
		}
		if (atlasTexture) {
			uniforms.uAtlas.value = atlasTexture;
		}
		uniforms.uSegmentCount.value = segmentCount;
	}, [segTextures, atlasTexture, segmentCount, uniforms]);

	useFrame(({ camera, clock }) => {
		const mesh = meshRef.current;
		if (!mesh) return;

		uniforms.uTime.value = clock.getElapsedTime();

		// Perspective compensation
		mesh.getWorldPosition(worldPosition);
		viewPosition.copy(worldPosition).applyMatrix4(camera.matrixWorldInverse);
		baseViewPosition.set(0, 0, 0).applyMatrix4(camera.matrixWorldInverse);

		const planeDepth = Math.max(0.001, -viewPosition.z);
		const baseDepth = Math.max(0.001, -baseViewPosition.z);
		const perspectiveCompensation = planeDepth / baseDepth;

		mesh.scale.set(perspectiveCompensation, perspectiveCompensation, 1);
	});

	if (!atlasTexture || !segTextures) return null;

	return (
		<mesh ref={meshRef} position={[0, 0, z]}>
			<primitive object={geometry} attach="geometry" />
			<shaderMaterial
				vertexShader={spriteVertexShader}
				fragmentShader={spriteFragmentShader}
				transparent
				depthWrite={false}
				side={DoubleSide}
				uniforms={uniforms}
			/>
		</mesh>
	);
}

function KimonoFrame() {
	const geometry = useMemo(() => {
		const hw = KIMONO_WIDTH / 2;
		const hh = KIMONO_HEIGHT / 2;
		const verts = new Float32Array([
			-hw, -hh, 0,
			 hw, -hh, 0,
			 hw,  hh, 0,
			-hw,  hh, 0,
			-hw, -hh, 0, // close the loop
		]);
		const geo = new BufferGeometry();
		geo.setAttribute("position", new BufferAttribute(verts, 3));
		return geo;
	}, []);

	const material = useMemo(
		() => new LineBasicMaterial({ color: 0x475569, linewidth: 1, transparent: true, opacity: 0.4 }),
		[],
	);

	return <lineLoop args={[geometry, material]} />;
}

function Scene() {
	const [patternSeed] = useState(() => Math.random() * 1000);
	const [segments, setSegments] = useState<SegmentInfo[]>([]);
	const [atlasTexture, setAtlasTexture] = useState<Texture | null>(null);
	const [segTextures, setSegTextures] = useState<SegmentTextures | null>(null);

	useEffect(() => {
		let disposed = false;
		const textures: Texture[] = [];

		async function init() {
			const manifest = await loadManifest();
			if (!manifest) {
				console.warn("No segments.manifest.json found in public/sakura/");
				return;
			}
			if (disposed) return;

			setSegments(manifest.segments);
			setSegTextures(buildSegmentTextures(manifest.segments));

			try {
				const loaded = await loadAtlasTextures(manifest, `${SAKURA_BASE_PATH}/atlas`);
				if (disposed) return;
				textures.push(...loaded);
				if (loaded.length > 0) {
					setAtlasTexture(loaded[0]);
				}
			} catch (err) {
				console.warn("Atlas loading failed:", err);
			}

			if (!disposed) {
				console.log(
					`Loaded manifest: ${manifest.segments.length} segments, ${manifest.atlas.pages.length} pages`,
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
			<KimonoFrame />
			{layers.map((layer, index) => (
				<SakuraLayer
					key={`layer-${index}`}
					z={layer.z}
					layerIndex={index}
					layerCount={layers.length}
					patternSeed={patternSeed}
					segmentCount={segments.length}
					segTextures={segTextures}
					atlasTexture={atlasTexture}
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
