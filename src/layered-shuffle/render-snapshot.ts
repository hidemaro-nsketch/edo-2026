import {
	computeContainedSize,
	getSlotWorldPos,
	getSlotWorldSize,
	KIMONO_SIZE,
} from "../sakura/constants";
import type { SegmentInfo } from "../sakura/types";
import type {
	BlackFillRenderInstance,
	CompiledPlan,
	SegmentRenderInstance,
	ShuffleConfig,
} from "./types";

type SegmentCatalogs = {
	originalSegments: SegmentInfo[];
	mergedSegments: SegmentInfo[];
};

function getSegmentsForAtlas(
	catalogs: SegmentCatalogs,
	useOthersAtlas: number,
): SegmentInfo[] {
	return useOthersAtlas > 0
		? catalogs.mergedSegments
		: catalogs.originalSegments;
}

function getContainedSizeForSlot(
	catalogs: SegmentCatalogs,
	segId: number,
	slot: number,
	useOthersAtlas: number,
): [number, number] {
	const [slotW, slotH] = getSlotWorldSize(catalogs.originalSegments, slot);
	const seg = getSegmentsForAtlas(catalogs, useOthersAtlas)[segId];
	const contentW =
		useOthersAtlas > 0 ? seg.trimmedSize[0] : seg.bboxInSource[2];
	const contentH =
		useOthersAtlas > 0 ? seg.trimmedSize[1] : seg.bboxInSource[3];
	return computeContainedSize(contentW, contentH, slotW, slotH);
}

function buildSegmentInstanceAtSlot(
	catalogs: SegmentCatalogs,
	segId: number,
	slot: number,
	layer: number,
	config: ShuffleConfig,
	useOthersAtlas: number,
	options?: Partial<
		Pick<SegmentRenderInstance, "wipeRole" | "isBboxOutline" | "swipeProgress">
	>,
): SegmentRenderInstance {
	const [x, y] = getSlotWorldPos(catalogs.originalSegments, slot);
	const [w, h] = getContainedSizeForSlot(catalogs, segId, slot, useOthersAtlas);
	return {
		segId,
		x,
		y,
		z: layer * config.layerSpacing,
		w,
		h,
		useOthersAtlas,
		wipeRole: options?.wipeRole ?? 0,
		isBboxOutline: options?.isBboxOutline ?? 0,
		swipeProgress: options?.swipeProgress ?? 0,
	};
}

export function getAtlasSelectionForLayer(
	layer: number,
	config: ShuffleConfig,
): number {
	return layer >= config.contentStartLayer ? 1 : 0;
}

export function buildBaseRenderInstances(
	segments: SegmentInfo[],
): SegmentRenderInstance[] {
	return segments.map((seg, segId) => {
		const cx =
			(seg.bboxInSource[0] + seg.bboxInSource[2] * 0.5) / seg.originalSize[0];
		const cy =
			(seg.bboxInSource[1] + seg.bboxInSource[3] * 0.5) / seg.originalSize[1];
		const bboxW = seg.bboxInSource[2] / seg.originalSize[0];
		const bboxH = seg.bboxInSource[3] / seg.originalSize[1];

		return {
			segId,
			x: (cx - 0.5) * KIMONO_SIZE,
			y: -(cy - 0.5) * KIMONO_SIZE,
			z: 0,
			w: bboxW * KIMONO_SIZE,
			h: bboxH * KIMONO_SIZE,
			useOthersAtlas: 0,
			wipeRole: 0,
			isBboxOutline: 0,
			swipeProgress: 0,
		};
	});
}

export function buildSettledRenderInstancesForLayer(
	plan: CompiledPlan,
	originalSegments: SegmentInfo[],
	mergedSegments: SegmentInfo[],
	config: ShuffleConfig,
	layer: number,
): SegmentRenderInstance[] {
	const swaps = plan.swapsByLayer[layer] ?? [];
	if (swaps.length === 0) return [];

	const mapping = plan.mappingByLayer[layer];
	const useOthersAtlas = getAtlasSelectionForLayer(layer, config);
	const catalogs = { originalSegments, mergedSegments };
	const instances: SegmentRenderInstance[] = [];

	for (const [slotA, slotB] of swaps) {
		for (const slot of [slotA, slotB]) {
			instances.push(
				buildSegmentInstanceAtSlot(
					catalogs,
					mapping[slot],
					slot,
					layer,
					config,
					useOthersAtlas,
				),
			);
		}
	}

	return instances;
}

export function buildBlackFillRenderInstancesForLayer(
	plan: CompiledPlan,
	config: ShuffleConfig,
	layer: number,
): BlackFillRenderInstance[] {
	const vacated = plan.vacatedByLayer[layer] ?? [];
	return vacated.map((entry) => ({
		segId: entry.segId,
		x: entry.position[0],
		y: entry.position[1],
		z: entry.position[2],
		w: entry.size[0],
		h: entry.size[1],
		sourceLayer: entry.sourceLayer,
		useOthersAtlas: getAtlasSelectionForLayer(entry.sourceLayer, config),
	}));
}

