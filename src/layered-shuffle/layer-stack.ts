import {
  DEFAULT_CONFIG,
  type LayerState,
  type ShuffleConfig,
  type SystemPhase,
} from "./types";

/**
 * Pure logic module that manages the layer state machine for the
 * layered shuffle system. No React or Three.js dependencies.
 */
export class LayerStack {
  readonly config: ShuffleConfig;
  readonly segmentCount: number;
  layers: LayerState[];
  currentGen: number;
  phase: SystemPhase;

  /** Working copy of slot-to-segment mapping during shuffle */
  private pendingSlotToSegId: number[];
  /** Set of slot indices that changed during the current generation */
  private pendingChanges: Set<number>;
  /** Index of the layer currently being collapsed (top-down) */
  private collapsingIndex: number;
  /** Accumulated time for the current collapsing layer */
  private collapseTimer: number;
  /** Accumulated stagger delay before the next layer starts collapsing */
  private staggerTimer: number;

  constructor(segmentCount: number, config?: Partial<ShuffleConfig>) {
    this.segmentCount = segmentCount;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.layers = [];
    this.currentGen = 0;
    this.phase = "frozen";
    this.pendingSlotToSegId = [];
    this.pendingChanges = new Set();
    this.collapsingIndex = -1;
    this.collapseTimer = 0;
    this.staggerTimer = 0;
  }

  /**
   * Initialize layer 0 with identity mapping (slot i shows segment i).
   */
  initOriginalLayer(): void {
    const slotToSegId = Array.from(
      { length: this.segmentCount },
      (_, i) => i,
    );
    const changedSlots = new Array<boolean>(this.segmentCount).fill(false);

    const layer: LayerState = {
      gen: 0,
      z: 0,
      alive: true,
      opacity: 1,
      slotToSegId,
      changedSlots,
      linksFromPrev: [],
    };

    this.layers = [layer];
    this.currentGen = 0;
    this.phase = "frozen";
  }

  /**
   * Start a new generation: creates a working copy from the last frozen layer
   * and transitions to the "shuffling" phase.
   */
  startGeneration(): void {
    if (this.layers.length === 0) {
      return;
    }

    const lastLayer = this.layers[this.layers.length - 1];
    this.pendingSlotToSegId = [...lastLayer.slotToSegId];
    this.pendingChanges = new Set();
    this.currentGen = lastLayer.gen + 1;
    this.phase = "shuffling";
  }

  /**
   * Apply a single shuffle swap: the slot at slotIdx now shows nextSegId.
   * Returns true if this constitutes a change from the previous layer.
   */
  applyShuffle(slotIdx: number, nextSegId: number): boolean {
    if (slotIdx < 0 || slotIdx >= this.segmentCount) {
      return false;
    }

    const prevLayer = this.layers[this.layers.length - 1];
    const prevSegId = prevLayer.slotToSegId[slotIdx];

    this.pendingSlotToSegId[slotIdx] = nextSegId;

    if (nextSegId !== prevSegId) {
      this.pendingChanges.add(slotIdx);
      return true;
    }

    // If reverted back to original, remove from changes
    this.pendingChanges.delete(slotIdx);
    return false;
  }

  /**
   * Freeze the current generation as a new layer.
   * Computes changedSlots, linksFromPrev, and pushes to the layers array.
   */
  freezeGeneration(): LayerState {
    const prevLayer = this.layers[this.layers.length - 1];
    const slotToSegId = [...this.pendingSlotToSegId];

    const changedSlots = new Array<boolean>(this.segmentCount).fill(false);
    const linksFromPrev: LayerState["linksFromPrev"] = [];

    for (const slotIdx of this.pendingChanges) {
      changedSlots[slotIdx] = true;
      linksFromPrev.push({
        slotIndex: slotIdx,
        prevSegId: prevLayer.slotToSegId[slotIdx],
        currSegId: slotToSegId[slotIdx],
      });
    }

    const layer: LayerState = {
      gen: this.currentGen,
      z: this.currentGen * this.config.layerSpacing,
      alive: true,
      opacity: 1,
      slotToSegId,
      changedSlots,
      linksFromPrev,
    };

    this.layers.push(layer);
    this.phase = "frozen";

    // Clear pending state
    this.pendingSlotToSegId = [];
    this.pendingChanges = new Set();

    return layer;
  }

  /**
   * Check if all generations are complete.
   */
  isComplete(): boolean {
    return this.currentGen >= this.config.maxGenerations;
  }

  /** Original Z positions for collapse animation (set when collapse starts) */
  private collapseOriginalZ: number[] = [];

  /**
   * Start the collapse sequence from the highest generation layer.
   */
  startCollapse(): void {
    this.phase = "collapsing";
    // Start from the topmost layer (highest gen)
    this.collapsingIndex = this.layers.length - 1;
    this.collapseTimer = 0;
    this.staggerTimer = 0;
    // Snapshot original Z positions
    this.collapseOriginalZ = this.layers.map((l) => l.z);
  }

  /**
   * Update the collapse animation.
   * Each layer slides in Z to overlap the layer below it, then disappears.
   * Layers collapse from top (highest gen) to bottom (gen 1), skipping gen 0.
   * Returns true if collapse is still in progress, false when complete.
   */
  updateCollapse(deltaTime: number): boolean {
    if (this.phase !== "collapsing") {
      return false;
    }

    // Skip gen 0 — it always stays alive
    if (this.collapsingIndex <= 0) {
      this.phase = "holding";
      return false;
    }

    const layer = this.layers[this.collapsingIndex];

    // Handle stagger delay before this layer starts moving
    if (this.staggerTimer > 0) {
      this.staggerTimer -= deltaTime;
      return true;
    }

    // Slide Z toward the layer below
    this.collapseTimer += deltaTime;
    const progress = Math.min(this.collapseTimer / this.config.collapseDuration, 1);
    // Ease-out for snappy movement
    const eased = 1 - (1 - progress) * (1 - progress);

    const fromZ = this.collapseOriginalZ[this.collapsingIndex];
    const targetZ = this.collapseOriginalZ[this.collapsingIndex - 1];
    layer.z = fromZ + (targetZ - fromZ) * eased;

    // Fade out in the last portion of the slide
    layer.opacity = progress < 0.5 ? 1 : 1 - (progress - 0.5) * 2;

    if (progress >= 1) {
      layer.alive = false;
      layer.opacity = 0;
      layer.z = targetZ;

      // Move to next layer down
      this.collapsingIndex -= 1;

      // If we've reached gen 0, collapse is done
      if (this.collapsingIndex <= 0) {
        this.phase = "holding";
        return false;
      }

      // Reset timers for the next layer
      this.collapseTimer = 0;
      this.staggerTimer = this.config.collapseStagger;
    }

    return true;
  }

  /**
   * Reset everything for loop restart.
   */
  reset(): void {
    this.layers = [];
    this.currentGen = 0;
    this.phase = "frozen";
    this.pendingSlotToSegId = [];
    this.pendingChanges = new Set();
    this.collapsingIndex = -1;
    this.collapseTimer = 0;
    this.staggerTimer = 0;
    this.collapseOriginalZ = [];
  }

  /**
   * Get the current pending slot mapping (only valid during shuffling phase).
   */
  getPendingSlotToSegId(): number[] {
    return [...this.pendingSlotToSegId];
  }

  /**
   * Get all alive layers for rendering.
   */
  getAliveLayers(): LayerState[] {
    return this.layers.filter((layer) => layer.alive);
  }

}
