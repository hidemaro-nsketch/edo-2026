/**
 * SegmentMeshRenderer.tsx — Generic GPU Instanced Segment Renderer
 *
 * A reusable renderer that takes SegmentRenderInstance[] and draws them
 * using instanced geometry with a shared shader material.
 *
 * This component has NO dependency on BuildSystem — it receives all
 * instance data from its parent, making it usable for both normal
 * shuffle rendering and theme transition animations.
 */

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
	type Camera,
	InstancedBufferAttribute,
	InstancedBufferGeometry,
	Mesh,
	NormalBlending,
	PlaneGeometry,
	ShaderMaterial,
	type Texture,
	Vector3,
} from "three";
import type {
	BlackFillRenderInstance,
	SegmentRenderInstance,
} from "../layered-shuffle/types";
import type { SegmentInfo } from "../sakura/types";

// ─── Shaders ─────────────────────────────────────────────────────────────────

const vertexShader = /* glsl */ `
precision highp float;

attribute vec2 aPosition;
attribute float aPositionZ;
attribute vec2 aSize;
attribute vec4 aUvRect;
attribute float aOpacity;
attribute float aIsBlackFill;
attribute float aWipeRole;
attribute float aIsBboxOutline;
attribute float aSwipeProgress;
attribute float aUseOthersAtlas;
attribute float aDimFactor;

varying vec2 vUv;
varying vec4 vUvRect;
varying float vOpacity;
varying float vIsBlackFill;
varying float vWipeRole;
varying float vIsBboxOutline;
varying float vSwipeProgress;
varying float vUseOthersAtlas;
varying float vDimFactor;

void main() {
  vUv = uv;
  vUvRect = aUvRect;
  vOpacity = aOpacity;
  vIsBlackFill = aIsBlackFill;
  vWipeRole = aWipeRole;
  vIsBboxOutline = aIsBboxOutline;
  vSwipeProgress = aSwipeProgress;
  vUseOthersAtlas = aUseOthersAtlas;
  vDimFactor = aDimFactor;

  vec3 scaled = position * vec3(aSize, 1.0);
  vec3 worldPos = scaled + vec3(aPosition, aPositionZ);

  gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPos, 1.0);
}
`;

const fragmentShader = /* glsl */ `
precision highp float;

varying vec2 vUv;
varying vec4 vUvRect;
varying float vOpacity;
varying float vIsBlackFill;
varying float vWipeRole;
varying float vIsBboxOutline;
varying float vSwipeProgress;
varying float vUseOthersAtlas;
varying float vDimFactor;

uniform sampler2D uAtlas;
uniform sampler2D uAtlasOthers;
uniform float uTime;
uniform float uNoiseFreq;
uniform float uNoiseAmp;
uniform float uNoiseSpeed;

// ── Simplex 2D noise (Ashima Arts) ──────────────────────────────────────────
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                     -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
// ─────────────────────────────────────────────────────────────────────────────

void main() {
  // Bbox outline mode: draw white wireframe border
  if (vIsBboxOutline > 0.5) {
    float borderW = 0.02;
    float x = vUv.x;
    float y = vUv.y;
    bool onEdge = x < borderW || x > (1.0 - borderW) || y < borderW || y > (1.0 - borderW);
    if (!onEdge) discard;
    gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
    return;
  }

  // Swipe clipping with noisy edge
  if (vWipeRole > 0.5) {
    float x = vUv.x;
    float p = vSwipeProgress;
    // Add noise distortion to the clip boundary
    float noise = snoise(vec2(vUv.y * uNoiseFreq, uTime * uNoiseSpeed));
    float noiseFade = smoothstep(0.0, 0.08, p) * (1.0 - smoothstep(0.92, 1.0, p));
    float threshold = clamp(p + noise * uNoiseAmp * noiseFade, 0.0, 1.0);
    if (vWipeRole < 1.5) {
      // Old segment: keep right portion, discard left as wipe progresses
      if (x < threshold) discard;
    } else {
      // New segment: keep left portion, discard right
      if (x > threshold) discard;
    }
  }

  if (vIsBlackFill > 0.5) {
    vec2 flippedUv = vec2(vUv.x, 1.0 - vUv.y);
    vec2 atlasUv = vUvRect.xy + flippedUv * vUvRect.zw;
    float a = vUseOthersAtlas > 0.5
      ? texture2D(uAtlasOthers, atlasUv).a
      : texture2D(uAtlas, atlasUv).a;
    // Sharpen edge alpha so the fill is solidly black (no translucent fringe)
    float solidA = step(0.01, a);
    gl_FragColor = vec4(0.0, 0.0, 0.0, solidA);
    return;
  }

  vec2 flippedUv = vec2(vUv.x, 1.0 - vUv.y);
  vec2 atlasUv = vUvRect.xy + flippedUv * vUvRect.zw;
  vec4 color = vUseOthersAtlas > 0.5
    ? texture2D(uAtlasOthers, atlasUv)
    : texture2D(uAtlas, atlasUv);

  float mask = step(0.01, color.a);
  // 輝度ベースで黒/白を判定（smoothstepでアンチエイリアス）
  float lum = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  vec3 rgb = vec3(smoothstep(0.02, 0.25, lum));
  // Apply dim factor for non-active slots during swipe
  rgb *= vDimFactor;
  gl_FragColor = vec4(rgb, mask * vOpacity);
}
`;

