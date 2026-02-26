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
  type Texture,
} from "three";
import type { LayerState } from "../layered-shuffle/types";
import { KIMONO_SIZE } from "../sakura/constants";
import type { SegmentInfo } from "../sakura/types";

// ─── Props ───────────────────────────────────────────────────────────────────

export type LayerMeshProps = {
  layer: LayerState;
  segments: SegmentInfo[];
  atlasTexture: Texture;
};

// ─── Shaders ─────────────────────────────────────────────────────────────────

const vertexShader = /* glsl */ `
precision highp float;

attribute vec2 aPosition;
attribute vec2 aSize;
attribute vec4 aUvRect;

varying vec2 vUv;
varying vec4 vUvRect;

void main() {
  vUv = uv;
  vUvRect = aUvRect;

  vec3 scaled = position * vec3(aSize, 1.0);
  vec3 worldPos = scaled + vec3(aPosition, 0.0);

  gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPos, 1.0);
}
`;

const fragmentShader = /* glsl */ `
precision highp float;

varying vec2 vUv;
varying vec4 vUvRect;

uniform sampler2D uAtlas;
uniform float uLayerOpacity;

void main() {
  vec2 flippedUv = vec2(vUv.x, 1.0 - vUv.y);
  vec2 atlasUv = vUvRect.xy + flippedUv * vUvRect.zw;
  vec4 color = texture2D(uAtlas, atlasUv);

  if (color.a < 0.1) discard;

  float edgeAlpha = smoothstep(0.1, 0.3, color.a);
  float finalOpacity = edgeAlpha * uLayerOpacity;
  gl_FragColor = vec4(color.rgb * finalOpacity, color.a * finalOpacity);
}
`;

// ─── Instance data builder ───────────────────────────────────────────────────

type InstanceArrays = {
  positions: Float32Array;
  sizes: Float32Array;
  uvRects: Float32Array;
};

function buildLayerInstances(
  segments: SegmentInfo[],
  slotToSegId: number[],
): InstanceArrays {
  const count = segments.length;
  const positions = new Float32Array(count * 2);
  const sizes = new Float32Array(count * 2);
  const uvRects = new Float32Array(count * 4);

  for (let i = 0; i < count; i++) {
    // Position and size come from the original slot segment
    const seg = segments[i];
    const cx =
      (seg.bboxInSource[0] + seg.bboxInSource[2] * 0.5) / seg.originalSize[0];
    const cy =
      (seg.bboxInSource[1] + seg.bboxInSource[3] * 0.5) / seg.originalSize[1];
    positions[i * 2] = (cx - 0.5) * KIMONO_SIZE;
    positions[i * 2 + 1] = -(cy - 0.5) * KIMONO_SIZE;

    const bboxW = seg.bboxInSource[2] / seg.originalSize[0];
    const bboxH = seg.bboxInSource[3] / seg.originalSize[1];
    sizes[i * 2] = bboxW * KIMONO_SIZE;
    sizes[i * 2 + 1] = bboxH * KIMONO_SIZE;

    // UV rect comes from the shuffled segment
    const texSeg = segments[slotToSegId[i]];
    const off = i * 4;
    uvRects[off] = texSeg.uvRect[0];
    uvRects[off + 1] = texSeg.uvRect[1];
    uvRects[off + 2] = texSeg.uvRect[2];
    uvRects[off + 3] = texSeg.uvRect[3];
  }

  return { positions, sizes, uvRects };
}

// ─── Geometry builder ────────────────────────────────────────────────────────

type GeometryResult = {
  geometry: InstancedBufferGeometry;
  positionAttr: InstancedBufferAttribute;
  sizeAttr: InstancedBufferAttribute;
  uvRectAttr: InstancedBufferAttribute;
};

function buildGeometry(
  instances: InstanceArrays,
  count: number,
): GeometryResult {
  const base = new PlaneGeometry(1, 1);
  const geo = new InstancedBufferGeometry();
  geo.index = base.index;
  geo.attributes.position = base.attributes.position;
  geo.attributes.uv = base.attributes.uv;

  const positionAttr = new InstancedBufferAttribute(instances.positions, 2);
  const sizeAttr = new InstancedBufferAttribute(instances.sizes, 2);
  const uvRectAttr = new InstancedBufferAttribute(instances.uvRects, 4);

  geo.setAttribute("aPosition", positionAttr);
  geo.setAttribute("aSize", sizeAttr);
  geo.setAttribute("aUvRect", uvRectAttr);
  geo.instanceCount = count;

  return { geometry: geo, positionAttr, sizeAttr, uvRectAttr };
}

// ─── Component ───────────────────────────────────────────────────────────────

export function LayerMesh({
  layer,
  segments,
  atlasTexture,
}: LayerMeshProps) {
  const meshRef = useRef<Mesh>(null);

  // Build instance data when layer mapping or segments change
  const { geometry, uniforms } = useMemo(() => {
    const instances = buildLayerInstances(segments, layer.slotToSegId);
    const geo = buildGeometry(instances, segments.length);

    const u = {
      uAtlas: { value: atlasTexture },
      uLayerOpacity: { value: layer.opacity },
    };

    return { geometry: geo.geometry, uniforms: u };
  }, [segments, layer.slotToSegId, atlasTexture, layer.opacity]);

  // Update opacity uniform each frame
  useFrame(() => {
    uniforms.uLayerOpacity.value = layer.opacity;
  });

  if (!layer.alive) {
    return null;
  }

  return (
    <mesh ref={meshRef} position={[0, 0, layer.z]} frustumCulled={false}>
      <primitive object={geometry} attach="geometry" />
      <shaderMaterial
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        side={DoubleSide}
        blending={CustomBlending}
        blendSrc={OneFactor}
        blendDst={OneMinusSrcAlphaFactor}
      />
    </mesh>
  );
}
