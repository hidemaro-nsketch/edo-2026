import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  Camera,
  CustomBlending,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
  type Texture,
} from "three";
import type { BlackFillInstance, BuildSystem, SegmentInstance } from "../layered-shuffle/build-system";
import { KIMONO_SIZE } from "../sakura/constants";
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
    float a = texture2D(uAtlas, atlasUv).a;
    gl_FragColor = vec4(0.0, 0.0, 0.0, a);
    return;
  }

  vec2 flippedUv = vec2(vUv.x, 1.0 - vUv.y);
  vec2 atlasUv = vUvRect.xy + flippedUv * vUvRect.zw;
  vec4 color = texture2D(uAtlas, atlasUv);

  float edgeAlpha = smoothstep(0.0, 0.3, color.a);
  float finalOpacity = edgeAlpha * vOpacity;
  gl_FragColor = vec4(color.rgb * finalOpacity, color.a * finalOpacity);
}
`;

// ─── Shared material ─────────────────────────────────────────────────────────

function createMaterial(atlas: Texture): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uAtlas: { value: atlas },
    },
    transparent: true,
    depthWrite: false,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
  });
}

// ─── Geometry helpers ────────────────────────────────────────────────────────

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

function writeInstances(
  dg: DynamicGeometry,
  instances: SegmentInstance[],
  segments: SegmentInfo[],
  blackFills?: BlackFillInstance[],
  opacityOverride?: Map<number, number>,
): void {
  const segCount = Math.min(instances.length, dg.maxInstances);
  const bfCount = blackFills
    ? Math.min(blackFills.length, dg.maxInstances - segCount)
    : 0;
  const totalCount = segCount + bfCount;
  dg.geo.instanceCount = totalCount;

  // Write segment instances
  for (let i = 0; i < segCount; i++) {
    const inst = instances[i];
    dg.posXY.setXY(i, inst.x, inst.y);
    dg.posZ.setX(i, inst.z);
    dg.size.setXY(i, inst.w, inst.h);

    const seg = segments[inst.segId];
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
      dg.size.setXY(idx, bf.w, bf.h);

      // Use the original segment's atlas UVs for shape masking
      const seg = segments[bf.segId];
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

  return [...instances].sort((a, b) => {
    const depthA = (a.x - cx) * dx + (a.y - cy) * dy + (a.z - cz) * dz;
    const depthB = (b.x - cx) * dx + (b.y - cy) * dy + (b.z - cz) * dz;
    return depthB - depthA;
  });
}

// ─── Base mesh (static layer 0) ─────────────────────────────────────────────

function buildBaseGeometry(segments: SegmentInfo[]): DynamicGeometry {
  const count = segments.length;
  const dg = createDynamicGeometry(count);

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
  return dg;
}

// ─── Render order constants ──────────────────────────────────────────────────

const RENDER_ORDER_LAYER_STRIDE = 10;
const RENDER_ORDER_ACTIVE_OFFSET = 1;
const RENDER_ORDER_SETTLED_OFFSET = 2;

function layerRenderOrder(layer: number, type: "active" | "settled"): number {
  const offset = type === "active" ? RENDER_ORDER_ACTIVE_OFFSET : RENDER_ORDER_SETTLED_OFFSET;
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

type SegmentMeshesProps = {
  segments: SegmentInfo[];
  atlasTexture: Texture;
  buildSystem: BuildSystem;
};

// ─── Component ───────────────────────────────────────────────────────────────

export function SegmentMeshes({
  segments,
  atlasTexture,
  buildSystem,
}: SegmentMeshesProps) {
  const { camera } = useThree();
  const viewDirRef = useRef(new Vector3());

  const layerCount = buildSystem.config.maxGenerations;

  // Each layer pool needs space for segments + potential black fills
  const maxPerLayer = segments.length * 2;

  const { baseGeo, activeGeo, material, settledPool } = useMemo(() => {
    const bg = buildBaseGeometry(segments);
    const ag = createDynamicGeometry(segments.length);
    const mat = createMaterial(atlasTexture);
    const pool = createLayerMeshPool(maxPerLayer, mat, layerCount);
    return { baseGeo: bg, activeGeo: ag, material: mat, settledPool: pool };
  }, [segments, atlasTexture, layerCount, maxPerLayer]);

  const baseMeshRef = useRef<Mesh>(new Mesh(baseGeo.geo, material));
  const activeMeshRef = useRef<Mesh>(new Mesh(activeGeo.geo, material));

  useEffect(() => {
    baseMeshRef.current.geometry = baseGeo.geo;
    baseMeshRef.current.material = material;
    baseMeshRef.current.renderOrder = 0; // layer 0

    activeMeshRef.current.geometry = activeGeo.geo;
    activeMeshRef.current.material = material;
    // active renderOrder is updated per-frame

    return () => {
      baseGeo.geo.dispose();
      activeGeo.geo.dispose();
      material.dispose();
      for (const geo of settledPool.geos) geo.geo.dispose();
    };
  }, [baseGeo, activeGeo, material, settledPool]);

  useFrame((_, delta) => {
    buildSystem.update(delta);

    // Active instances (flying segments for current layer)
    const currentLayer = buildSystem.getCurrentLayer();
    activeMeshRef.current.renderOrder = layerRenderOrder(currentLayer, "active");

    // Settled instances + black fills grouped by layer
    const settledByLayer = buildSystem.getSettledByLayer();
    const allBlackFills = buildSystem.getBlackFillInstances();

    // Group black fills by their source layer
    const blackFillsByLayer = new Map<number, BlackFillInstance[]>();
    for (const bf of allBlackFills) {
      let arr = blackFillsByLayer.get(bf.sourceLayer);
      if (!arr) {
        arr = [];
        blackFillsByLayer.set(bf.sourceLayer, arr);
      }
      arr.push(bf);
    }

    // Active instances — include current layer's black fills during flash/swipe
    const activeInstances = sortBackToFront(
      buildSystem.getActiveInstances(),
      camera,
      viewDirRef.current,
    );
    const activeBlackFills = blackFillsByLayer.get(currentLayer);
    writeInstances(activeGeo, activeInstances, segments, activeBlackFills);

    for (let i = 0; i < layerCount; i++) {
      const layerIdx = i + 1; // layers 1..maxGenerations
      const layerInstances = settledByLayer.get(layerIdx) ?? [];
      const sorted = sortBackToFront(layerInstances, camera, viewDirRef.current);
      // Don't double-render black fills already shown in active mesh
      const layerBlackFills = layerIdx === currentLayer ? undefined : blackFillsByLayer.get(layerIdx);
      writeInstances(settledPool.geos[i], sorted, segments, layerBlackFills);
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