// ─── Shared material ─────────────────────────────────────────────────────────

export function createSegmentMaterial(
	atlas: Texture,
	othersAtlas?: Texture,
): ShaderMaterial {
	return new ShaderMaterial({
		vertexShader,
		fragmentShader,
		uniforms: {
			uAtlas: { value: atlas },
			uAtlasOthers: { value: othersAtlas ?? atlas },
			uTime: { value: 0 },
			uNoiseFreq: { value: 15.0 },
			uNoiseAmp: { value: 0.08 },
			uNoiseSpeed: { value: 8.0 },
		},
		transparent: true,
		depthWrite: false,
		blending: NormalBlending,
	});
}

// ─── Geometry helpers ────────────────────────────────────────────────────────

export type DynamicGeometry = {
	geo: InstancedBufferGeometry;
	posXY: InstancedBufferAttribute;
	posZ: InstancedBufferAttribute;
	size: InstancedBufferAttribute;
	uvRect: InstancedBufferAttribute;
	opacity: InstancedBufferAttribute;
	isBlackFill: InstancedBufferAttribute;
	wipeRole: InstancedBufferAttribute;
	isBboxOutline: InstancedBufferAttribute;
	swipeProgress: InstancedBufferAttribute;
	useOthersAtlas: InstancedBufferAttribute;
	dimFactor: InstancedBufferAttribute;
	maxInstances: number;
};

