/**
 * compiled-plan.ts — Shuffle Plan Compiler
 *
 * Pre-computes the entire shuffle sequence before any animation starts.
 * The output (CompiledPlan) contains everything the BuildSystem needs
 * to drive the layer-by-layer animation without any runtime randomness.
 *
 * Pipeline:
 *   1. Generate swap pairs per layer (category-aware, staggered start)
 *   2. Build cumulative slot→segment mappings per layer
 *   3. Determine each segment's "settle layer" (first swap participation)
 *   4. Build flight legs (from/to positions) for every segment at every layer
 *   5. Build vacated slot records for black fill rendering
 */

import { getSlotWorldPos, getSlotWorldSize } from "../sakura/constants";
import type { SegmentInfo } from "../sakura/types";
import {
	getEffectiveMaxLayer,
	type CompiledPlan,
	type SegmentLeg,
	type SegmentLifecycle,
	type ShuffleConfig,
	type SwapPair,
	type VacatedSlot,
} from "./types";

// ─── Seeded PRNG (mulberry32) ────────────────────────────────────────────────

/** Simple seeded 32-bit PRNG. Returns a function that produces [0, 1) on each call. */
function mulberry32(seed: number): () => number {
	let s = seed | 0;
	return () => {
		s = (s + 0x6d2b79f5) | 0;
		let t = Math.imul(s ^ (s >>> 15), 1 | s);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Check if two slots' bounding boxes overlap in the source image.
 * Overlapping slots cannot be swapped (their visuals would collide).
 */
function slotsOverlap(
	segments: SegmentInfo[],
	slotA: number,
	slotB: number,
): boolean {
	const a = segments[slotA].bboxInSource;
	const b = segments[slotB].bboxInSource;

	const ax1 = a[0];
	const ay1 = a[1];
	const ax2 = a[0] + a[2];
	const ay2 = a[1] + a[3];

	const bx1 = b[0];
	const by1 = b[1];
	const bx2 = b[0] + b[2];
	const by2 = b[1] + b[3];

	return ax1 < bx2 && ax2 > bx1 && ay1 < by2 && ay2 > by1;
}

/**
 * Group slot indices by categoryId (e.g. sakura=0, leaf=1, flower=2).
 * Used to ensure swaps only happen within the same category.
 */
function groupByCategory(segments: SegmentInfo[]): Map<number, number[]> {
	const groups = new Map<number, number[]>();
	for (let i = 0; i < segments.length; i++) {
		const catId = segments[i].categoryId;
		let arr = groups.get(catId);
		if (!arr) {
			arr = [];
			groups.set(catId, arr);
		}
		arr.push(i);
	}
	return groups;
}

/**
 * Generate swap pairs for a given generation.
 * Swaps only occur between segments of the same category.
 * Each category starts swapping at its configured layer threshold.
 * One swap per category per layer. No slot appears in more than one pair.
 */
function generateSwapPairs(
	gen: number,
	segments: SegmentInfo[],
	categoryStartLayer: Record<string, number>,
	sourceImageStartLayer: Record<string, number>,
	categoryMaxLayer: Record<string, number>,
	maxGenerations: number,
	random: () => number = Math.random,
): SwapPair[] {
	const SWAPS_PER_CATEGORY = 2;
	const categoryGroups = groupByCategory(segments);

	const used = new Set<number>();
	const pairs: SwapPair[] = [];

	for (const [, slots] of categoryGroups) {
		const catName = segments[slots[0]].categoryName;
		const startLayer = categoryStartLayer[catName] ?? 1;
		if (gen < startLayer) continue;

		// Skip if this category has exceeded its max layer
		const catMaxLayer = categoryMaxLayer[catName] ?? maxGenerations;
		if (gen > catMaxLayer) continue;

		// Filter slots by sourceImageStartLayer: exclude segments whose
		// sourceImageId hasn't started participating yet at this layer
		const eligibleSlots = slots.filter((slot) => {
			const srcId = segments[slot].sourceImageId;
			const srcStart = sourceImageStartLayer[srcId] ?? 1;
			return gen >= srcStart;
		});
		if (eligibleSlots.length < 2) continue;

		// Shuffle slots for randomness
		const shuffled = [...eligibleSlots];
		for (let i = shuffled.length - 1; i > 0; i--) {
			const j = Math.floor(random() * (i + 1));
			[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
		}

		let count = 0;
		for (let i = 0; i < shuffled.length && count < SWAPS_PER_CATEGORY; i++) {
			const slotA = shuffled[i];
			if (used.has(slotA)) continue;

			for (let k = i + 1; k < shuffled.length; k++) {
				const slotB = shuffled[k];
				if (used.has(slotB)) continue;
				if (slotsOverlap(segments, slotA, slotB)) continue;

				used.add(slotA);
				used.add(slotB);
				pairs.push([slotA, slotB]);
				count++;
				break;
			}
		}
	}

	return pairs;
}

/**
 * Compile the full shuffle plan: pre-compute all swap pairs, segment lifecycles,
 * flight legs, and per-layer data for the entire sequence.
 */
export function compilePlan(
	segments: SegmentInfo[],
	config: ShuffleConfig,
	seed?: number,
): CompiledPlan {
	const count = segments.length;
	const maxGen = getEffectiveMaxLayer(config);
	const random = seed != null ? mulberry32(seed) : Math.random;

	// ── Step 1: Generate swap pairs for each layer ──
	// Each layer gets category-aware random swaps (sakura↔sakura, leaf↔leaf, etc.)
	const swapsByLayer: SwapPair[][] = [[]]; // layer 0 = base, no swaps
	for (let layer = 1; layer <= maxGen; layer++) {
		swapsByLayer.push(
			generateSwapPairs(
				layer,
				segments,
				config.categoryStartLayer,
				config.sourceImageStartLayer,
				config.categoryMaxLayer,
				config.maxGenerations,
				random,
			),
		);
	}

	// ── Step 2: Build cumulative slot→segment mappings ──
	// mappingByLayer[L][slot] = segId at that slot after all swaps up to layer L
	const mappingByLayer: number[][] = [];
	mappingByLayer.push(Array.from({ length: count }, (_, i) => i)); // layer 0: identity (seg i → slot i)

	for (let layer = 1; layer <= maxGen; layer++) {
		const prev = [...mappingByLayer[layer - 1]];
		for (const [slotA, slotB] of swapsByLayer[layer]) {
			const tmp = prev[slotA];
			prev[slotA] = prev[slotB];
			prev[slotB] = tmp;
		}
		mappingByLayer.push(prev);
	}

	// ── Step 3: Determine settle layer for each segment ──
	// settleLayer[segId] = the first layer where this segment is involved in a swap.
	// Segments that are never swapped get maxGen+1 (meaning "never settled").
	const settleLayer = new Array<number>(count).fill(maxGen + 1);

	for (let layer = 1; layer <= maxGen; layer++) {
		const swappedSlots = new Set<number>();
		for (const [slotA, slotB] of swapsByLayer[layer]) {
			swappedSlots.add(slotA);
			swappedSlots.add(slotB);
		}

		// Check which segments (by ID) are in swapped slots at prev layer
		const prevMapping = mappingByLayer[layer - 1];
		for (const slot of swappedSlots) {
			const segId = prevMapping[slot];
			if (settleLayer[segId] > layer) {
				settleLayer[segId] = layer;
			}
		}
	}

	// ── Step 3b: Build reverse mappings (segId → slot) for O(1) lookup ──
	const reverseMappingByLayer: Map<number, number>[] = mappingByLayer.map(
		(mapping) => {
			const reverse = new Map<number, number>();
			mapping.forEach((segId, slot) => {
				reverse.set(segId, slot);
			});
			return reverse;
		},
	);

	// ── Step 4: Build flight legs for every segment at every layer ──
	// Each leg describes a segment's from/to position between consecutive layers.
	// mode="settle" means the segment is being swapped; mode="pass" means it stays put.
	const lifecycles: SegmentLifecycle[] = [];
	const legsByLayer: SegmentLeg[][] = [[]]; // layer 0 has no legs
	for (let layer = 1; layer <= maxGen; layer++) {
		legsByLayer.push([]);
	}

	const settleIdsByLayer: number[][] = [[]];
	for (let layer = 1; layer <= maxGen; layer++) {
		settleIdsByLayer.push([]);
	}

	for (let segId = 0; segId < count; segId++) {
		const sLayer = settleLayer[segId];
		const legs: SegmentLeg[] = [];

		for (let layer = 1; layer <= maxGen; layer++) {
			const prevSlot = reverseMappingByLayer[layer - 1].get(segId)!;
			const currSlot = reverseMappingByLayer[layer].get(segId)!;

			const isSettle = prevSlot !== currSlot;
			const mode: "pass" | "settle" = isSettle ? "settle" : "pass";

			const [fromX, fromY] = getSlotWorldPos(segments, prevSlot);
			const fromZ = (layer - 1) * config.layerSpacing;
			const [toX, toY] = getSlotWorldPos(segments, currSlot);
			const toZ = layer * config.layerSpacing;

			const leg: SegmentLeg = {
				segId,
				toLayer: layer,
				mode,
				fromSlot: prevSlot,
				from: [fromX, fromY, fromZ],
				to: [toX, toY, toZ],
				destSlot: currSlot,
			};

			legs.push(leg);
			legsByLayer[layer].push(leg);
		}

		if (sLayer > 0 && sLayer <= maxGen) {
			settleIdsByLayer[sLayer].push(segId);
		}

		const effectiveLayer = Math.min(sLayer, maxGen);
		const finalSlot = reverseMappingByLayer[effectiveLayer].get(segId)!;
		lifecycles.push({ segId, settleLayer: sLayer, finalSlot, legs });
	}

	// ── Step 5: Build vacated slots for black fill rendering ──
	// When a swap occurs, both slots become "vacated" — the previous occupant
	// has moved away. These are rendered as black silhouettes (black fills)
	// on the immediately previous layer so the just-changed slot is masked at
	// the layer transition boundary.
	const vacatedByLayer: VacatedSlot[][] = [[]]; // layer 0 has no vacated slots
	for (let layer = 1; layer <= maxGen; layer++) {
		const vacated: VacatedSlot[] = [];

		const prevMapping = mappingByLayer[layer - 1];
		for (const [slotA, slotB] of swapsByLayer[layer]) {
			const segIdA = prevMapping[slotA];
			const srcLayerA = layer - 1;
			const [axPos, ayPos] = getSlotWorldPos(segments, slotA);
			const [aw, ah] = getSlotWorldSize(segments, slotA);
			vacated.push({
				slotIndex: slotA,
				segId: segIdA,
				position: [axPos, ayPos, srcLayerA * config.layerSpacing],
				size: [aw, ah],
				sourceLayer: srcLayerA,
			});

			const segIdB = prevMapping[slotB];
			const srcLayerB = layer - 1;
			const [bxPos, byPos] = getSlotWorldPos(segments, slotB);
			const [bw, bh] = getSlotWorldSize(segments, slotB);
			vacated.push({
				slotIndex: slotB,
				segId: segIdB,
				position: [bxPos, byPos, srcLayerB * config.layerSpacing],
				size: [bw, bh],
				sourceLayer: srcLayerB,
			});
		}

		vacatedByLayer.push(vacated);
	}

	return {
		lifecycles,
		legsByLayer,
		settleIdsByLayer,
		swapsByLayer,
		mappingByLayer,
		vacatedByLayer,
		maxLayer: maxGen,
	};
}
