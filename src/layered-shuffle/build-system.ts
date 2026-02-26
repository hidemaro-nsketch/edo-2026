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

  /** Segments that have settled (append-only) */
  private settled: SegmentInstance[] = [];
  /** Collapse animation state */
  private collapsingIndex = -1;
  private collapseTimer = 0;
  private staggerTimer = 0;
  private collapseOriginalZ: Map<number, number> = new Map();
  /** Settled segment opacity during collapse */
  settledOpacity: Map<number, number> = new Map();

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
      collapsingIndex: -1,
      collapseTimer: 0,
      staggerTimer: 0,
      collapseOriginalZ: new Map(),
      settledOpacity: new Map(),
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
        });
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
    // Collapse from highest layer settled segments downward
    const maxLayer = this.config.maxGenerations;
    this.collapsingIndex = maxLayer;
    this.collapseTimer = 0;
    this.staggerTimer = 0;

    // Snapshot Z positions for collapse
    this.collapseOriginalZ = new Map();
    this.settledOpacity = new Map();
    for (const s of this.settled) {
      this.collapseOriginalZ.set(s.segId, s.z);
      this.settledOpacity.set(s.segId, 1);
    }
  }

  private updateCollapse(dt: number): void {
    if (this.collapsingIndex <= 0) {
      this.state.phase = "holding";
      this.state.phaseTime = 0;
      return;
    }

    if (this.staggerTimer > 0) {
      this.staggerTimer -= dt;
      return;
    }

    this.collapseTimer += dt;
    const progress = Math.min(this.collapseTimer / this.config.collapseDuration, 1);
    const eased = 1 - (1 - progress) * (1 - progress);

    const targetZ = (this.collapsingIndex - 1) * this.config.layerSpacing;

    // Animate all settled segments at this layer
    for (const s of this.settled) {
      const origZ = this.collapseOriginalZ.get(s.segId);
      if (origZ === undefined) continue;
      const segLayer = Math.round(origZ / this.config.layerSpacing);
      if (segLayer !== this.collapsingIndex) continue;

      s.z = origZ + (targetZ - origZ) * eased;
      const opacity = progress < 0.5 ? 1 : 1 - (progress - 0.5) * 2;
      this.settledOpacity.set(s.segId, opacity);
    }

    if (progress >= 1) {
      // Remove collapsed segments
      this.settled = this.settled.filter((s) => {
        const origZ = this.collapseOriginalZ.get(s.segId);
        if (origZ === undefined) return true;
        const segLayer = Math.round(origZ / this.config.layerSpacing);
        return segLayer !== this.collapsingIndex;
      });

      this.collapsingIndex -= 1;
      if (this.collapsingIndex <= 0) {
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

    if (phase === "complete" || phase === "collapsing" || phase === "holding" || phase === "idle") {
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

  /** Get all settled segment instances */
  getSettledInstances(): SegmentInstance[] {
    return this.settled;
  }

  /** Get current layer being built */
  getCurrentLayer(): number {
    return this.state.currentLayer;
  }

  /** Get the connection line data for all built layers */
  getConnectionLines(): Array<{ from: [number, number, number]; to: [number, number, number] }> {
    const lines: Array<{ from: [number, number, number]; to: [number, number, number] }> = [];
    const { currentLayer, phase, phaseTime } = this.state;

    const maxBuiltLayer = phase === "flight" || phase === "hold"
      ? currentLayer
      : phase === "commit"
        ? currentLayer
        : this.config.maxGenerations;

    const t = phase === "flight"
      ? easeOutCubic(Math.min(phaseTime / this.config.flightDuration, 1))
      : 1;

    for (let layer = 1; layer <= maxBuiltLayer; layer++) {
      const legs = this.plan.legsByLayer[layer] ?? [];
      const isCurrentLayer = layer === currentLayer && (phase === "flight" || phase === "hold");

      for (const leg of legs) {
        if (leg.mode === "pass") continue; // only draw lines for settle legs

        if (isCurrentLayer) {
          // Animated line endpoint
          const inst = interpolateLeg(leg, t);
          lines.push({
            from: leg.from,
            to: [inst.x, inst.y, inst.z],
          });
        } else if (layer < currentLayer || phase === "complete" || phase === "collapsing" || phase === "holding") {
          lines.push({
            from: leg.from,
            to: leg.to,
          });
        }
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