export function createDynamicGeometry(maxInstances: number): DynamicGeometry {
	const base = new PlaneGeometry(1, 1);
	const geo = new InstancedBufferGeometry();
	geo.index = base.index;
	geo.attributes.position = base.attributes.position;
	geo.attributes.uv = base.attributes.uv;

	const posXY = new InstancedBufferAttribute(
		new Float32Array(maxInstances * 2),
		2,
	);
	const posZ = new InstancedBufferAttribute(new Float32Array(maxInstances), 1);
	const size = new InstancedBufferAttribute(
		new Float32Array(maxInstances * 2),
		2,
	);
	const uvRect = new InstancedBufferAttribute(
		new Float32Array(maxInstances * 4),
		4,
	);
	const opacity = new InstancedBufferAttribute(
		new Float32Array(maxInstances),
		1,
	);
	const isBlackFill = new InstancedBufferAttribute(
		new Float32Array(maxInstances),
		1,
	);
	const wipeRole = new InstancedBufferAttribute(
		new Float32Array(maxInstances),
		1,
	);
	const isBboxOutline = new InstancedBufferAttribute(
		new Float32Array(maxInstances),
		1,
	);
	const swipeProgress = new InstancedBufferAttribute(
		new Float32Array(maxInstances),
		1,
	);
	const useOthersAtlas = new InstancedBufferAttribute(
		new Float32Array(maxInstances),
		1,
	);
	const dimFactor = new InstancedBufferAttribute(
		new Float32Array(maxInstances).fill(1.0),
		1,
	);

	geo.setAttribute("aPosition", posXY);
	geo.setAttribute("aPositionZ", posZ);
	geo.setAttribute("aSize", size);
	geo.setAttribute("aUvRect", uvRect);
	geo.setAttribute("aOpacity", opacity);
	geo.setAttribute("aIsBlackFill", isBlackFill);
	geo.setAttribute("aWipeRole", wipeRole);
	geo.setAttribute("aIsBboxOutline", isBboxOutline);
	geo.setAttribute("aSwipeProgress", swipeProgress);
	geo.setAttribute("aUseOthersAtlas", useOthersAtlas);
	geo.setAttribute("aDimFactor", dimFactor);
	geo.instanceCount = 0;

	return {
		geo,
		posXY,
		posZ,
		size,
		uvRect,
		opacity,
		isBlackFill,
		wipeRole,
		isBboxOutline,
		swipeProgress,
		useOthersAtlas,
		dimFactor,
		maxInstances,
	};
}

/**
 * Write segment instances + optional black fills into a DynamicGeometry's GPU buffers.
 */
export type WriteOptions = {
	blackFills?: BlackFillRenderInstance[];
	opacityOverride?: Map<number, number>;
	dimFactor?: number;
	othersSegments?: SegmentInfo[];
};

export function writeInstances(
	dg: DynamicGeometry,
	instances: SegmentRenderInstance[],
	segments: SegmentInfo[],
	opts?: WriteOptions,
): void {
	const blackFills = opts?.blackFills;
	const opacityOverride = opts?.opacityOverride;
	const dim = opts?.dimFactor ?? 1.0;
	const othersSegments = opts?.othersSegments ?? segments;

	const segCount = Math.min(instances.length, dg.maxInstances);
	const bfCount = blackFills
		? Math.min(blackFills.length, dg.maxInstances - segCount)
		: 0;
	const totalCount = segCount + bfCount;
	dg.geo.instanceCount = totalCount;

	// Write segment instances
	for (let i = 0; i < segCount; i++) {
		const inst = instances[i];
		const seg =
			inst.useOthersAtlas > 0.5
				? othersSegments[inst.segId]
				: segments[inst.segId];

		dg.posXY.setXY(i, inst.x, inst.y);
		dg.posZ.setX(i, inst.z);
		dg.size.setXY(i, inst.w, inst.h);
		const off = i * 4;
		dg.uvRect.array[off] = seg.uvRect[0];
		dg.uvRect.array[off + 1] = seg.uvRect[1];
		dg.uvRect.array[off + 2] = seg.uvRect[2];
		dg.uvRect.array[off + 3] = seg.uvRect[3];

		const op = opacityOverride?.get(inst.segId) ?? 1;
		dg.opacity.setX(i, op);
		dg.isBlackFill.setX(i, 0);
		dg.wipeRole.setX(i, inst.wipeRole);
		dg.isBboxOutline.setX(i, inst.isBboxOutline);
		dg.swipeProgress.setX(i, inst.swipeProgress);
		dg.useOthersAtlas.setX(i, inst.useOthersAtlas);
		dg.dimFactor.setX(i, dim);
	}

	// Write black fill instances after segment instances
	if (blackFills) {
		for (let i = 0; i < bfCount; i++) {
			const bf = blackFills[i];
			const idx = segCount + i;
			dg.posXY.setXY(idx, bf.x, bf.y);
			dg.posZ.setX(idx, bf.z);
			const BF_SCALE = 1.15;
			dg.size.setXY(idx, bf.w * BF_SCALE, bf.h * BF_SCALE);

			const seg =
				bf.useOthersAtlas > 0.5 ? othersSegments[bf.segId] : segments[bf.segId];
			const off = idx * 4;
			dg.uvRect.array[off] = seg.uvRect[0];
			dg.uvRect.array[off + 1] = seg.uvRect[1];
			dg.uvRect.array[off + 2] = seg.uvRect[2];
			dg.uvRect.array[off + 3] = seg.uvRect[3];

			dg.opacity.setX(idx, 1);
			dg.isBlackFill.setX(idx, 1);
			dg.wipeRole.setX(idx, 0);
			dg.isBboxOutline.setX(idx, 0);
			dg.swipeProgress.setX(idx, 0);
			dg.useOthersAtlas.setX(idx, bf.useOthersAtlas);
			dg.dimFactor.setX(idx, dim);
		}
	}

	dg.posXY.needsUpdate = true;
	dg.posZ.needsUpdate = true;
	dg.size.needsUpdate = true;
	dg.uvRect.needsUpdate = true;
	dg.opacity.needsUpdate = true;
	dg.isBlackFill.needsUpdate = true;
	dg.wipeRole.needsUpdate = true;
	dg.isBboxOutline.needsUpdate = true;
	dg.swipeProgress.needsUpdate = true;
	dg.useOthersAtlas.needsUpdate = true;
	dg.dimFactor.needsUpdate = true;
}

