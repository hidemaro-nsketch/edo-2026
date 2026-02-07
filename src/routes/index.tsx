import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { DoubleSide } from "three";
import { OrbitControls as ThreeOrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export const Route = createFileRoute("/")({ component: App });

type LayerConfig = {
	z: number;
	seed: number;
	hueShift: number;
	hiddenThreshold: number;
};

const layers: LayerConfig[] = [
	{ z: 0, seed: 0.7, hueShift: 0.03, hiddenThreshold: 0.36 },
	{ z: -0.9, seed: 1.9, hueShift: 0.17, hiddenThreshold: 0.42 },
	{ z: -1.8, seed: 3.1, hueShift: 0.33, hiddenThreshold: 0.49 },
	{ z: -2.7, seed: 4.3, hueShift: 0.52, hiddenThreshold: 0.56 },
	{ z: -3.6, seed: 5.4, hueShift: 0.71, hiddenThreshold: 0.62 },
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

  float visibleCell = step(uHiddenThreshold, hash11(id * 7.13 + floor(uSeed * 13.0)));

  float hue = fract(hash11(id * 5.37 + 2.11 + uHueShift * 10.0) + uHueShift);
  vec3 fill = hsv2rgb(vec3(hue, 0.7, 0.95));
  float vignette = smoothstep(0.85, 0.15, nearest);
  fill *= mix(0.7, 1.05, vignette);

  vec3 color = fill;
  // Keep only per-cell holes.
  float alpha = visibleCell;

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
}: LayerConfig) {
	const uniforms = useMemo(
		() => ({
			uSeed: { value: seed },
			uHueShift: { value: hueShift },
			uHiddenThreshold: { value: hiddenThreshold },
		}),
		[hiddenThreshold, hueShift, seed],
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
			<CameraControls />
			{layers.map((layer) => (
				<DepthVoronoiPlane
					key={`${layer.seed}-${layer.z}`}
					z={layer.z}
					seed={layer.seed}
					hueShift={layer.hueShift}
					hiddenThreshold={layer.hiddenThreshold}
				/>
			))}
		</>
	);
}

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

function App() {
	return (
		<div className="h-[calc(100vh-72px)] min-h-[520px]">
			<Canvas camera={{ position: [0, 0, 5.8], fov: 44 }}>
				<Scene />
			</Canvas>
		</div>
	);
}
