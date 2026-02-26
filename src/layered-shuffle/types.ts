/** Configuration for the layered shuffle system */
export type ShuffleConfig = {
  /** Maximum number of shuffle generations */
  maxGenerations: number;
  /** Duration of flight animation per layer in seconds */
  flightDuration: number;
  /** Hold duration after flight before committing layer in seconds */
  holdDuration: number;
  /** Z distance between adjacent layers */
  layerSpacing: number;
  /** Duration of each layer's fade-out during collapse in seconds */
  collapseDuration: number;
  /** Stagger delay between consecutive layer collapses in seconds */
  collapseStagger: number;
  /** Pause duration after collapse before loop restart in seconds */
  holdAfterComplete: number;
  /** First layer that uses flight animation (layers below this commit instantly) */
  animationStartLayer: number;
};

/** A pair of slot indices to swap */
export type SwapPair = [slotA: number, slotB: number];

/** A single flight leg for one segment between two layers */
export type SegmentLeg = {
  /** Segment ID */
  segId: number;
  /** Layer this leg flies TO */
  toLayer: number;
  /** Mode: "pass" = same position, "settle" = new position (swapped) */
  mode: "pass" | "settle";
  /** Start position [x, y, z] */
  from: [number, number, number];
  /** End position [x, y, z] */
  to: [number, number, number];
  /** Start size [w, h] */
  fromSize: [number, number];
  /** End size [w, h] (object-fit contained for settle) */
  toSize: [number, number];
};

/** Full lifecycle of one segment across all layers */
export type SegmentLifecycle = {
  segId: number;
  /** Layer where this segment first gets swapped (-1 if never) */
  settleLayer: number;
  /** Slot index where this segment ends up */
  finalSlot: number;
  /** Ordered list of legs (one per layer transition) */
  legs: SegmentLeg[];
};

/** A slot vacated by a segment moving away during a swap */
export type VacatedSlot = {
  /** Slot index that was vacated */
  slotIndex: number;
  /** Segment ID that previously occupied this slot (for atlas UV lookup) */
  segId: number;
  /** World position [x, y, z] on the source layer */
  position: [number, number, number];
  /** World size [w, h] matching bboxInSource */
  size: [number, number];
};

/** Pre-computed plan for the entire shuffle sequence */
export type CompiledPlan = {
  /** All segment lifecycles */
  lifecycles: SegmentLifecycle[];
  /** Legs grouped by target layer: legsByLayer[layerIdx] = legs flying TO that layer */
  legsByLayer: SegmentLeg[][];
  /** Segment IDs that settle at each layer */
  settleIdsByLayer: number[][];
  /** Swap pairs per layer (for ConnectionLines) */
  swapsByLayer: SwapPair[][];
  /** Slot-to-segment mapping at each layer (after all swaps applied) */
  mappingByLayer: number[][];
  /** Slots vacated by swaps at each layer (black fill targets) */
  vacatedByLayer: VacatedSlot[][];
};

/** Phase of the build state machine */
export type BuildPhase =
  | "flight"     // segments flying from prev layer to current
  | "hold"       // brief pause after flight
  | "swipe"      // instant layer: horizontal wipe transition for swap pairs
  | "commit"     // settling segments, advancing to next layer
  | "complete"   // all layers built
  | "collapsing" // collapse animation
  | "holding"    // pause after collapse before restart
  | "idle";      // not started

/** Runtime state for the sequential layer build */
export type BuildState = {
  /** Current layer being built (1-based, 0 = base) */
  currentLayer: number;
  /** Current phase */
  phase: BuildPhase;
  /** Progress within current phase (0..1 for flight, seconds for hold) */
  phaseTime: number;
};

/** Default configuration values */
export const DEFAULT_CONFIG: ShuffleConfig = {
  maxGenerations: 10,
  flightDuration: 0.6,
  holdDuration: 0.3,
  layerSpacing: 1.0,
  collapseDuration: 0.2,
  collapseStagger: 0.08,
  holdAfterComplete: 1.0,
  animationStartLayer: 5,
};
