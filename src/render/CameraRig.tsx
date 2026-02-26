import { useFrame, useThree } from "@react-three/fiber";
import { useRef } from "react";
import { Vector3, MathUtils, OrthographicCamera } from "three";

// Module-level constants to avoid per-frame allocation
// Y offset to center on top half of kimono (KIMONO_SIZE / 4 = 1.3)
const Y_CENTER_OFFSET = 1.3;
const TOP_DOWN_POSITION = new Vector3(0, Y_CENTER_OFFSET, 50);
const OBLIQUE_POSITION = new Vector3(2, 2 + Y_CENTER_OFFSET,4);
const TOP_DOWN_LOOK_AT = new Vector3(0, Y_CENTER_OFFSET, 0);

// Zoom levels for orthographic camera
const TOP_DOWN_ZOOM = 200;
const OBLIQUE_ZOOM = 80;

// Damping rate: higher = faster convergence
const DAMP_RATE = 3;

type CameraRigProps = {
  currentGen: number;
  maxGenerations: number;
  layerSpacing: number;
  enabled?: boolean;
  /** Optional ref that overrides currentGen prop on every frame */
  currentGenRef?: React.RefObject<number>;
};

/**
 * Automated camera rig that transitions from top-down to oblique view
 * based on the current shuffle generation progress.
 *
 * Uses OrthographicCamera so layers at different Z positions
 * overlap perfectly when viewed top-down.
 *
 * - Gen 0..(maxGenerations-1): top-down (looking straight down Z)
 * - Gen (maxGenerations-1)..maxGenerations: smooth transition to oblique angle
 */
export function CameraRig({
  currentGen,
  maxGenerations,
  layerSpacing,
  enabled = true,
  currentGenRef,
}: CameraRigProps): null {
  const { camera } = useThree();

  // Persistent scratch vectors (never reallocated)
  const targetPos = useRef(new Vector3());
  const targetLookAt = useRef(new Vector3());
  const currentLookAt = useRef(new Vector3(0, 0, 0));
  const obliqueLookAt = useRef(new Vector3());
  const currentZoom = useRef(TOP_DOWN_ZOOM);

  useFrame((_, delta) => {
    if (!enabled) return;

    // Use ref value if available (bypasses React render cycle)
    const gen = currentGenRef?.current ?? currentGen;

    // Camera starts moving at maxGenerations - 1
    const cameraRevealGen = maxGenerations - 1;
    const revealRange = maxGenerations - cameraRevealGen;
    const rawT =
      revealRange > 0
        ? MathUtils.clamp(
            (gen - cameraRevealGen) / revealRange,
            0,
            1,
          )
        : 0;
    // Smoothstep: 3t^2 - 2t^3
    const t = rawT * rawT * (3 - 2 * rawT);

    // Oblique lookAt targets the vertical center of the layer stack
    obliqueLookAt.current.set(0, 0, gen * layerSpacing * 0.5);

    // Interpolate position and lookAt between presets
    targetPos.current.lerpVectors(TOP_DOWN_POSITION, OBLIQUE_POSITION, t);
    targetLookAt.current.lerpVectors(
      TOP_DOWN_LOOK_AT,
      obliqueLookAt.current,
      t,
    );

    // Interpolate zoom
    const targetZoom = MathUtils.lerp(TOP_DOWN_ZOOM, OBLIQUE_ZOOM, t);

    // Damped movement toward target for natural feel
    const dampFactor = 1 - Math.exp(-DAMP_RATE * delta);
    camera.position.lerp(targetPos.current, dampFactor);
    currentLookAt.current.lerp(targetLookAt.current, dampFactor);
    camera.lookAt(currentLookAt.current);

    // Update zoom for orthographic camera
    if (camera instanceof OrthographicCamera) {
      currentZoom.current = MathUtils.lerp(
        currentZoom.current,
        targetZoom,
        dampFactor,
      );
      camera.zoom = currentZoom.current;
      camera.updateProjectionMatrix();
    }
  });

  return null;
}
