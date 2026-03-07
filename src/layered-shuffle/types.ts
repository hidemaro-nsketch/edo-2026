/**
 * types.ts — Layered Shuffle Type Definitions
 *
 * Data structures for the layered shuffle system:
 *   - ShuffleConfig: animation timing & layout parameters
 *   - CompiledPlan: pre-computed shuffle sequence (swap pairs, flight legs, mappings)
 *   - BuildState/BuildPhase: runtime state machine for the animation loop
 *
 * Data flow:
 *   SegmentInfo[] + ShuffleConfig → compilePlan() → CompiledPlan → BuildSystem → SegmentMeshes
 */

/** Configuration for the layered shuffle system */
export type ShuffleConfig = {
	/** Maximum number of shuffle generations */
	maxGenerations: number;
	/** Duration of swipe animation per layer in seconds */
	swipeDuration: number;
	/** Random variation ratio for swipe duration per layer (0..1) */
	swipeDurationJitter: number;
	/** Hold duration after swipe before committing layer in seconds */
	holdDuration: number;
	/** Z distance between adjacent layers */
	layerSpacing: number;
	/** Duration of each layer's fade-out during collapse in seconds */
	collapseDuration: number;
	/** Stagger delay between consecutive layer collapses in seconds */
	collapseStagger: number;
	/** Pause duration after collapse before loop restart in seconds */
	holdAfterComplete: number;
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
	| "swipe" // horizontal wipe transition for swapped slots
	| "hold" // brief pause after swipe
	| "commit" // settling segments, advancing to next layer
	| "complete" // all layers built
	| "preCollapse" // pause while camera moves to oblique
	| "collapsing" // collapse animation
	| "holding" // pause after collapse before restart
	| "idle"; // not started

/** Runtime state for the sequential layer build */
export type BuildState = {
	/** Current layer being built (1-based, 0 = base) */
	currentLayer: number;
	/** Current phase */
	phase: BuildPhase;
	/** Progress within current phase (0..1 for swipe, seconds for hold) */
	phaseTime: number;
};

/** Default configuration values */
export const DEFAULT_CONFIG: ShuffleConfig = {
	maxGenerations: 10,
	swipeDuration: 2.2,
	swipeDurationJitter: 0.25,
	holdDuration: 1.4,
	layerSpacing: 1.0,
	collapseDuration: 0.2,
	collapseStagger: 0.08,
	holdAfterComplete: 1.0,
};