export function buildSwipeRenderInstancesForLayer(
	plan: CompiledPlan,
	originalSegments: SegmentInfo[],
	mergedSegments: SegmentInfo[],
	config: ShuffleConfig,
	layer: number,
	swipeProgress: number,
): SegmentRenderInstance[] {
	const legs = plan.legsByLayer[layer] ?? [];
	const prevMapping = plan.mappingByLayer[layer - 1] ?? [];
	const nextUseOthersAtlas = getAtlasSelectionForLayer(layer, config);
	const prevUseOthersAtlas = getAtlasSelectionForLayer(layer - 1, config);
	const catalogs = { originalSegments, mergedSegments };
	const instances: SegmentRenderInstance[] = [];

	for (const leg of legs) {
		if (leg.mode === "pass") continue;

		const oldSegId = prevMapping[leg.destSlot];
		if (oldSegId == null) continue;

		if (oldSegId === leg.segId || swipeProgress >= 1) {
			instances.push(
				buildSegmentInstanceAtSlot(
					catalogs,
					leg.segId,
					leg.destSlot,
					layer,
					config,
					nextUseOthersAtlas,
				),
			);
			continue;
		}

		instances.push(
			buildSegmentInstanceAtSlot(
				catalogs,
				oldSegId,
				leg.destSlot,
				layer,
				config,
				prevUseOthersAtlas,
				{ wipeRole: 1, swipeProgress },
			),
		);
		instances.push(
			buildSegmentInstanceAtSlot(
				catalogs,
				leg.segId,
				leg.destSlot,
				layer,
				config,
				nextUseOthersAtlas,
				{ wipeRole: 2, swipeProgress },
			),
		);
	}

	return instances;
}

export function buildFlashRenderInstancesForLayer(
	plan: CompiledPlan,
	originalSegments: SegmentInfo[],
	mergedSegments: SegmentInfo[],
	config: ShuffleConfig,
	layer: number,
): SegmentRenderInstance[] {
	const useOthersAtlas = getAtlasSelectionForLayer(layer, config);
	const catalogs = { originalSegments, mergedSegments };
	return (plan.legsByLayer[layer] ?? [])
		.filter((leg) => leg.mode === "settle")
		.map((leg) =>
			buildSegmentInstanceAtSlot(
				catalogs,
				leg.segId,
				leg.destSlot,
				layer,
				config,
				useOthersAtlas,
				{ isBboxOutline: 1 },
			),
		);
}

export function buildPreCollapseFlashInstances(
	plan: CompiledPlan,
	segments: SegmentInfo[],
	config: ShuffleConfig,
	maxLayer: number,
): SegmentRenderInstance[] {
	const instances: SegmentRenderInstance[] = [];
	for (let layer = 1; layer <= maxLayer; layer++) {
		const settled = buildSettledRenderInstancesForLayer(
			plan,
			segments,
			segments,
			config,
			layer,
		);
		for (const instance of settled) {
			instances.push({ ...instance, isBboxOutline: 1 });
		}
	}
	return instances;
}

export function buildCollapseRenderInstances(
	plan: CompiledPlan,
	originalSegments: SegmentInfo[],
	mergedSegments: SegmentInfo[],
	config: ShuffleConfig,
	collapsingLayer: number,
	progress: number,
): SegmentRenderInstance[] {
	const instances: SegmentRenderInstance[] = [];
	const animatingSegIds = new Set<number>();
	const catalogs = { originalSegments, mergedSegments };

	const collapseLegs = plan.legsByLayer[collapsingLayer] ?? [];
	for (const leg of collapseLegs) {
		const lifecycle = plan.lifecycles[leg.segId];
		if (lifecycle.settleLayer > collapsingLayer) continue;
		animatingSegIds.add(leg.segId);
		instances.push(interpolateLegReverse(leg, progress, config, catalogs));
	}

	for (const lifecycle of plan.lifecycles) {
		if (lifecycle.settleLayer >= collapsingLayer) continue;
		if (animatingSegIds.has(lifecycle.segId)) continue;
		const settledLeg = lifecycle.legs.find(
			(leg) => leg.toLayer === lifecycle.settleLayer,
		);
		if (!settledLeg) continue;
		const useOthersAtlas = getAtlasSelectionForLayer(
			lifecycle.settleLayer,
			config,
		);
		instances.push(
			buildSegmentInstanceAtSlot(
				catalogs,
				lifecycle.segId,
				settledLeg.destSlot,
				lifecycle.settleLayer,
				config,
				useOthersAtlas,
			),
		);
	}

	return instances;
}

function interpolateLegReverse(
	leg: CompiledPlan["legsByLayer"][number][number],
	t: number,
	config: ShuffleConfig,
	catalogs: SegmentCatalogs,
): SegmentRenderInstance {
	const fromUseOthersAtlas = getAtlasSelectionForLayer(leg.toLayer - 1, config);
	const toUseOthersAtlas = getAtlasSelectionForLayer(leg.toLayer, config);
	const [fromW, fromH] = getContainedSizeForSlot(
		catalogs,
		leg.segId,
		leg.fromSlot,
		fromUseOthersAtlas,
	);
	const [toW, toH] = getContainedSizeForSlot(
		catalogs,
		leg.segId,
		leg.destSlot,
		toUseOthersAtlas,
	);
	return {
		segId: leg.segId,
		x: leg.to[0] + (leg.from[0] - leg.to[0]) * t,
		y: leg.to[1] + (leg.from[1] - leg.to[1]) * t,
		z: leg.to[2] + (leg.from[2] - leg.to[2]) * t,
		w: toW + (fromW - toW) * t,
		h: toH + (fromH - toH) * t,
		useOthersAtlas: toUseOthersAtlas,
		wipeRole: 0,
		isBboxOutline: 0,
		swipeProgress: 0,
	};
}
