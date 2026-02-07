import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef } from "react";
import { DoubleSide, type Mesh, Vector3 } from "three";
import { OrbitControls as ThreeOrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export const Route = createFileRoute("/")({ component: App });

type LayerConfig = {
	z: number;
	hueShift: number;
	hiddenThreshold: number;
};

type DepthVoronoiPlaneProps = LayerConfig & {
	layerIndex: number;
	layerCount: number;
};

const layers: LayerConfig[] = [
	{ z: 0, hueShift: 0.03, hiddenThreshold: 0.36 },
	{ z: -1.4, hueShift: 0.17, hiddenThreshold: 0.42 },
	{ z: -2.8, hueShift: 0.33, hiddenThreshold: 0.49 },
	{ z: -4.2, hueShift: 0.52, hiddenThreshold: 0.56 },
	{ z: -5.6, hueShift: 0.71, hiddenThreshold: 0.62 },
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

uniform float uHueShift;
uniform float uHiddenThreshold;
uniform float uLayerIndex;
uniform float uLayerCount;

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
  float id = 0.0;

  for (int i = 0; i < NUM_SEEDS; i++) {
    float fi = float(i);
    vec2 point = 0.06 + 0.88 * hash21(fi + 19.73);
    float d = distance(uv, point);

    if (d < nearest) {
      nearest = d;
      id = fi;
    }
  }

  float guaranteedLayer = floor(hash11(id * 11.17 + 0.73) * uLayerCount);
  float isGuaranteedLayer = 1.0 - step(0.5, abs(uLayerIndex - guaranteedLayer));
  float randomVisible = step(uHiddenThreshold, hash11(id * 7.13 + uLayerIndex * 17.0 + 3.1));
  float visibleCell = max(isGuaranteedLayer, randomVisible);

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
	hueShift,
	hiddenThreshold,
	layerIndex,
	layerCount,
}: DepthVoronoiPlaneProps) {
	const meshRef = useRef<Mesh>(null);
	const worldPosition = useMemo(() => new Vector3(), []);
	const viewPosition = useMemo(() => new Vector3(), []);
	const baseViewPosition = useMemo(() => new Vector3(), []);

	useFrame(({ camera }) => {
		const mesh = meshRef.current;
		if (!mesh) {
			return;
		}

		mesh.getWorldPosition(worldPosition);
		viewPosition.copy(worldPosition).applyMatrix4(camera.matrixWorldInverse);
		baseViewPosition.set(0, 0, 0).applyMatrix4(camera.matrixWorldInverse);

		const planeDepth = Math.max(0.001, -viewPosition.z);
		const baseDepth = Math.max(0.001, -baseViewPosition.z);
		const perspectiveCompensation = planeDepth / baseDepth;

		mesh.scale.set(perspectiveCompensation, perspectiveCompensation, 1);
	});

	const uniforms = useMemo(
		() => ({
			uHueShift: { value: hueShift },
			uHiddenThreshold: { value: hiddenThreshold },
			uLayerIndex: { value: layerIndex },
			uLayerCount: { value: layerCount },
		}),
		[hiddenThreshold, hueShift, layerCount, layerIndex],
	);

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
	return (
		<>
			<color attach="background" args={["#020617"]} />
			<CameraControls />
			{layers.map((layer, index) => (
				<DepthVoronoiPlane
					key={`${index}-${layer.z}`}
					z={layer.z}
					hueShift={layer.hueShift}
					hiddenThreshold={layer.hiddenThreshold}
					layerIndex={index}
					layerCount={layers.length}
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
