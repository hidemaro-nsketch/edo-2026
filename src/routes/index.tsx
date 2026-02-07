import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { DoubleSide, type Mesh, Vector3 } from "three";
import { OrbitControls as ThreeOrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export const Route = createFileRoute("/")({ component: App });

type LayerConfig = {
	z: number;
	baseHue: number;
	hueJitter: number;
};

type DepthVoronoiPlaneProps = LayerConfig & {
	layerIndex: number;
	layerCount: number;
	patternSeed: number;
};

const layers: LayerConfig[] = [
	{ z: 0, baseHue: 0.55, hueJitter: 0.06 },
	{ z: -1.4, baseHue: 0.58, hueJitter: 0.06 },
	{ z: -2.8, baseHue: 0.61, hueJitter: 0.06 },
	{ z: -4.2, baseHue: 0.64, hueJitter: 0.06 },
	{ z: -5.6, baseHue: 0.67, hueJitter: 0.06 },
];

const layerVisibilityThreshold = 0.5;

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

uniform float uBaseHue;
uniform float uHueJitter;
uniform float uVisibilityThreshold;
uniform float uLayerIndex;
uniform float uLayerCount;
uniform float uPatternSeed;
uniform float uTime;

#define NUM_SEEDS 22
#define ANIM_FADE 0.15
#define ANIM_PEAK 0.01

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

// Signed circular distance: negative = sweep approaching, positive = sweep passed
float signedCircDist(float sweep, float phase) {
  float d = sweep - phase;
  return d - floor(d + 0.5);
}

// Animation phase for a cell/seed
float animPhase(float cellId) {
  return hash11(cellId * 3.17 + uLayerIndex * 5.3 + uPatternSeed * 2.7);
}

void main() {
  vec2 uv = vUv;
  float nearest = 1e9;
  float id = 0.0;

  float sweep = fract(uTime * 0.06);

  for (int i = 0; i < NUM_SEEDS; i++) {
    float fi = float(i);

    // Deform at appearing edge: peak in the middle of the fade-in zone
    float sd = signedCircDist(sweep, animPhase(fi));
    float transition = smoothstep(-ANIM_FADE, -ANIM_FADE * 0.5, sd)
                     * smoothstep(-ANIM_PEAK, -ANIM_FADE * 0.35, sd);

    vec2 perturbDir = vec2(hash11(fi * 7.3 + 1.1) - 0.5, hash11(fi * 11.7 + 2.3) - 0.5);
    vec2 point = 0.06 + 0.88 * hash21(fi + 19.73) + perturbDir * transition * 0.045;

    float d = distance(uv, point);

    if (d < nearest) {
      nearest = d;
      id = fi;
    }
  }

  float guaranteedLayer = floor(hash11(id * 11.17 + 0.73 + uPatternSeed * 3.1) * uLayerCount);
  float isGuaranteedLayer = 1.0 - step(0.5, abs(uLayerIndex - guaranteedLayer));
  float randomVisible = step(uVisibilityThreshold, hash11(id * 7.13 + uLayerIndex * 17.0 + 3.1 + uPatternSeed * 9.7));
  float visibleCell = max(isGuaranteedLayer, randomVisible);

  float hueOffset = (hash11(id * 5.37 + 2.11) - 0.5) * uHueJitter;
  float hue = fract(uBaseHue + hueOffset);
  vec3 fill = hsv2rgb(vec3(hue, 0.7, 0.95));
  float vignette = smoothstep(0.85, 0.15, nearest);
  fill *= mix(0.7, 1.05, vignette);

  // Visibility: symmetric fade using same window as deformation
  float sd = signedCircDist(sweep, animPhase(id));
  float animVisibility = smoothstep(ANIM_FADE, ANIM_PEAK, abs(sd));

  vec3 color = fill;
  float alpha = visibleCell * animVisibility;

  if (alpha < 0.02) {
    discard;
  }

  gl_FragColor = vec4(color, alpha);
}
`;

function DepthVoronoiPlane({
	z,
	baseHue,
	hueJitter,
	layerIndex,
	layerCount,
	patternSeed,
}: DepthVoronoiPlaneProps) {
	const meshRef = useRef<Mesh>(null);
	const worldPosition = useMemo(() => new Vector3(), []);
	const viewPosition = useMemo(() => new Vector3(), []);
	const baseViewPosition = useMemo(() => new Vector3(), []);

	const uniforms = useMemo(
		() => ({
			uBaseHue: { value: baseHue },
			uHueJitter: { value: hueJitter },
			uVisibilityThreshold: { value: layerVisibilityThreshold },
			uLayerIndex: { value: layerIndex },
			uLayerCount: { value: layerCount },
			uPatternSeed: { value: patternSeed },
			uTime: { value: 0 },
		}),
		[baseHue, hueJitter, layerCount, layerIndex, patternSeed],
	);

	useFrame(({ camera, clock }) => {
		const mesh = meshRef.current;
		if (!mesh) {
			return;
		}

		uniforms.uTime.value = clock.getElapsedTime();

		mesh.getWorldPosition(worldPosition);
		viewPosition.copy(worldPosition).applyMatrix4(camera.matrixWorldInverse);
		baseViewPosition.set(0, 0, 0).applyMatrix4(camera.matrixWorldInverse);

		const planeDepth = Math.max(0.001, -viewPosition.z);
		const baseDepth = Math.max(0.001, -baseViewPosition.z);
		const perspectiveCompensation = planeDepth / baseDepth;

		mesh.scale.set(perspectiveCompensation, perspectiveCompensation, 1);
	});

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
	const [patternSeed] = useState(() => Math.random() * 1000);

	return (
		<>
			<color attach="background" args={["#020617"]} />
			<CameraControls />
			{layers.map((layer, index) => (
				<DepthVoronoiPlane
					key={`${index}-${layer.z}`}
					z={layer.z}
					baseHue={layer.baseHue}
					hueJitter={layer.hueJitter}
					layerIndex={index}
					layerCount={layers.length}
					patternSeed={patternSeed}
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
