import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  Camera,
  CustomBlending,
  DoubleSide,
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
  const { camera } = useThree();
  const viewDirRef = useRef(new Vector3());

  const { baseGeo, activeGeo, settledGeo, material } = useMemo(() => {
    const bg = buildBaseGeometry(segments);
    const ag = createDynamicGeometry(segments.length);
    const sg = createDynamicGeometry(segments.length * 12);
    const mat = createMaterial(atlasTexture);
    return { baseGeo: bg, activeGeo: ag, settledGeo: sg, material: mat };
  }, [segments, atlasTexture]);

  // Create meshes imperatively to avoid R3F v9 <primitive> issues
  const baseMeshRef = useRef<Mesh>(new Mesh(baseGeo.geo, material));
  const activeMeshRef = useRef<Mesh>(new Mesh(activeGeo.geo, material));
  const settledMeshRef = useRef<Mesh>(new Mesh(settledGeo.geo, material));

  useEffect(() => {
    baseMeshRef.current.geometry = baseGeo.geo;
    baseMeshRef.current.material = material;
    activeMeshRef.current.geometry = activeGeo.geo;
    activeMeshRef.current.material = material;
    settledMeshRef.current.geometry = settledGeo.geo;
    settledMeshRef.current.material = material;
  }, [baseGeo, activeGeo, settledGeo, material]);

  useFrame((_, delta) => {
    buildSystem.update(delta);

    const activeInstances = sortBackToFront(
      buildSystem.getActiveInstances(),
      camera,
      viewDirRef.current,
    );
    writeInstances(activeGeo, activeInstances, segments);

    const settledInstances = sortBackToFront(
      buildSystem.getSettledInstances(),
      camera,
      viewDirRef.current,
    );
    writeInstances(settledGeo, settledInstances, segments);
  });

  return (
    <>
      <primitive object={baseMeshRef.current} frustumCulled={false} />
      <primitive object={activeMeshRef.current} frustumCulled={false} />
      <primitive object={settledMeshRef.current} frustumCulled={false} />
    </>
  );
}
