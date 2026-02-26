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
} from "./types";

/**
 * Generate swap pairs for a given generation.
 * Swap count increases progressively using a t^1.5 curve.
 * No slot appears in more than one pair per generation.
 */
function generateSwapPairs(
  gen: number,
  maxGenerations: number,
  segmentCount: number,
): SwapPair[] {
  const maxSwaps = Math.floor(segmentCount / 2);
  const t = maxGenerations <= 1 ? 1 : (gen - 1) / (maxGenerations - 1);
  const swapCount = Math.min(
    Math.round(1 + (maxSwaps - 1) * t ** 1.5),
    maxSwaps,
  );

  const indices = Array.from({ length: segmentCount }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }

  const pairs: SwapPair[] = [];
  for (let i = 0; i < swapCount * 2; i += 2) {
    pairs.push([indices[i], indices[i + 1]]);
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
    swapsByLayer.push(generateSwapPairs(layer, maxGen, count));
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

    // Find this segment's slot at each layer
    for (let layer = 1; layer <= sLayer; layer++) {
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

  return {
    lifecycles,
    legsByLayer,
    settleIdsByLayer,
    swapsByLayer,
    mappingByLayer,
  };
}
