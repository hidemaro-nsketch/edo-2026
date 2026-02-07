import { Canvas } from "@react-three/fiber";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { DoubleSide } from "three";

export const Route = createFileRoute("/")({ component: App });

type LayerConfig = {
	z: number;
	seed: number;
	hueShift: number;
	hiddenThreshold: number;
	opacity: number;
};

const layers: LayerConfig[] = [
	{ z: 0, seed: 0.7, hueShift: 0.03, hiddenThreshold: 0.36, opacity: 0.88 },
	{ z: -0.9, seed: 1.9, hueShift: 0.17, hiddenThreshold: 0.42, opacity: 0.78 },
	{ z: -1.8, seed: 3.1, hueShift: 0.33, hiddenThreshold: 0.49, opacity: 0.72 },
	{ z: -2.7, seed: 4.3, hueShift: 0.52, hiddenThreshold: 0.56, opacity: 0.66 },
	{ z: -3.6, seed: 5.4, hueShift: 0.71, hiddenThreshold: 0.62, opacity: 0.62 },
];

const vertexShader = `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = `
precision mediump float;

varying vec2 vUv;

uniform float uSeed;
uniform float uHueShift;
uniform float uHiddenThreshold;
uniform float uOpacity;

#define NUM_SEEDS 22

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

void main() {
  vec2 uv = vUv;
  float nearest = 1e9;
  float secondNearest = 1e9;
  float id = 0.0;

  for (int i = 0; i < NUM_SEEDS; i++) {
    float fi = float(i);
    vec2 point = 0.06 + 0.88 * hash21(fi + uSeed * 19.73);
    float d = distance(uv, point);

    if (d < nearest) {
      secondNearest = nearest;
      nearest = d;
      id = fi;
    } else if (d < secondNearest) {
      secondNearest = d;
    }
  }

  float edgeDistance = secondNearest - nearest;
  float cellMask = smoothstep(0.01, 0.03, edgeDistance);
  float visibleCell = step(uHiddenThreshold, hash11(id * 7.13 + floor(uSeed * 13.0)));

  float hue = fract(hash11(id * 5.37 + 2.11 + uHueShift * 10.0) + uHueShift);
  vec3 fill = hsv2rgb(vec3(hue, 0.7, 0.95));
  float vignette = smoothstep(0.85, 0.15, nearest);
  fill *= mix(0.7, 1.05, vignette);

  vec3 line = vec3(0.03, 0.05, 0.1);
  vec3 color = mix(line, fill, cellMask);
  float alpha = visibleCell * cellMask * uOpacity;

  if (alpha < 0.02) {
    discard;
  }

  gl_FragColor = vec4(color, alpha);
}
`;

function DepthVoronoiPlane({
	z,
	seed,
	hueShift,
	hiddenThreshold,
	opacity,
}: LayerConfig) {
	const uniforms = useMemo(
		() => ({
			uSeed: { value: seed },
			uHueShift: { value: hueShift },
			uHiddenThreshold: { value: hiddenThreshold },
			uOpacity: { value: opacity },
		}),
		[hiddenThreshold, hueShift, opacity, seed],
	);

	return (
		<mesh position={[0, 0, z]}>
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
	return (
		<>
			<color attach="background" args={["#020617"]} />
			{layers.map((layer) => (
				<DepthVoronoiPlane
					key={`${layer.seed}-${layer.z}`}
					z={layer.z}
					seed={layer.seed}
					hueShift={layer.hueShift}
					hiddenThreshold={layer.hiddenThreshold}
					opacity={layer.opacity}
				/>
			))}
		</>
	);
}

function App() {
	return (
		<div className="h-[calc(100vh-72px)] min-h-[520px]">
			<Canvas camera={{ position: [0, 0, 5.8], fov: 44 }}>
				<Scene />
			</Canvas>
		</div>
	);
}
