/**
 * compiled-plan.ts — Shuffle Plan Compiler
 *
 * Pre-computes the entire slot-switch sequence before any animation starts.
 * Each layer picks a small set of slots and changes their displayed segment
 * from the previous segment to a new segment while keeping the slot fixed.
 */

import { getSlotWorldPos, getSlotWorldSize } from "../sakura/constants";
import type { SegmentInfo } from "../sakura/types";
import {
	type CompiledPlan,
	getCategoryChangeSlotCount,
	getCategoryTotalLayerCount,
	getEffectiveMaxLayer,
	type SegmentLeg,
	type ShuffleConfig,
	type VacatedSlot,
} from "./types";

const DEFAULT_GROUP_KEY = "__default__";

function mulberry32(seed: number): () => number {
	let s = seed | 0;
	return () => {
		s = (s + 0x6d2b79f5) | 0;
		let t = Math.imul(s ^ (s >>> 15), 1 | s);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function shuffleInPlace(values: number[], random: () => number): void {
	for (let i = values.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[values[i], values[j]] = [values[j], values[i]];
	}
}

function getGroupKey(segment: SegmentInfo): string {
	return segment.categoryName ?? DEFAULT_GROUP_KEY;
}

function groupSlotsByCategory(segments: SegmentInfo[]): Map<string, number[]> {
	const groups = new Map<string, number[]>();
	for (let i = 0; i < segments.length; i++) {
		const catName = getGroupKey(segments[i]);
		let slots = groups.get(catName);
		if (!slots) {
			slots = [];
			groups.set(catName, slots);
		}
		slots.push(i);
	}
	return groups;
}

function buildChangedSlotsByLayer(
	mergedSegments: SegmentInfo[],
	config: ShuffleConfig,
	maxGenerations: number,
	random: () => number,
	themeCategoryName?: string,
): number[][] {
	const changedSlotsByLayer: number[][] = [[]];
	const groups = groupSlotsByCategory(mergedSegments);

	for (let layer = 1; layer <= maxGenerations; layer++) {
		const changedSlots: number[] = [];

		for (const [catName, slots] of groups) {
			if (slots.length < 2) continue;

			const startLayer = config.categoryStartLayer[catName] ?? 1;
			if (layer < startLayer) continue;

			const maxLayer = config.categoryMaxLayer[catName] ?? maxGenerations;
			if (layer > maxLayer) continue;

			const eligibleSlots = slots.filter((slot) => {
				const srcId = mergedSegments[slot].sourceImageId;
				const srcStart = config.sourceImageStartLayer[srcId] ?? 1;
				return layer >= srcStart;
			});
			if (eligibleSlots.length === 0) continue;

			const maxChange = getCategoryChangeSlotCount(config, themeCategoryName ?? catName);
			const changeCount = Math.max(1, Math.floor(random() * maxChange) + 1);
			if (changeCount <= 0) continue;

			shuffleInPlace(eligibleSlots, random);
			const picked = eligibleSlots.slice(
				0,
				Math.min(changeCount, eligibleSlots.length),
			);
			for (const slot of picked) {
				changedSlots.push(slot);
			}
		}

		changedSlots.sort((a, b) => a - b);
		changedSlotsByLayer.push(changedSlots);
	}

	return changedSlotsByLayer;
}

function pickNextSegmentId(
	currentSegId: number,
	categorySlots: number[],
	random: () => number,
): number {
	const candidatePool = categorySlots.filter(
		(candidate) => candidate !== currentSegId,
	);
	if (candidatePool.length === 0) return currentSegId;
	shuffleInPlace(candidatePool, random);
	return candidatePool[0] ?? currentSegId;
}

export function compilePlan(
	mergedSegments: SegmentInfo[],
	config: ShuffleConfig,
	seed?: number,
	originalSegments?: SegmentInfo[],
	themeCategoryName?: string,
): CompiledPlan {
	const baseSegments = originalSegments ?? mergedSegments;
	const count = mergedSegments.length;
	const categoryNames = new Set(
		mergedSegments.map((segment) => segment.categoryName),
	);
	const maxGen = getEffectiveMaxLayer(config, categoryNames);
	const random = seed != null ? mulberry32(seed) : Math.random;

	const changedSlotsByLayer = buildChangedSlotsByLayer(
		mergedSegments,
		config,
		maxGen,
		random,
		themeCategoryName,
	);
	const groups = groupSlotsByCategory(mergedSegments);

	const mappingByLayer: number[][] = [];
	mappingByLayer.push(Array.from({ length: count }, (_, i) => i));

	const legsByLayer: SegmentLeg[][] = [[]];
	const vacatedByLayer: VacatedSlot[][] = [[]];

	for (let layer = 1; layer <= maxGen; layer++) {
		const prev = [...mappingByLayer[layer - 1]];
		const layerLegs: SegmentLeg[] = [];
		const vacated: VacatedSlot[] = [];

		for (const slot of changedSlotsByLayer[layer] ?? []) {
			const currentSegId = prev[slot] ?? slot;
			const categoryName = getGroupKey(mergedSegments[slot]);
			const categorySlots = groups.get(categoryName) ?? [];
			const nextSegId = pickNextSegmentId(currentSegId, categorySlots, random);
			if (nextSegId === currentSegId) continue;

			const [x, y] = getSlotWorldPos(baseSegments, slot);
			const z = layer * config.layerSpacing;
			const [w, h] = getSlotWorldSize(baseSegments, slot);

			vacated.push({
				slotIndex: slot,
				segId: currentSegId,
				position: [x, y, (layer - 1) * config.layerSpacing],
				size: [w, h],
				sourceLayer: layer - 1,
			});

			layerLegs.push({
				segId: nextSegId,
				toLayer: layer,
				mode: "settle",
				fromSlot: slot,
				from: [x, y, z],
				to: [x, y, z],
				destSlot: slot,
			});

			prev[slot] = nextSegId;
		}
		mappingByLayer.push(prev);
		legsByLayer.push(layerLegs);
		vacatedByLayer.push(vacated);
	}

	return {
		legsByLayer,
		changedSlotsByLayer,
		mappingByLayer,
		vacatedByLayer,
		maxLayer: Math.min(
			maxGen,
			Math.max(
				...Array.from(categoryNames, (name) =>
					getCategoryTotalLayerCount(config, name),
				),
				1,
			),
		),
	};
}
