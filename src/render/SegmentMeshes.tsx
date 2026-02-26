import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import {
  CustomBlending,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  type Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PlaneGeometry,
  ShaderMaterial,
  type Texture,
} from "three";
import type { BuildSystem, SegmentInstance } from "../layered-shuffle/build-system";
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

varying vec2 vUv;
varying vec4 vUvRect;
varying float vOpacity;

void main() {
  vUv = uv;
  vUvRect = aUvRect;
  vOpacity = aOpacity;

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

uniform sampler2D uAtlas;

void main() {
  vec2 flippedUv = vec2(vUv.x, 1.0 - vUv.y);
  vec2 atlasUv = vUvRect.xy + flippedUv * vUvRect.zw;
  vec4 color = texture2D(uAtlas, atlasUv);

  if (color.a < 0.1) discard;

  float edgeAlpha = smoothstep(0.1, 0.3, color.a);
  float finalOpacity = edgeAlpha * vOpacity;
  gl_FragColor = vec4(color.rgb * finalOpacity, color.a * finalOpacity);
}
`;

// ─── Shared material ─────────────────────────────────────────────────────────

function createMaterial(atlas: Texture): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: { uAtlas: { value: atlas } },
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
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

  geo.setAttribute("aPosition", posXY);
  geo.setAttribute("aPositionZ", posZ);
  geo.setAttribute("aSize", size);
  geo.setAttribute("aUvRect", uvRect);
  geo.setAttribute("aOpacity", opacity);
  geo.instanceCount = 0;

  return { geo, posXY, posZ, size, uvRect, opacity, maxInstances };
}

function writeInstances(
  dg: DynamicGeometry,
  instances: SegmentInstance[],
  segments: SegmentInfo[],
  opacityOverride?: Map<number, number>,
): void {
  const count = Math.min(instances.length, dg.maxInstances);
  dg.geo.instanceCount = count;

  for (let i = 0; i < count; i++) {
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
  }

  dg.posXY.needsUpdate = true;
  dg.posZ.needsUpdate = true;
  dg.size.needsUpdate = true;
  dg.uvRect.needsUpdate = true;
  dg.opacity.needsUpdate = true;
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
    });
  }

  writeInstances(dg, instances, segments);
  return dg;
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
  const baseMeshRef = useRef<Mesh>(null);
  const activeMeshRef = useRef<Mesh>(null);
  const settledMeshRef = useRef<Mesh>(null);

  const { baseGeo, activeGeo, settledGeo, material } = useMemo(() => {
    const bg = buildBaseGeometry(segments);
    // Max active: all segments can be in flight
    const ag = createDynamicGeometry(segments.length);
    // Max settled: all segments across all layers
    const sg = createDynamicGeometry(segments.length * 12);
    const mat = createMaterial(atlasTexture);
    return { baseGeo: bg, activeGeo: ag, settledGeo: sg, material: mat };
  }, [segments, atlasTexture]);

  useFrame((_, delta) => {
    buildSystem.update(delta);

    // Update active instances
    const activeInstances = buildSystem.getActiveInstances();
    writeInstances(activeGeo, activeInstances, segments);

    // Update settled instances
    const settledInstances = buildSystem.getSettledInstances();
    writeInstances(settledGeo, settledInstances, segments, buildSystem.settledOpacity);
  });

  return (
    <>
      {/* Base mesh: layer 0, always visible */}
      <mesh ref={baseMeshRef} frustumCulled={false}>
        <primitive object={baseGeo.geo} attach="geometry" />
        <primitive object={material} attach="material" />
      </mesh>

      {/* Active mesh: flying segments */}
      <mesh ref={activeMeshRef} frustumCulled={false}>
        <primitive object={activeGeo.geo} attach="geometry" />
        <primitive object={material} attach="material" />
      </mesh>

      {/* Settled mesh: segments at their final positions */}
      <mesh ref={settledMeshRef} frustumCulled={false}>
        <primitive object={settledGeo.geo} attach="geometry" />
        <primitive object={material} attach="material" />
      </mesh>
    </>
  );
}
