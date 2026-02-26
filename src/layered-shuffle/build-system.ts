import type {
  BuildPhase,
  BuildState,
  CompiledPlan,
  SegmentLeg,
  ShuffleConfig,
} from "./types";

/** Instance data for one rendered segment */
export type SegmentInstance = {
  segId: number;
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
};

/**
 * Runtime system that drives the sequential layer-build animation.
 * Operates on a CompiledPlan and produces segment instance data each frame.
 */
export class BuildSystem {
  readonly config: ShuffleConfig;
  readonly plan: CompiledPlan;
  readonly segmentCount: number;

  state: BuildState;

  /** Segments that have settled (append-only during build) */
  private settled: (SegmentInstance & { layer: number })[] = [];
  private settledByLayerCache = new Map<number, SegmentInstance[]>();
  private settledDirty = true;
  /** Collapse: current layer being reverse-played */
  private collapsingLayer = -1;
  private collapseTimer = 0;
  private staggerTimer = 0;

  constructor(plan: CompiledPlan, config: ShuffleConfig) {
    this.plan = plan;
    this.config = config;
    this.segmentCount = plan.mappingByLayer[0].length;
    this.state = { currentLayer: 1, phase: "flight", phaseTime: 0 };
  }

  /** Reset for loop restart */
  reset(plan: CompiledPlan): void {
    Object.assign(this, {
      plan,
      settled: [],
      settledByLayerCache: new Map(),
      settledDirty: true,
      collapsingLayer: -1,
      collapseTimer: 0,
      staggerTimer: 0,
      state: { currentLayer: 1, phase: "flight" as BuildPhase, phaseTime: 0 },
    });
  }

  /** Advance the state machine by deltaTime seconds */
  update(deltaTime: number): void {
    switch (this.state.phase) {
      case "flight":
        this.updateFlight(deltaTime);
        return;
      case "hold":
        this.updateHold(deltaTime);
        return;
      case "commit":
        this.commitLayer();
        return;
      case "collapsing":
        this.updateCollapse(deltaTime);
        return;
      case "holding":
        this.updateHolding(deltaTime);
        return;
      case "complete":
      case "idle":
        return;
    }
  }

  private updateFlight(dt: number): void {
    this.state.phaseTime += dt;
    if (this.state.phaseTime >= this.config.flightDuration) {
      this.state.phase = "hold";
      this.state.phaseTime = 0;
    }
  }

  private updateHold(dt: number): void {
    this.state.phaseTime += dt;
    if (this.state.phaseTime >= this.config.holdDuration) {
      this.state.phase = "commit";
      this.state.phaseTime = 0;
    }
  }

  private commitLayer(): void {
    const layer = this.state.currentLayer;
    const settleIds = new Set(this.plan.settleIdsByLayer[layer] ?? []);

    // Add settled segments
    for (const leg of this.plan.legsByLayer[layer] ?? []) {
      if (settleIds.has(leg.segId)) {
        this.settled.push({
          segId: leg.segId,
          x: leg.to[0],
          y: leg.to[1],
          z: leg.to[2],
          w: leg.toSize[0],
          h: leg.toSize[1],
          layer,
        });
        this.settledDirty = true;
      }
    }

    // Advance to next layer or complete
    if (layer >= this.config.maxGenerations) {
      this.state.phase = "complete";
      this.startCollapse();
    } else {
      this.state.currentLayer = layer + 1;
      this.state.phase = "flight";
      this.state.phaseTime = 0;
    }
  }

  private startCollapse(): void {
    this.state.phase = "collapsing";
    this.collapsingLayer = this.config.maxGenerations;
    this.collapseTimer = 0;
    this.staggerTimer = 0;
    // Clear settled — collapse uses legs for reverse-flight rendering
    this.settled = [];
    this.settledDirty = true;
  }

