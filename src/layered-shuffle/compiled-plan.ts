import {
  computeContainedSize,
  getSlotWorldPos,
  getSlotWorldSize,
} from "../sakura/constants";
import type { SegmentInfo } from "../sakura/types";
import type {
  CompiledPlan,
  SegmentLeg,
  SegmentLifecycle,
  ShuffleConfig,
  SwapPair,
  VacatedSlot,
} from "./types";

/**
 * Compute bounding box area for a slot (uses the segment geometry at that slot index).
 */
function slotArea(segments: SegmentInfo[], slotIndex: number): number {
  const seg = segments[slotIndex];
  return seg.bboxInSource[2] * seg.bboxInSource[3];
}

/**
 * Generate swap pairs for a given generation.
 * Swap count increases progressively using a t^1.5 curve.
 * Pairs slots with similar bounding box areas. The neighbourhood radius
 * widens as generations progress: early layers pair very similar sizes,
 * later layers allow larger size differences for more variety.
 * No slot appears in more than one pair per generation.
 */
function generateSwapPairs(
  gen: number,
  maxGenerations: number,
  segments: SegmentInfo[],
): SwapPair[] {
  const segmentCount = segments.length;
  const maxSwaps = Math.floor(segmentCount / 2);
  const t = maxGenerations <= 1 ? 1 : (gen - 1) / (maxGenerations - 1);
  const swapCount = Math.min(
    Math.round(1 + (maxSwaps - 1) * t ** 1.5),
    maxSwaps,
  );

  // Sort slot indices by bbox area
  const sorted = Array.from({ length: segmentCount }, (_, i) => i);
  sorted.sort((a, b) => slotArea(segments, a) - slotArea(segments, b));

  // Neighbourhood radius: 1 (strict adjacent) at gen 1, up to half the list at max gen
  const maxRadius = Math.max(1, Math.floor(segmentCount / 2));
  const radius = Math.max(1, Math.round(1 + (maxRadius - 1) * t));

  // Greedy random pairing within neighbourhood
  const used = new Set<number>();
  const pairs: SwapPair[] = [];

  // Randomize traversal order so pairs vary across layers
  const order = Array.from({ length: sorted.length }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }

  for (const sortedIdx of order) {
    if (pairs.length >= swapCount) break;
    const slotA = sorted[sortedIdx];
    if (used.has(slotA)) continue;

    // Pick a random partner within the neighbourhood radius in sorted order
    const lo = Math.max(0, sortedIdx - radius);
    const hi = Math.min(sorted.length - 1, sortedIdx + radius);

    // Collect eligible neighbours
    const candidates: number[] = [];
    for (let k = lo; k <= hi; k++) {
      if (k === sortedIdx) continue;
      if (!used.has(sorted[k])) candidates.push(k);
    }
    if (candidates.length === 0) continue;

    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    const slotB = sorted[pick];

    used.add(slotA);
    used.add(slotB);
    pairs.push([slotA, slotB]);
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
): CompiledPlan {
  const count = segments.length;
  const maxGen = config.maxGenerations;

  // Generate all swap pairs for all layers
  const swapsByLayer: SwapPair[][] = [[]]; // layer 0 has no swaps
  for (let layer = 1; layer <= maxGen; layer++) {
    swapsByLayer.push(generateSwapPairs(layer, maxGen, segments));
  }

  // Build slot-to-segment mappings for each layer
  const mappingByLayer: number[][] = [];
  mappingByLayer.push(Array.from({ length: count }, (_, i) => i)); // layer 0: identity

  for (let layer = 1; layer <= maxGen; layer++) {
    const prev = [...mappingByLayer[layer - 1]];
    for (const [slotA, slotB] of swapsByLayer[layer]) {
      const tmp = prev[slotA];
      prev[slotA] = prev[slotB];
      prev[slotB] = tmp;
    }
    mappingByLayer.push(prev);
  }

  // For each segment, determine which layer it first participates in a swap
  // settleLayer[segId] = first layer where this segment is in a swap pair
  const settleLayer = new Array<number>(count).fill(maxGen); // default: last layer

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

  // Build segment lifecycles and legs
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

    // Find this segment's slot at each layer (including post-settle pass-through)
    for (let layer = 1; layer <= maxGen; layer++) {
      const prevMapping = mappingByLayer[layer - 1];
      const currMapping = mappingByLayer[layer];

      // Find which slot this segment is in at prev layer and current layer
      const prevSlot = prevMapping.indexOf(segId);
      const currSlot = currMapping.indexOf(segId);

      const isSettle = layer === sLayer;
      const mode: "pass" | "settle" = isSettle ? "settle" : "pass";

      const [fromX, fromY] = getSlotWorldPos(segments, prevSlot);
      const fromZ = (layer - 1) * config.layerSpacing;
      const [toX, toY] = getSlotWorldPos(segments, currSlot);
      const toZ = layer * config.layerSpacing;

      // Size: from slot's size, to slot's size (with object-fit contain for settle)
      const fromSlotSize = getSlotWorldSize(segments, prevSlot);
      let toSlotSize = getSlotWorldSize(segments, currSlot);

      if (mode === "settle" && prevSlot !== currSlot) {
        // Object-fit contain: segment's original size fitting into destination slot
        const segOrigSize = getSlotWorldSize(segments, segId);
        toSlotSize = computeContainedSize(
          segOrigSize[0], segOrigSize[1],
          toSlotSize[0], toSlotSize[1],
        );
      }

      const leg: SegmentLeg = {
        segId,
        toLayer: layer,
        mode,
        from: [fromX, fromY, fromZ],
        to: [toX, toY, toZ],
        fromSize: fromSlotSize,
        toSize: toSlotSize,
      };

      legs.push(leg);
      legsByLayer[layer].push(leg);
    }

    if (sLayer > 0) {
      settleIdsByLayer[sLayer].push(segId);
    }

    const finalSlot = mappingByLayer[sLayer].indexOf(segId);
    lifecycles.push({ segId, settleLayer: sLayer, finalSlot, legs });
  }

  // Build vacated slots per layer: for each swap, both slots are "vacated"
  // by the segment that was previously there (it moves to the other slot)
  const vacatedByLayer: VacatedSlot[][] = [[]]; // layer 0 has no vacated slots
  for (let layer = 1; layer <= maxGen; layer++) {
    const vacated: VacatedSlot[] = [];
    const sourceZ = (layer - 1) * config.layerSpacing;

    for (const [slotA, slotB] of swapsByLayer[layer]) {
      // Slot A is vacated by prevMapping[slotA] (which moves to slotB)
      const [axPos, ayPos] = getSlotWorldPos(segments, slotA);
      const [aw, ah] = getSlotWorldSize(segments, slotA);
      vacated.push({
        slotIndex: slotA,
        position: [axPos, ayPos, sourceZ],
        size: [aw, ah],
      });

      // Slot B is vacated by prevMapping[slotB] (which moves to slotA)
      const [bxPos, byPos] = getSlotWorldPos(segments, slotB);
      const [bw, bh] = getSlotWorldSize(segments, slotB);
      vacated.push({
        slotIndex: slotB,
        position: [bxPos, byPos, sourceZ],
        size: [bw, bh],
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
  };
}
