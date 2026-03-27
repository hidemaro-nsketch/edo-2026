/**
 * SegmentMeshes.tsx — GPU Instanced Renderer
 *
 * Renders all segment quads using a single instanced draw call per mesh.
 * Three mesh layers are managed:
 *   1. Base mesh (layer 0): static original segment positions
 *   2. Active mesh: currently-animating layer (swipe transitions + black fills)
 *   3. Settled pool: one mesh per past layer (committed segments + their black fills)
 *
 * Each instance carries per-quad attributes (position, UV rect, opacity, wipe state)
 * written to GPU buffers every frame by writeInstances().
 *
 * The fragment shader handles three rendering modes:
 *   - Normal: atlas-textured segment with premultiplied alpha
 *   - Black fill: black silhouette using atlas alpha as mask
 *   - Swipe wipe: horizontal clip transition between old and new segment
 */

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  Camera,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
  type Texture,
} from "three";
import type { BlackFillInstance, BuildSystem, SegmentInstance } from "../layered-shuffle/build-system";
import { KIMONO_SIZE } from "../sakura/constants";
import type { SegmentInfo } from "../sakura/types";
import type { DebugControls } from "../routes/index";

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

varying vec2 vUv;
varying vec4 vUvRect;
varying float vOpacity;
varying float vIsBlackFill;
varying float vWipeRole;
varying float vIsBboxOutline;
varying float vSwipeProgress;