  private updateCollapse(dt: number): void {
    if (this.collapsingLayer <= 0) {
      this.state.phase = "holding";
      this.state.phaseTime = 0;
      return;
    }

    if (this.staggerTimer > 0) {
      this.staggerTimer -= dt;
      return;
    }

    this.collapseTimer += dt;
    if (this.collapseTimer >= this.config.collapseDuration) {
      this.collapsingLayer -= 1;
      if (this.collapsingLayer <= 0) {
        this.state.phase = "holding";
        this.state.phaseTime = 0;
      } else {
        this.collapseTimer = 0;
        this.staggerTimer = this.config.collapseStagger;
      }
    }
  }

  private updateHolding(dt: number): void {
    this.state.phaseTime += dt;
    if (this.state.phaseTime >= this.config.holdAfterComplete) {
      this.state.phase = "idle";
    }
  }

  /** Get base layer instances (layer 0, always static) */
  getBaseInstances(): SegmentInstance[] {
    const instances: SegmentInstance[] = [];
    const mapping = this.plan.mappingByLayer[0];
    for (let i = 0; i < this.segmentCount; i++) {
      instances.push({
        segId: mapping[i],
        x: 0, y: 0, z: 0, // will be filled by renderer from segments
        w: 0, h: 0,
      });
    }
    return instances;
  }

  /** Get all active (in-flight + passing-through) segment instances */
  getActiveInstances(): SegmentInstance[] {
    const { currentLayer, phase, phaseTime } = this.state;

    if (phase === "collapsing") {
      return this.getCollapseInstances();
    }

    if (phase === "complete" || phase === "holding" || phase === "idle") {
      return [];
    }

    const t = phase === "flight"
      ? Math.min(phaseTime / this.config.flightDuration, 1)
      : 1; // hold phase: segments at destination

    const eased = easeOutCubic(t);
    const instances: SegmentInstance[] = [];
    const settledIds = new Set<number>();

    // Collect all already-settled segment IDs
    for (const s of this.settled) {
      settledIds.add(s.segId);
    }

    // All legs for the current layer
    const legs = this.plan.legsByLayer[currentLayer] ?? [];
    for (const leg of legs) {
      if (settledIds.has(leg.segId)) continue;
      instances.push(interpolateLeg(leg, eased));
    }

    return instances;
  }

  /** Get reverse-flying instances during collapse */
  private getCollapseInstances(): SegmentInstance[] {
    const instances: SegmentInstance[] = [];
    const progress = Math.min(this.collapseTimer / this.config.collapseDuration, 1);
    const eased = easeOutCubic(progress);
    const animatingSegIds = new Set<number>();

    // Current collapsing layer: reverse-fly legs (to → from)
    const legs = this.plan.legsByLayer[this.collapsingLayer] ?? [];
    for (const leg of legs) {
      animatingSegIds.add(leg.segId);
      instances.push(interpolateLegReverse(leg, eased));
    }

    // Segments settled below the current collapsing layer stay fixed at
    // their settle-layer destination. This avoids rendering the same segment
    // many times across multiple pass-through layers.
    for (const lifecycle of this.plan.lifecycles) {
      if (lifecycle.settleLayer >= this.collapsingLayer) continue;
      if (animatingSegIds.has(lifecycle.segId)) continue;

      const settledLeg = lifecycle.legs[lifecycle.legs.length - 1];
      if (!settledLeg) continue;

      instances.push({
        segId: lifecycle.segId,
        x: settledLeg.to[0],
        y: settledLeg.to[1],
        z: settledLeg.to[2],
        w: settledLeg.toSize[0],
        h: settledLeg.toSize[1],
      });
    }

    return instances;
  }

  /** Get all settled segment instances (empty during collapse — handled by getActiveInstances) */
  getSettledInstances(): SegmentInstance[] {
    return this.settled;
  }

  /** Get settled instances grouped by layer (cached, rebuilds only when dirty) */
  getSettledByLayer(): Map<number, SegmentInstance[]> {
    if (!this.settledDirty) return this.settledByLayerCache;

    this.settledByLayerCache.clear();
    for (const s of this.settled) {
      let arr = this.settledByLayerCache.get(s.layer);
      if (!arr) {
        arr = [];
        this.settledByLayerCache.set(s.layer, arr);
      }
      arr.push(s);
    }
    this.settledDirty = false;
    return this.settledByLayerCache;
  }

