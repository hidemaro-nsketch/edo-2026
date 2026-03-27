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
	segments: SegmentInfo[],
	config: ShuffleConfig,
	layer: number,
): SegmentRenderInstance[] {
	const swaps = plan.swapsByLayer[layer] ?? [];
	if (swaps.length === 0) return [];

	const mapping = plan.mappingByLayer[layer];
	const useOthersAtlas = getAtlasSelectionForLayer(layer, config);
	const instances: SegmentRenderInstance[] = [];

	for (const [slotA, slotB] of swaps) {
		for (const slot of [slotA, slotB]) {
			const segId = mapping[slot];
			const [x, y] = getSlotWorldPos(segments, slot);
			const [slotW, slotH] = getSlotWorldSize(segments, slot);
			const [w, h] = getSegmentContainedSize(
				segments,
				segId,
				slotW,
				slotH,
				useOthersAtlas,
			);

			instances.push({
				segId,
				x,
				y,
				z: layer * config.layerSpacing,
				w,
				h,
				useOthersAtlas,
				wipeRole: 0,
				isBboxOutline: 0,
				swipeProgress: 0,
			});
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
	config: ShuffleConfig,
	layer: number,
	swipeProgress: number,
): SegmentRenderInstance[] {
	const legs = plan.legsByLayer[layer] ?? [];
	const prevMapping = plan.mappingByLayer[layer - 1] ?? [];
	const useOthersAtlas = getAtlasSelectionForLayer(layer, config);
	const instances: SegmentRenderInstance[] = [];

	for (const leg of legs) {
		if (leg.mode === "pass") continue;

		const oldSegId = prevMapping[leg.destSlot];
		if (oldSegId === leg.segId || swipeProgress >= 1) {
			instances.push({
				segId: leg.segId,
				x: leg.to[0],
				y: leg.to[1],
				z: leg.to[2],
				w: leg.toSize[0],
				h: leg.toSize[1],
				useOthersAtlas,
				wipeRole: 0,
				isBboxOutline: 0,
				swipeProgress: 0,
			});
			continue;
		}

		instances.push({
			segId: oldSegId,
			x: leg.to[0],
			y: leg.to[1],
			z: leg.to[2],
			w: leg.toSize[0],
			h: leg.toSize[1],
			useOthersAtlas: getAtlasSelectionForLayer(layer - 1, config),
			wipeRole: 1,
			isBboxOutline: 0,
			swipeProgress,
		});
		instances.push({
			segId: leg.segId,
			x: leg.to[0],
			y: leg.to[1],
			z: leg.to[2],
			w: leg.toSize[0],
			h: leg.toSize[1],
			useOthersAtlas,
			wipeRole: 2,
			isBboxOutline: 0,
			swipeProgress,
		});
	}

	return instances;
}

export function buildFlashRenderInstancesForLayer(
	plan: CompiledPlan,
	config: ShuffleConfig,
	layer: number,
): SegmentRenderInstance[] {
	const useOthersAtlas = getAtlasSelectionForLayer(layer, config);
	return (plan.legsByLayer[layer] ?? [])
		.filter((leg) => leg.mode === "settle")
		.map((leg) => ({
			segId: leg.segId,
			x: leg.to[0],
			y: leg.to[1],
			z: leg.to[2],
			w: leg.toSize[0],
			h: leg.toSize[1],
			useOthersAtlas,
			wipeRole: 0,
			isBboxOutline: 1,
			swipeProgress: 0,
		}));
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
	config: ShuffleConfig,
	collapsingLayer: number,
	progress: number,
): SegmentRenderInstance[] {
	const instances: SegmentRenderInstance[] = [];
	const animatingSegIds = new Set<number>();

	const collapseLegs = plan.legsByLayer[collapsingLayer] ?? [];
	for (const leg of collapseLegs) {
		const lifecycle = plan.lifecycles[leg.segId];
		if (lifecycle.settleLayer > collapsingLayer) continue;
		animatingSegIds.add(leg.segId);
		instances.push(interpolateLegReverse(leg, progress, config));
	}

	for (const lifecycle of plan.lifecycles) {
		if (lifecycle.settleLayer >= collapsingLayer) continue;
		if (animatingSegIds.has(lifecycle.segId)) continue;
		const settledLeg = lifecycle.legs.find(
			(leg) => leg.toLayer === lifecycle.settleLayer,
		);
		if (!settledLeg) continue;
		instances.push({
			segId: lifecycle.segId,
			x: settledLeg.to[0],
			y: settledLeg.to[1],
			z: settledLeg.to[2],
			w: settledLeg.toSize[0],
			h: settledLeg.toSize[1],
			useOthersAtlas: getAtlasSelectionForLayer(lifecycle.settleLayer, config),
			wipeRole: 0,
			isBboxOutline: 0,
			swipeProgress: 0,
		});
	}

	return instances;
}

function getSegmentContainedSize(
	segments: SegmentInfo[],
	segId: number,
	slotW: number,
	slotH: number,
	useOthersAtlas: number,
): [number, number] {
	if (useOthersAtlas === 0) {
		return [slotW, slotH];
	}

	const seg = segments[segId];
	return computeContainedSize(
		seg.trimmedSize[0],
		seg.trimmedSize[1],
		slotW,
		slotH,
	);
}

function interpolateLegReverse(
	leg: CompiledPlan["legsByLayer"][number][number],
	t: number,
	config: ShuffleConfig,
): SegmentRenderInstance {
	return {
		segId: leg.segId,
		x: leg.to[0] + (leg.from[0] - leg.to[0]) * t,
		y: leg.to[1] + (leg.from[1] - leg.to[1]) * t,
		z: leg.to[2] + (leg.from[2] - leg.to[2]) * t,
		w: leg.toSize[0] + (leg.fromSize[0] - leg.toSize[0]) * t,
		h: leg.toSize[1] + (leg.fromSize[1] - leg.toSize[1]) * t,
		useOthersAtlas: getAtlasSelectionForLayer(leg.toLayer, config),
		wipeRole: 0,
		isBboxOutline: 0,
		swipeProgress: 0,
	};
}