/** Reusable sort buffer to avoid per-frame allocation */
const sortBuffer: SegmentRenderInstance[] = [];

/** Sort instances back-to-front relative to camera for correct alpha blending */
export function sortBackToFront(
	instances: SegmentRenderInstance[],
	camera: Camera,
	viewDir: Vector3,
): SegmentRenderInstance[] {
	if (instances.length <= 1) return instances;

	camera.getWorldDirection(viewDir);
	const cx = camera.position.x;
	const cy = camera.position.y;
	const cz = camera.position.z;
	const dx = viewDir.x;
	const dy = viewDir.y;
	const dz = viewDir.z;

	sortBuffer.length = 0;
	for (let i = 0; i < instances.length; i++) {
		sortBuffer[i] = instances[i];
	}
	sortBuffer.length = instances.length;

	sortBuffer.sort((a, b) => {
		const depthA = (a.x - cx) * dx + (a.y - cy) * dy + (a.z - cz) * dz;
		const depthB = (b.x - cx) * dx + (b.y - cy) * dy + (b.z - cz) * dz;
		return depthB - depthA;
	});
	return sortBuffer;
}

// ─── Render order constants ──────────────────────────────────────────────────

const RENDER_ORDER_LAYER_STRIDE = 10;
const RENDER_ORDER_ACTIVE_OFFSET = 1;
const RENDER_ORDER_SETTLED_OFFSET = 2;

export function layerRenderOrder(
	layer: number,
	type: "active" | "settled",
): number {
	const offset =
		type === "active"
			? RENDER_ORDER_ACTIVE_OFFSET
			: RENDER_ORDER_SETTLED_OFFSET;
	return layer * RENDER_ORDER_LAYER_STRIDE + offset;
}

// ─── Per-layer mesh pool ─────────────────────────────────────────────────────

type LayerMeshPool = {
	geos: DynamicGeometry[];
	meshes: Mesh[];
};

function createLayerMeshPool(
	maxInstancesPerLayer: number,
	material: ShaderMaterial,
	layerCount: number,
): LayerMeshPool {
	const geos: DynamicGeometry[] = [];
	const meshes: Mesh[] = [];

	for (let i = 0; i < layerCount; i++) {
		const dg = createDynamicGeometry(maxInstancesPerLayer);
		const mesh = new Mesh(dg.geo, material);
		mesh.frustumCulled = false;
		mesh.renderOrder = layerRenderOrder(i + 1, "settled");
		geos.push(dg);
		meshes.push(mesh);
	}

	return { geos, meshes };
}