  /** Get current layer being built */
  getCurrentLayer(): number {
    return this.state.currentLayer;
  }

  /** Get the connection line data for all built layers */
  getConnectionLines(): Array<{ from: [number, number, number]; to: [number, number, number] }> {
    const lines: Array<{ from: [number, number, number]; to: [number, number, number] }> = [];
    const { currentLayer, phase, phaseTime } = this.state;

    if (phase === "collapsing") {
      return this.getCollapseLines();
    }

    if (phase === "holding" || phase === "idle") {
      return [];
    }

    const maxBuiltLayer = phase === "flight" || phase === "hold" || phase === "commit"
      ? currentLayer
      : this.config.maxGenerations;

    const t = phase === "flight"
      ? easeOutCubic(Math.min(phaseTime / this.config.flightDuration, 1))
      : 1;

    for (let layer = 1; layer <= maxBuiltLayer; layer++) {
      const legs = this.plan.legsByLayer[layer] ?? [];
      const isCurrentLayer = layer === currentLayer && (phase === "flight" || phase === "hold");

      for (const leg of legs) {
        if (leg.mode === "pass") continue;

        if (isCurrentLayer) {
          const inst = interpolateLeg(leg, t);
          lines.push({
            from: leg.from,
            to: [inst.x, inst.y, inst.z],
          });
        } else if (layer < currentLayer || phase === "complete") {
          lines.push({
            from: leg.from,
            to: leg.to,
          });
        }
      }
    }

    return lines;
  }

  /** Get connection lines during collapse (reverse animation) */
  private getCollapseLines(): Array<{ from: [number, number, number]; to: [number, number, number] }> {
    const lines: Array<{ from: [number, number, number]; to: [number, number, number] }> = [];
    const progress = Math.min(this.collapseTimer / this.config.collapseDuration, 1);
    const t = easeOutCubic(progress);

    // Current collapsing layer: animated reverse lines
    const collapseLegs = this.plan.legsByLayer[this.collapsingLayer] ?? [];
    for (const leg of collapseLegs) {
      if (leg.mode === "pass") continue;
      const inst = interpolateLegReverse(leg, t);
      lines.push({
        from: [leg.to[0], leg.to[1], leg.to[2]],
        to: [inst.x, inst.y, inst.z],
      });
    }

    // Layers below: still showing static lines
    for (let layer = this.collapsingLayer - 1; layer >= 1; layer--) {
      const layerLegs = this.plan.legsByLayer[layer] ?? [];
      for (const leg of layerLegs) {
        if (leg.mode === "pass") continue;
        lines.push({
          from: leg.from,
          to: leg.to,
        });
      }
    }

    return lines;
  }
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function interpolateLeg(leg: SegmentLeg, t: number): SegmentInstance {
  return {
    segId: leg.segId,
    x: leg.from[0] + (leg.to[0] - leg.from[0]) * t,
    y: leg.from[1] + (leg.to[1] - leg.from[1]) * t,
    z: leg.from[2] + (leg.to[2] - leg.from[2]) * t,
    w: leg.fromSize[0] + (leg.toSize[0] - leg.fromSize[0]) * t,
    h: leg.fromSize[1] + (leg.toSize[1] - leg.fromSize[1]) * t,
  };
}

/** Reverse interpolation: to → from */
function interpolateLegReverse(leg: SegmentLeg, t: number): SegmentInstance {
  return {
    segId: leg.segId,
    x: leg.to[0] + (leg.from[0] - leg.to[0]) * t,
    y: leg.to[1] + (leg.from[1] - leg.to[1]) * t,
    z: leg.to[2] + (leg.from[2] - leg.to[2]) * t,
    w: leg.toSize[0] + (leg.fromSize[0] - leg.toSize[0]) * t,
    h: leg.toSize[1] + (leg.fromSize[1] - leg.toSize[1]) * t,
  };
}
