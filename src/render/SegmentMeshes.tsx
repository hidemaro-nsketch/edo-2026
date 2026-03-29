/**
 * SegmentMeshes.tsx — BuildSystem-aware wrapper for SegmentMeshRenderer
 *
 * Bridges BuildSystem (animation state engine) with the generic
 * SegmentMeshRenderer by extracting instances each frame and passing
 * them as FrameRenderData.
 */

import { useFrame } from "@react-three/fiber";
import { useCallback, useRef } from "react";
import type { Texture } from "three";
import type { BuildSystem } from "../layered-shuffle/build-system";
import { buildBaseRenderInstances } from "../layered-shuffle/render-snapshot";
import type { SegmentRenderInstance } from "../layered-shuffle/types";
import type { DebugControls } from "../routes/index";
import type { SegmentInfo } from "../sakura/types";
import {
	type FrameRenderData,
	SegmentMeshRenderer,
	type SwipeEffectParams,
} from "./SegmentMeshRenderer";

// ─── Props ───────────────────────────────────────────────────────────────────

type SegmentMeshesProps = {
	segments: SegmentInfo[];
	/** Original segments with layout atlas UVs (before others merge) */
	originalSegments: SegmentInfo[];
	atlasTexture: Texture;
	/** Atlas texture for "others" content (falls back to atlasTexture if null) */
	othersAtlasTexture: Texture | null;
	/** Layer threshold: layers below this use original atlas, layers >= use others */
	contentStartLayer: number;
	buildSystem: BuildSystem;
	debugControls?: DebugControls;
	swipeEffect?: SwipeEffectParams;
};

// Re-export SwipeEffectParams for backward compatibility
export type { SwipeEffectParams } from "./SegmentMeshRenderer";

// ─── Component ───────────────────────────────────────────────────────────────

export function SegmentMeshes({
	segments,
	originalSegments,
	atlasTexture,
	othersAtlasTexture,
	buildSystem,
	debugControls,
	swipeEffect,
}: SegmentMeshesProps) {
	const currentDimRef = useRef(1.0);
	const contentStartLayer = buildSystem.config.contentStartLayer;
	const layerCount = buildSystem.config.maxGenerations;

	// Pre-compute base instances (layer 0, static)
	const baseInstancesRef = useRef<SegmentRenderInstance[]>(
		buildBaseRenderInstances(originalSegments),
	);

	// Cache for render data to avoid per-frame allocation
	const renderDataRef = useRef<FrameRenderData>({
		activeInstances: [],
		activeSegments: originalSegments,
		baseInstances: baseInstancesRef.current,
		baseSegments: originalSegments,
		settledByLayer: new Map(),
		activeBlackFills: [],
		committedBlackFills: new Map(),
		currentLayer: 1,
		getSegmentsForLayer: () => originalSegments,
		dimFactor: 1.0,
	});

	// Update BuildSystem + debug controls each frame
	useFrame((_, delta) => {
		const paused = debugControls?.pausedRef.current ?? false;
		const step = debugControls?.stepRef.current ?? false;
		const speed = debugControls?.speedRef.current ?? 1.0;

		if (paused && !step) {
			// Paused: skip update but continue rendering
		} else {
			const effectiveDelta = step ? 1 / 60 : delta * speed;
			buildSystem.update(effectiveDelta);
			if (step && debugControls) {
				debugControls.stepRef.current = false;
			}
		}

		// Update debug label
		if (debugControls) {
			const label = buildSystem.getDebugLabel();
			debugControls.debugLabelRef.current = label;
			debugControls.setMonitorRef.current({
				status: label,
				paused: debugControls.pausedRef.current,
			});
		}

		// Compute dim factor
		const phase = buildSystem.state.phase;
		const dimTarget = phase === "swipe" ? (swipeEffect?.dimFactor ?? 0.3) : 1.0;
		const DIM_FADE_SPEED = 8.0;
		currentDimRef.current +=
			(dimTarget - currentDimRef.current) *
			Math.min(1, delta * DIM_FADE_SPEED);
	});

	const getSegmentsForLayer = useCallback(
		(layer: number) =>
			layer >= contentStartLayer ? segments : originalSegments,
		[contentStartLayer, segments, originalSegments],
	);

	const getRenderData = useCallback((): FrameRenderData => {
		const currentLayer = buildSystem.getCurrentLayer();
		const data = renderDataRef.current;

		data.activeInstances = buildSystem.getActiveInstances();
		data.activeSegments =
			currentLayer >= contentStartLayer ? segments : originalSegments;
		data.baseInstances = baseInstancesRef.current;
		data.baseSegments = originalSegments;
		data.settledByLayer = buildSystem.getSettledByLayer();
		data.activeBlackFills = buildSystem.getBlackFillInstances();
		data.committedBlackFills = buildSystem.getCommittedBlackFills();
		data.currentLayer = currentLayer;
		data.getSegmentsForLayer = getSegmentsForLayer;
		data.dimFactor = currentDimRef.current;

		// Fade out during holding phase
		const fadeProgress = buildSystem.getFadeOutProgress();
		data.activeOpacity = fadeProgress > 0 ? 1 - fadeProgress : 1;

		return data;
	}, [
		buildSystem,
		segments,
		originalSegments,
		contentStartLayer,
		getSegmentsForLayer,
	]);

	return (
		<SegmentMeshRenderer
			maxSegments={segments.length}
			layerCount={layerCount}
			atlasTexture={atlasTexture}
			othersAtlasTexture={othersAtlasTexture ?? undefined}
			getRenderData={getRenderData}
			swipeEffect={swipeEffect}
		/>
	);
}