// ─── Props ───────────────────────────────────────────────────────────────────

/** Swipe effect parameters (noise + dimming) exposed to Leva GUI */
export type SwipeEffectParams = {
	noiseFreq: number;
	noiseAmp: number;
	noiseSpeed: number;
	dimFactor: number;
};

/** Data for a single render frame, provided by the parent */
export type FrameRenderData = {
	/** Active (animating) instances for the current layer */
	activeInstances: SegmentRenderInstance[];
	/** Segments to use for active instances (determines atlas UVs) */
	activeSegments: SegmentInfo[];
	/** Base layer instances (layer 0) */
	baseInstances: SegmentRenderInstance[];
	/** Segments for the base layer */
	baseSegments: SegmentInfo[];
	/** Settled instances grouped by layer index (1-based) */
	settledByLayer: Map<number, SegmentRenderInstance[]>;
	/** Active black fills (current swap) */
	activeBlackFills: BlackFillRenderInstance[];
	/** Committed black fills by layer */
	committedBlackFills: Map<number, BlackFillRenderInstance[]>;
	/** Current layer number */
	currentLayer: number;
	/** Segments to use per settled layer (layer >= contentStartLayer uses merged) */
	getSegmentsForLayer: (layer: number) => SegmentInfo[];
	/** Dim factor for non-active meshes */
	dimFactor: number;
	/** Global opacity for active instances (0..1, used for fade-out) */
	activeOpacity?: number;
};

type SegmentMeshRendererProps = {
	/** Maximum number of segments */
	maxSegments: number;
	/** Number of layers (excluding base) */
	layerCount: number;
	/** Atlas texture for layout segments */
	atlasTexture: Texture;
	/** Atlas texture for "others" content (optional) */
	othersAtlasTexture?: Texture;
	/** Called each frame to get render data */
	getRenderData: () => FrameRenderData;
	/** Swipe effect parameters */
	swipeEffect?: SwipeEffectParams;
};

// ─── Component ───────────────────────────────────────────────────────────────

