import type { SegmentInfo } from "./types";

/** Visible area in world units (matches kimono background) */
export const KIMONO_SIZE = 5.2;

/**
 * Compute the world-space XY position for a given slot index
 * based on the segment's bounding box center in the source image.
 */
export function getSlotWorldPos(
	segments: SegmentInfo[],
	slotIndex: number,
): [number, number] {
	const seg = segments[slotIndex];
	const cx =
		(seg.bboxInSource[0] + seg.bboxInSource[2] * 0.5) / seg.originalSize[0];
	const cy =
		(seg.bboxInSource[1] + seg.bboxInSource[3] * 0.5) / seg.originalSize[1];
	return [(cx - 0.5) * KIMONO_SIZE, -(cy - 0.5) * KIMONO_SIZE];
}

/**
 * Compute the world-space width/height for a given slot index.
 */
export function getSlotWorldSize(
	segments: SegmentInfo[],
	slotIndex: number,
): [number, number] {
	const seg = segments[slotIndex];
	const bboxW = seg.bboxInSource[2] / seg.originalSize[0];
	const bboxH = seg.bboxInSource[3] / seg.originalSize[1];
	return [bboxW * KIMONO_SIZE, bboxH * KIMONO_SIZE];
}