void main() {
  vUv = uv;
  vUvRect = aUvRect;
  vOpacity = aOpacity;
  vIsBlackFill = aIsBlackFill;
  vWipeRole = aWipeRole;
  vIsBboxOutline = aIsBboxOutline;
  vSwipeProgress = aSwipeProgress;

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

uniform sampler2D uAtlas;
uniform sampler2D uAtlasOthers;
uniform float uUseOthersAtlas;

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

  // Swipe clipping: use local quad UV.x (0..1)
  if (vWipeRole > 0.5) {
    float x = vUv.x;
    float p = vSwipeProgress;
    if (vWipeRole < 1.5) {
      // Old segment: keep right portion, discard left as wipe progresses
      if (x < p) discard;
    } else {
      // New segment: keep left portion, discard right
      if (x > p) discard;
    }
  }

  if (vIsBlackFill > 0.5) {
    vec2 flippedUv = vec2(vUv.x, 1.0 - vUv.y);
    vec2 atlasUv = vUvRect.xy + flippedUv * vUvRect.zw;
    float a = uUseOthersAtlas > 0.5
      ? texture2D(uAtlasOthers, atlasUv).a
      : texture2D(uAtlas, atlasUv).a;
    // Sharpen edge alpha so the fill is solidly black (no translucent fringe)
    float solidA = step(0.01, a);
    gl_FragColor = vec4(0.0, 0.0, 0.0, solidA);
    return;
  }

  vec2 flippedUv = vec2(vUv.x, 1.0 - vUv.y);
  vec2 atlasUv = vUvRect.xy + flippedUv * vUvRect.zw;
  vec4 color = uUseOthersAtlas > 0.5
    ? texture2D(uAtlasOthers, atlasUv)
    : texture2D(uAtlas, atlasUv);

  float mask = step(0.01, color.a);
  // 輝度ベースで黒/白を判定（smoothstepでアンチエイリアス）
  float lum = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  vec3 rgb = vec3(smoothstep(0.02, 0.25, lum));
  gl_FragColor = vec4(rgb, mask * vOpacity);
}
`;

// ─── Shared material ─────────────────────────────────────────────────────────

function createMaterial(atlas: Texture, othersAtlas?: Texture): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uAtlas: { value: atlas },
      uAtlasOthers: { value: othersAtlas ?? atlas },
      uUseOthersAtlas: { value: 0.0 },
    },
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
  });
}

// ─── Geometry helpers ────────────────────────────────────────────────────────
// DynamicGeometry wraps an InstancedBufferGeometry with typed accessors
// for each per-instance attribute. Instances are written each frame.

type DynamicGeometry = {
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
  maxInstances: number;
};

function createDynamicGeometry(maxInstances: number): DynamicGeometry {
  const base = new PlaneGeometry(1, 1);
  const geo = new InstancedBufferGeometry();
  geo.index = base.index;
  geo.attributes.position = base.attributes.position;
  geo.attributes.uv = base.attributes.uv;

  const posXY = new InstancedBufferAttribute(new Float32Array(maxInstances * 2), 2);
  const posZ = new InstancedBufferAttribute(new Float32Array(maxInstances), 1);
  const size = new InstancedBufferAttribute(new Float32Array(maxInstances * 2), 2);
  const uvRect = new InstancedBufferAttribute(new Float32Array(maxInstances * 4), 4);
  const opacity = new InstancedBufferAttribute(new Float32Array(maxInstances), 1);
  const isBlackFill = new InstancedBufferAttribute(new Float32Array(maxInstances), 1);
  const wipeRole = new InstancedBufferAttribute(new Float32Array(maxInstances), 1);
  const isBboxOutline = new InstancedBufferAttribute(new Float32Array(maxInstances), 1);
  const swipeProgress = new InstancedBufferAttribute(new Float32Array(maxInstances), 1);

  geo.setAttribute("aPosition", posXY);
  geo.setAttribute("aPositionZ", posZ);
  geo.setAttribute("aSize", size);
  geo.setAttribute("aUvRect", uvRect);
  geo.setAttribute("aOpacity", opacity);
  geo.setAttribute("aIsBlackFill", isBlackFill);
  geo.setAttribute("aWipeRole", wipeRole);
  geo.setAttribute("aIsBboxOutline", isBboxOutline);
  geo.setAttribute("aSwipeProgress", swipeProgress);
  geo.instanceCount = 0;

  return { geo, posXY, posZ, size, uvRect, opacity, isBlackFill, wipeRole, isBboxOutline, swipeProgress, maxInstances };
}

/**
 * Write segment instances + optional black fills into a DynamicGeometry's GPU buffers.
 * Segments come first, then black fills are appended after them.
 * Must be called every frame since instance data changes with animation.
 */
type WriteOptions = {
  blackFills?: BlackFillInstance[];
  opacityOverride?: Map<number, number>;
  /** When provided, UV data is read from this array instead of segments (for original atlas) */
  uvSegments?: SegmentInfo[];
};

function writeInstances(
  dg: DynamicGeometry,
  instances: SegmentInstance[],
  segments: SegmentInfo[],
  opts?: WriteOptions,
): void {
  const blackFills = opts?.blackFills;
  const opacityOverride = opts?.opacityOverride;
  const uvSegs = opts?.uvSegments ?? segments;

  const segCount = Math.min(instances.length, dg.maxInstances);
  const bfCount = blackFills
    ? Math.min(blackFills.length, dg.maxInstances - segCount)
    : 0;
  const totalCount = segCount + bfCount;
  dg.geo.instanceCount = totalCount;

  // Write segment instances
  for (let i = 0; i < segCount; i++) {
    const inst = instances[i];
    const seg = uvSegs[inst.segId];

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

      // Use the segment's atlas UVs for shape masking
      const seg = uvSegs[bf.segId];
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
}

/** Reusable sort buffer to avoid per-frame allocation */
let sortBuffer: SegmentInstance[] = [];

/** Sort instances back-to-front relative to camera for correct alpha blending */
function sortBackToFront(
  instances: SegmentInstance[],
  camera: Camera,
  viewDir: Vector3,
): SegmentInstance[] {
  if (instances.length <= 1) return instances;

  camera.getWorldDirection(viewDir);
  const cx = camera.position.x;
  const cy = camera.position.y;
  const cz = camera.position.z;
  const dx = viewDir.x;
  const dy = viewDir.y;
  const dz = viewDir.z;

  // Reuse buffer to avoid GC pressure
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

// ─── Base mesh (static layer 0) ─────────────────────────────────────────────
// The base layer shows all segments at their original positions in the source image.
// This never changes during animation — it's the "ground truth" reference.

function buildBaseGeometry(segments: SegmentInfo[]): { dg: DynamicGeometry; baseInstances: SegmentInstance[] } {
  const count = segments.length;
  // Allocate extra space for black fills that may be placed on layer 0
  const dg = createDynamicGeometry(count * 2);

  const instances: SegmentInstance[] = [];
  for (let i = 0; i < count; i++) {
    const seg = segments[i];
    const cx = (seg.bboxInSource[0] + seg.bboxInSource[2] * 0.5) / seg.originalSize[0];
    const cy = (seg.bboxInSource[1] + seg.bboxInSource[3] * 0.5) / seg.originalSize[1];
    const bboxW = seg.bboxInSource[2] / seg.originalSize[0];
    const bboxH = seg.bboxInSource[3] / seg.originalSize[1];

    instances.push({
      segId: i,
      x: (cx - 0.5) * KIMONO_SIZE,
      y: -(cy - 0.5) * KIMONO_SIZE,
      z: 0,
      w: bboxW * KIMONO_SIZE,
      h: bboxH * KIMONO_SIZE,
      wipeRole: 0,
      isBboxOutline: 0,
      swipeProgress: 0,
    });
  }

  writeInstances(dg, instances, segments);
  return { dg, baseInstances: instances };
}

// ─── Render order constants ──────────────────────────────────────────────────
// Each layer gets a render order band (stride=10) to ensure correct draw order.
// Within a layer, active instances draw before settled to avoid z-fighting.

const RENDER_ORDER_LAYER_STRIDE = 10;
const RENDER_ORDER_ACTIVE_OFFSET = 1;
const RENDER_ORDER_SETTLED_OFFSET = 2;

function layerRenderOrder(layer: number, type: "active" | "settled"): number {
  const offset = type === "active" ? RENDER_ORDER_ACTIVE_OFFSET : RENDER_ORDER_SETTLED_OFFSET;
  return layer * RENDER_ORDER_LAYER_STRIDE + offset;
}

// ─── Per-layer mesh pool ─────────────────────────────────────────────────────
// Pre-allocates one mesh per layer so settled segments + black fills can be
// rendered independently per layer (needed for correct render ordering).

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

type SegmentMeshesProps = {
  segments: SegmentInfo[];
  /** Original segments with layout atlas UVs (before others merge) */
  originalSegments: SegmentInfo[];
  atlasTexture: Texture;
  /** Atlas texture for "others" content (falls back to atlasTexture if null) */
  othersAtlasTexture: Texture | null;
  /** Layer threshold: layers below this use original atlas, layers >= use others */
  contentStartLayer: number;
  buildSystem: BuildSystem;
  debugControls?: DebugControls;
};

// ─── Component ───────────────────────────────────────────────────────────────

export function SegmentMeshes({
  segments,
  originalSegments,
  atlasTexture,
  othersAtlasTexture,
  contentStartLayer,
  buildSystem,
  debugControls,
}: SegmentMeshesProps) {
  const { camera } = useThree();
  const viewDirRef = useRef(new Vector3());

  const layerCount = buildSystem.config.maxGenerations;

  // Each layer pool needs space for segments + potential black fills
  const maxPerLayer = segments.length * 2;

  const { baseGeo, baseInstances, activeGeo, material, settledPool } = useMemo(() => {
    const { dg: bg, baseInstances: bi } = buildBaseGeometry(originalSegments);
    const ag = createDynamicGeometry(segments.length);
    const mat = createMaterial(atlasTexture, othersAtlasTexture ?? undefined);
    const pool = createLayerMeshPool(maxPerLayer, mat, layerCount);
    return { baseGeo: bg, baseInstances: bi, activeGeo: ag, material: mat, settledPool: pool };
  }, [segments, originalSegments, atlasTexture, othersAtlasTexture, layerCount, maxPerLayer]);

  const baseMeshRef = useRef<Mesh>(new Mesh(baseGeo.geo, material));
  const activeMeshRef = useRef<Mesh>(new Mesh(activeGeo.geo, material));

  // Track which atlas each mesh should use (set per-frame, read in onBeforeRender)
  const meshAtlasRef = useRef<Map<Mesh, number>>(new Map());

  useEffect(() => {
    baseMeshRef.current.geometry = baseGeo.geo;
    baseMeshRef.current.material = material;
    baseMeshRef.current.renderOrder = 0; // layer 0

    activeMeshRef.current.geometry = activeGeo.geo;
    activeMeshRef.current.material = material;
    // active renderOrder is updated per-frame

    // onBeforeRender: toggle uUseOthersAtlas uniform per-mesh just before draw
    const setAtlasUniform = (mesh: Mesh) => {
      const useOthers = meshAtlasRef.current.get(mesh) ?? 0;
      material.uniforms.uUseOthersAtlas.value = useOthers;
    };
    baseMeshRef.current.onBeforeRender = () => setAtlasUniform(baseMeshRef.current);
    activeMeshRef.current.onBeforeRender = () => setAtlasUniform(activeMeshRef.current);
    for (const mesh of settledPool.meshes) {
      mesh.onBeforeRender = () => setAtlasUniform(mesh);
    }

    return () => {
      baseGeo.geo.dispose();
      activeGeo.geo.dispose();
      material.dispose();
      for (const geo of settledPool.geos) geo.geo.dispose();
    };
  }, [baseGeo, activeGeo, material, settledPool]);

  // ── Per-frame update: advance animation and write GPU buffers ──
  useFrame((_, delta) => {
    // デバッグコントロール: 一時停止・ステップ実行・速度倍率
    const paused = debugControls?.pausedRef.current ?? false;
    const step = debugControls?.stepRef.current ?? false;
    const speed = debugControls?.speedRef.current ?? 1.0;

    if (paused && !step) {
      // 一時停止中（ステップ要求なし）: update をスキップするが描画は続行
    } else {
      // ステップ実行時は 1/60 秒分だけ進める、通常時は delta × speed
      const effectiveDelta = step ? 1 / 60 : delta * speed;
      buildSystem.update(effectiveDelta);
      if (step && debugControls) {
        debugControls.stepRef.current = false;
      }
    }

    // フェーズ情報を Leva Phase Monitor にリアルタイム反映
    if (debugControls) {
      const label = buildSystem.getDebugLabel();
      debugControls.debugLabelRef.current = label;
      debugControls.setMonitorRef.current({
        status: label,
        paused: debugControls.pausedRef.current,
      });
    }

    const currentLayer = buildSystem.getCurrentLayer();
    activeMeshRef.current.renderOrder = layerRenderOrder(currentLayer, "active");

    // Helper: pick UV segments array based on layer vs contentStartLayer
    const uvSegsForLayer = (layer: number) =>
      layer >= contentStartLayer ? segments : originalSegments;

    // Set atlas selection per mesh (read by onBeforeRender)
    const atlasMap = meshAtlasRef.current;
    atlasMap.set(baseMeshRef.current, 0); // base always uses original atlas
    atlasMap.set(activeMeshRef.current, currentLayer >= contentStartLayer ? 1 : 0);

    // Gather all render data from BuildSystem
    const settledByLayer = buildSystem.getSettledByLayer();
    const activeBlackFills = buildSystem.getBlackFillInstances();       // current layer's swap → placed on prev layer
    const committedBlackFills = buildSystem.getCommittedBlackFills();   // past layers' preserved fills

    // Write active mesh: currently-animating segments (no black fills here — they go on prev layer)
    const activeInstances = sortBackToFront(
      buildSystem.getActiveInstances(),
      camera,
      viewDirRef.current,
    );
    writeInstances(activeGeo, activeInstances, segments, {
      uvSegments: uvSegsForLayer(currentLayer),
    });

    // Group active black fills by their sourceLayer (each fill targets the layer
    // where the departing segment is actually rendered, not necessarily currentLayer-1)
    const activeBfByLayer = new Map<number, BlackFillInstance[]>();
    for (const bf of activeBlackFills) {
      let arr = activeBfByLayer.get(bf.sourceLayer);
      if (!arr) {
        arr = [];
        activeBfByLayer.set(bf.sourceLayer, arr);
      }
      arr.push(bf);
    }

    // Re-write base mesh (layer 0) with any black fills targeting it
    {
      let layer0BlackFills = committedBlackFills.get(0);
      const activeBf0 = activeBfByLayer.get(0);
      if (activeBf0 && activeBf0.length > 0) {
        layer0BlackFills = layer0BlackFills
          ? [...layer0BlackFills, ...activeBf0]
          : activeBf0;
      }
      writeInstances(baseGeo, baseInstances, segments, {
        blackFills: layer0BlackFills,
        uvSegments: originalSegments,
      });
    }

    // Write settled meshes: one per past layer, each with its own committed black fills.
    // Active black fills are distributed to their respective sourceLayer meshes.
    for (let i = 0; i < layerCount; i++) {
      const layerIdx = i + 1;
      const layerInstances = settledByLayer.get(layerIdx) ?? [];
      const sorted = sortBackToFront(layerInstances, camera, viewDirRef.current);

      // Merge committed black fills with active black fills for this layer
      let layerBlackFills = committedBlackFills.get(layerIdx);
      const activeBfForLayer = activeBfByLayer.get(layerIdx);
      if (activeBfForLayer && activeBfForLayer.length > 0) {
        layerBlackFills = layerBlackFills
          ? [...layerBlackFills, ...activeBfForLayer]
          : activeBfForLayer;
      }

      // Set atlas for this layer's mesh
      atlasMap.set(settledPool.meshes[i], layerIdx >= contentStartLayer ? 1 : 0);

      writeInstances(settledPool.geos[i], sorted, segments, {
        blackFills: layerBlackFills,
        uvSegments: uvSegsForLayer(layerIdx),
      });
      settledPool.meshes[i].renderOrder = layerRenderOrder(layerIdx, "settled");
    }
  });

  return (
    <>
      <primitive object={baseMeshRef.current} frustumCulled={false} />
      <primitive object={activeMeshRef.current} frustumCulled={false} />
      {settledPool.meshes.map((mesh, i) => (
        <primitive key={i} object={mesh} />
      ))}
    </>
  );
}