export function SegmentMeshRenderer({
	maxSegments,
	layerCount,
	atlasTexture,
	othersAtlasTexture,
	getRenderData,
	swipeEffect,
}: SegmentMeshRendererProps) {
	const { camera } = useThree();
	const viewDirRef = useRef(new Vector3());

	const maxPerLayer = maxSegments * 2;

	const { baseGeo, activeGeo, material, settledPool } = useMemo(() => {
		const bg = createDynamicGeometry(maxSegments * 2);
		const ag = createDynamicGeometry(maxSegments);
		const mat = createSegmentMaterial(atlasTexture, othersAtlasTexture);
		const pool = createLayerMeshPool(maxPerLayer, mat, layerCount);
		return {
			baseGeo: bg,
			activeGeo: ag,
			material: mat,
			settledPool: pool,
		};
	}, [atlasTexture, othersAtlasTexture, layerCount, maxPerLayer, maxSegments]);

	const baseMeshRef = useRef<Mesh>(new Mesh(baseGeo.geo, material));
	const activeMeshRef = useRef<Mesh>(new Mesh(activeGeo.geo, material));

	useEffect(() => {
		baseMeshRef.current.geometry = baseGeo.geo;
		baseMeshRef.current.material = material;
		baseMeshRef.current.renderOrder = 0;

		activeMeshRef.current.geometry = activeGeo.geo;
		activeMeshRef.current.material = material;

		return () => {
			baseGeo.geo.dispose();
			activeGeo.geo.dispose();
			material.dispose();
			for (const geo of settledPool.geos) geo.geo.dispose();
		};
	}, [baseGeo, activeGeo, material, settledPool]);

	useFrame((_, delta) => {
		// Update shader uniforms
		material.uniforms.uTime.value += delta;
		if (swipeEffect) {
			material.uniforms.uNoiseFreq.value = swipeEffect.noiseFreq;
			material.uniforms.uNoiseAmp.value = swipeEffect.noiseAmp;
			material.uniforms.uNoiseSpeed.value = swipeEffect.noiseSpeed;
		}

		const data = getRenderData();

		activeMeshRef.current.renderOrder = layerRenderOrder(
			data.currentLayer,
			"active",
		);

		// Sort and write active instances
		const sortedActive = sortBackToFront(
			data.activeInstances,
			camera,
			viewDirRef.current,
		);
		const activeOp = data.activeOpacity ?? 1;
		let activeOpacityMap: Map<number, number> | undefined;
		if (activeOp < 1) {
			activeOpacityMap = new Map();
			for (const inst of sortedActive) {
				activeOpacityMap.set(inst.segId, activeOp);
			}
		}
		writeInstances(activeGeo, sortedActive, data.baseSegments, {
			opacityOverride: activeOpacityMap,
			othersSegments: data.getSegmentsForLayer(data.currentLayer),
		});

		// Group active black fills by sourceLayer
		const activeBfByLayer = new Map<number, BlackFillRenderInstance[]>();
		for (const bf of data.activeBlackFills) {
			let arr = activeBfByLayer.get(bf.sourceLayer);
			if (!arr) {
				arr = [];
				activeBfByLayer.set(bf.sourceLayer, arr);
			}
			arr.push(bf);
		}

		// Write base mesh (layer 0)
		{
			let layer0BlackFills = data.committedBlackFills.get(0);
			const activeBf0 = activeBfByLayer.get(0);
			if (activeBf0 && activeBf0.length > 0) {
				layer0BlackFills = layer0BlackFills
					? [...layer0BlackFills, ...activeBf0]
					: activeBf0;
			}
			let baseOpacityMap: Map<number, number> | undefined;
			if (activeOp < 1) {
				baseOpacityMap = new Map();
				for (const inst of data.baseInstances) {
					baseOpacityMap.set(inst.segId, activeOp);
				}
			}
			writeInstances(baseGeo, data.baseInstances, data.baseSegments, {
				blackFills: layer0BlackFills,
				dimFactor: data.dimFactor,
				opacityOverride: baseOpacityMap,
				othersSegments: data.getSegmentsForLayer(data.currentLayer),
			});
		}

		// Write settled meshes per layer
		for (let i = 0; i < layerCount; i++) {
			const layerIdx = i + 1;
			const layerInstances = data.settledByLayer.get(layerIdx) ?? [];
			const sorted = sortBackToFront(
				layerInstances,
				camera,
				viewDirRef.current,
			);

			let layerBlackFills = data.committedBlackFills.get(layerIdx);
			const activeBfForLayer = activeBfByLayer.get(layerIdx);
			if (activeBfForLayer && activeBfForLayer.length > 0) {
				layerBlackFills = layerBlackFills
					? [...layerBlackFills, ...activeBfForLayer]
					: activeBfForLayer;
			}

			writeInstances(
				settledPool.geos[i],
				sorted,
				data.getSegmentsForLayer(layerIdx),
				{
					blackFills: layerBlackFills,
					dimFactor: data.dimFactor,
					othersSegments: data.getSegmentsForLayer(layerIdx),
				},
			);
			settledPool.meshes[i].renderOrder = layerRenderOrder(layerIdx, "settled");
		}
	});

	return (
		<>
			<primitive object={baseMeshRef.current} frustumCulled={false} />
			<primitive object={activeMeshRef.current} frustumCulled={false} />
			{settledPool.meshes.map((mesh) => (
				<primitive key={mesh.uuid} object={mesh} />
			))}
		</>
	);
}
