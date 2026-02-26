import { useFrame, useThree } from "@react-three/fiber";
import { useRef } from "react";
import { Vector3, MathUtils } from "three";

// Module-level constants to avoid per-frame allocation
const TOP_DOWN_POSITION = new Vector3(0, 0, 7);
const OBLIQUE_POSITION = new Vector3(3, 2, 6);
const TOP_DOWN_LOOK_AT = new Vector3(0, 0, 0);

// Damping rate: higher = faster convergence
const DAMP_RATE = 3;

type CameraRigProps = {
  currentGen: number;
  maxGenerations: number;
  cameraRevealGen: number;
  layerSpacing: number;
  enabled?: boolean;
};

/**
 * Automated camera rig that transitions from top-down to oblique view
 * based on the current shuffle generation progress.
 *
 * - Gen 0..cameraRevealGen: top-down (looking straight down Z)
 * - Gen cameraRevealGen..maxGenerations: smooth transition to oblique angle
 */
export function CameraRig({
  currentGen,
  maxGenerations,
  cameraRevealGen,
  layerSpacing,
  enabled = true,
}: CameraRigProps): null {
  const { camera } = useThree();

  // Persistent scratch vectors (never reallocated)
  const targetPos = useRef(new Vector3());
  const targetLookAt = useRef(new Vector3());
  const currentLookAt = useRef(new Vector3(0, 0, 0));
  const obliqueLookAt = useRef(new Vector3());

  useFrame((_, delta) => {
    if (!enabled) return;

    // Compute blend factor with smoothstep
    const revealRange = maxGenerations - cameraRevealGen;
    const rawT =
      revealRange > 0
        ? MathUtils.clamp(
            (currentGen - cameraRevealGen) / revealRange,
            0,
            1,
          )
        : 0;
    // Smoothstep: 3t^2 - 2t^3
    const t = rawT * rawT * (3 - 2 * rawT);

    // Oblique lookAt targets the vertical center of the layer stack
    obliqueLookAt.current.set(0, 0, currentGen * layerSpacing * 0.5);

    // Interpolate position and lookAt between presets
    targetPos.current.lerpVectors(TOP_DOWN_POSITION, OBLIQUE_POSITION, t);
    targetLookAt.current.lerpVectors(
      TOP_DOWN_LOOK_AT,
      obliqueLookAt.current,
      t,
    );

    // Damped movement toward target for natural feel
    const dampFactor = 1 - Math.exp(-DAMP_RATE * delta);
    camera.position.lerp(targetPos.current, dampFactor);
    currentLookAt.current.lerp(targetLookAt.current, dampFactor);
    camera.lookAt(currentLookAt.current);
  });

  return null;
}
