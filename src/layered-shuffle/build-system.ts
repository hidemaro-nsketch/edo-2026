/**
 * build-system.ts — Animation State Machine
 *
 * Drives the layered shuffle animation using a pre-compiled plan.
 * Manages the phase lifecycle and produces render-ready instance data each frame.
 *
 * Phase lifecycle (per cycle):
 *   swipe → hold → commit → (next layer or preCollapse)
 *   preCollapse → collapsing → holding → idle → (restart with new plan)
 *
 * Key concepts:
 *   - "Active" instances: segments currently animating on the current layer
 *   - "Settled" instances: segments committed to past layers (no longer animating)
 *   - "Black fills": black silhouettes at vacated slots (where a segment moved away)
 *   - "Collapse": reverse animation that folds all layers back to base
 */

import type {
	BuildPhase,
	BuildState,
	CompiledPlan,
	SegmentLeg,
	ShuffleConfig,
} from "./types";

/** GPU-ready data for one segment quad (position, size, wipe state) */
export type SegmentInstance = {
	segId: number;
	x: number;
	y: number;
	z: number;
	w: number;
	h: number;
	wipeRole: number;
	isBboxOutline: number;
	swipeProgress: number;
};

/** GPU-ready data for a black silhouette at a vacated slot */
export type BlackFillInstance = {
	segId: number;
	x: number;
	y: number;
	z: number;
	w: number;
	h: number;
	sourceLayer: number;
};

type ConnectionLine = {
	from: [number, number, number];
	to: [number, number, number];
};

export class BuildSystem {
	readonly config: ShuffleConfig;
	readonly plan: CompiledPlan;
	readonly segmentCount: number;

	state: BuildState;

	/** Segments that have been committed to past layers (rendered statically) */
	private settled: (SegmentInstance & { layer: number })[] = [];
	private settledByLayerCache = new Map<number, SegmentInstance[]>();
	private settledDirty = true;
	/** Black fills for the currently-animating layer (active during swipe phase) */
	private blackFills: BlackFillInstance[] = [];
	/** Black fills preserved from past layers (rendered alongside settled segments) */
	private committedBlackFills = new Map<number, BlackFillInstance[]>();
	/** Which layer is currently collapsing (counts down from maxGenerations to 0) */
	private collapsingLayer = -1;
	private collapseTimer = 0;
	private collapseStaggerTimer = 0;
	/** Swipe duration for the current layer (randomized with jitter) */
	private currentSwipeDuration: number;

	constructor(plan: CompiledPlan, config: ShuffleConfig) {
		this.plan = plan;
		this.config = config;
		this.segmentCount = plan.mappingByLayer[0].length;
		this.state = { currentLayer: 1, phase: "swipe", phaseTime: 0 };
		this.currentSwipeDuration = this.pickSwipeDuration();
		this.syncBlackFillsForCurrentLayer();
	}

	reset(plan: CompiledPlan): void {
		Object.assign(this, {
			plan,
			settled: [],
			settledByLayerCache: new Map(),
			settledDirty: true,
			blackFills: [],
			committedBlackFills: new Map(),
			collapsingLayer: -1,
			collapseTimer: 0,
			collapseStaggerTimer: 0,
			currentSwipeDuration: this.pickSwipeDuration(),
			state: { currentLayer: 1, phase: "swipe" as BuildPhase, phaseTime: 0 },
		});
		this.syncBlackFillsForCurrentLayer();
	}

	private pickSwipeDuration(): number {
		const base = this.config.swipeDuration;
		const jitter = Math.max(0, this.config.swipeDurationJitter ?? 0);
		const offset = (Math.random() * 2 - 1) * jitter;
		return Math.max(0.05, base * (1 + offset));
	}

	update(deltaTime: number): void {
		switch (this.state.phase) {
			case "swipe":
				this.updateSwipe(deltaTime);
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
			case "preCollapse":
				this.updatePreCollapse(deltaTime);
				return;
			case "complete":
			case "idle":
				return;
		}
	}

	private updateSwipe(dt: number): void {
		this.state.phaseTime += dt;
		if (this.state.phaseTime >= this.currentSwipeDuration) {
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

	/** Finalize the current layer: move segments to settled, save black fills, advance to next */
	private commitLayer(): void {
		const layer = this.state.currentLayer;
		// Add segments whose settle layer is at or before this layer to the settled list
		for (const leg of this.plan.legsByLayer[layer] ?? []) {
			const lifecycle = this.plan.lifecycles[leg.segId];
			if (lifecycle.settleLayer <= layer) {
				this.settled.push({
					segId: leg.segId,
					x: leg.to[0],
					y: leg.to[1],
					z: leg.to[2],
					w: leg.toSize[0],
					h: leg.toSize[1],
					wipeRole: 0,
					isBboxOutline: 0,
					swipeProgress: 0,
					layer,
				});
			}
		}
		this.settledDirty = true;

		// Persist black fills for this layer
		if (this.blackFills.length > 0) {
			this.committedBlackFills.set(layer, [...this.blackFills]);
		}

		if (layer >= this.config.maxGenerations) {
			this.startPreCollapse();
			return;
		}

		this.state.currentLayer = layer + 1;
		this.state.phase = "swipe";
		this.state.phaseTime = 0;
		this.currentSwipeDuration = this.pickSwipeDuration();
		this.syncBlackFillsForCurrentLayer();
	}

	private startPreCollapse(): void {
		this.state.phase = "preCollapse";
		this.state.phaseTime = 0;
		this.blackFills = [];
	}

	private updatePreCollapse(dt: number): void {
		this.state.phaseTime += dt;
		if (this.state.phaseTime >= this.config.holdAfterComplete) {
			this.startCollapse();
		}
	}

	private startCollapse(): void {
		this.state.phase = "collapsing";
		this.collapsingLayer = this.config.maxGenerations;
		this.collapseTimer = 0;
		this.collapseStaggerTimer = 0;
		this.settled = [];
		this.settledDirty = true;
		this.blackFills = [];
		this.committedBlackFills.clear();
	}

	private updateCollapse(dt: number): void {
		if (this.collapsingLayer <= 0) {
			this.state.phase = "holding";
			this.state.phaseTime = 0;
			this.collapseStaggerTimer = 0;
			return;
		}

		if (this.collapseStaggerTimer > 0) {
			this.collapseStaggerTimer -= dt;
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
				this.collapseStaggerTimer = this.config.collapseStagger;
			}
		}
	}

	private updateHolding(dt: number): void {
		this.state.phaseTime += dt;
		if (this.state.phaseTime >= this.config.holdAfterComplete) {
			this.state.phase = "idle";
		}
	}

	/** Create black fill instances from the plan's vacated slots for the current layer */
	private syncBlackFillsForCurrentLayer(): void {
		const layer = this.state.currentLayer;
		const vacated = this.plan.vacatedByLayer[layer] ?? [];
		this.blackFills = vacated.map((v) => ({
			segId: v.segId,
			x: v.position[0],
			y: v.position[1],
			z: v.position[2],
			w: v.size[0],
			h: v.size[1],
			sourceLayer: layer,
		}));
	}

	getBaseInstances(): SegmentInstance[] {
		const instances: SegmentInstance[] = [];
		const mapping = this.plan.mappingByLayer[0];
		for (let i = 0; i < this.segmentCount; i++) {
			instances.push({
				segId: mapping[i],
				x: 0,
				y: 0,
				z: 0,
				w: 0,
				h: 0,
				wipeRole: 0,
				isBboxOutline: 0,
				swipeProgress: 0,
			});
		}
		return instances;
	}

	private getSwipeProgress(): number {
		if (this.state.phase !== "swipe") return 1;
		return Math.min(this.state.phaseTime / this.currentSwipeDuration, 1);
	}

	/**
	 * Get instances for the currently-animating layer.
	 * During swipe phase, "settle" legs produce two overlapping quads
	 * (old segment wiping out + new segment wiping in).
	 * During collapse phase, delegates to getCollapseInstances().
	 */
	getActiveInstances(): SegmentInstance[] {
		const { currentLayer, phase } = this.state;

		if (phase === "collapsing") return this.getCollapseInstances();
		if (
			phase === "preCollapse" ||
			phase === "holding" ||
			phase === "idle" ||
			phase === "complete"
		) {
			return [];
		}

		const legs = this.plan.legsByLayer[currentLayer] ?? [];
		const prevMapping = this.plan.mappingByLayer[currentLayer - 1];
		const currMapping = this.plan.mappingByLayer[currentLayer];
		const swipeProgress = this.getSwipeProgress();

		const instances: SegmentInstance[] = [];
		for (const leg of legs) {
			// "pass" legs: segment stays in same position, just at the new Z depth
			if (leg.mode === "pass") {
				instances.push({
					segId: leg.segId,
					x: leg.to[0],
					y: leg.to[1],
					z: leg.to[2],
					w: leg.toSize[0],
					h: leg.toSize[1],
					wipeRole: 0,
					isBboxOutline: 0,
					swipeProgress: 0,
				});
				continue;
			}

			// "settle" legs: segment is being swapped to a new slot
			// During swipe, render both old and new segment with wipe transition
			const destSlot = currMapping.indexOf(leg.segId);
			const oldSegId = prevMapping[destSlot];
			if (oldSegId === leg.segId || swipeProgress >= 1 || phase !== "swipe") {
				instances.push({
					segId: leg.segId,
					x: leg.to[0],
					y: leg.to[1],
					z: leg.to[2],
					w: leg.toSize[0],
					h: leg.toSize[1],
					wipeRole: 0,
					isBboxOutline: 0,
					swipeProgress: 0,
				});
			} else {
				// wipeRole=1: old segment (wiping away from left)
				instances.push({
					segId: oldSegId,
					x: leg.to[0],
					y: leg.to[1],
					z: leg.to[2],
					w: leg.toSize[0],
					h: leg.toSize[1],
					wipeRole: 1,
					isBboxOutline: 0,
					swipeProgress,
				});
				// wipeRole=2: new segment (wiping in from left)
				instances.push({
					segId: leg.segId,
					x: leg.to[0],
					y: leg.to[1],
					z: leg.to[2],
					w: leg.toSize[0],
					h: leg.toSize[1],
					wipeRole: 2,
					isBboxOutline: 0,
					swipeProgress,
				});
			}
		}

		return instances;
	}

	/** Build instances for the collapse animation — reverse-interpolate legs back to base */
	private getCollapseInstances(): SegmentInstance[] {
		const instances: SegmentInstance[] = [];
		const progress = Math.min(
			this.collapseTimer / this.config.collapseDuration,
			1,
		);
		const eased = easeOutCubic(progress);
		const animatingSegIds = new Set<number>();

		const legs = this.plan.legsByLayer[this.collapsingLayer] ?? [];
		for (const leg of legs) {
			const lifecycle = this.plan.lifecycles[leg.segId];
			if (lifecycle.settleLayer > this.collapsingLayer) continue;
			animatingSegIds.add(leg.segId);
			instances.push(interpolateLegReverse(leg, eased));
		}

		for (const lifecycle of this.plan.lifecycles) {
			if (lifecycle.settleLayer >= this.collapsingLayer) continue;
			if (animatingSegIds.has(lifecycle.segId)) continue;
			const settledLeg = lifecycle.legs.find(
				(l) => l.toLayer === lifecycle.settleLayer,
			);
			if (!settledLeg) continue;
			instances.push({
				segId: lifecycle.segId,
				x: settledLeg.to[0],
				y: settledLeg.to[1],
				z: settledLeg.to[2],
				w: settledLeg.toSize[0],
				h: settledLeg.toSize[1],
				wipeRole: 0,
				isBboxOutline: 0,
				swipeProgress: 0,
			});
		}

		return instances;
	}

	getSettledInstances(): SegmentInstance[] {
		return this.settled;
	}

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

	/** Get black fills for the active layer (only during swipe phase) */
	getBlackFillInstances(): BlackFillInstance[] {
		if (this.state.phase !== "swipe") return [];
		return this.blackFills;
	}

	/** Get black fills from all past committed layers (keyed by layer number) */
	getCommittedBlackFills(): Map<number, BlackFillInstance[]> {
		return this.committedBlackFills;
	}

	getCurrentLayer(): number {
		return this.state.currentLayer;
	}

	/** Debug info: formatted string for GUI display */
	getDebugLabel(): string {
		const { phase, currentLayer, phaseTime } = this.state;
		return `L${currentLayer} | ${phase} | ${phaseTime.toFixed(2)}s`;
	}

	getConnectionLines(): ConnectionLine[] {
		if (this.state.phase !== "collapsing") return [];
		return this.getCollapseLines();
	}

	private getCollapseLines(): ConnectionLine[] {
		const lines: ConnectionLine[] = [];
		const progress = Math.min(
			this.collapseTimer / this.config.collapseDuration,
			1,
		);
		const t = easeOutCubic(progress);

		const collapseLegs = this.plan.legsByLayer[this.collapsingLayer] ?? [];
		for (const leg of collapseLegs) {
			if (!legMoves(leg)) continue;
			const inst = interpolateLegReverse(leg, t);
			lines.push({
				from: [leg.to[0], leg.to[1], leg.to[2]],
				to: [inst.x, inst.y, inst.z],
			});
		}

		for (let layer = this.collapsingLayer - 1; layer >= 1; layer--) {
			const layerLegs = this.plan.legsByLayer[layer] ?? [];
			for (const leg of layerLegs) {
				if (!legMoves(leg)) continue;
				lines.push({ from: leg.from, to: leg.to });
			}
		}

		return lines;
	}
}

/** Check if a leg actually changes position (not a pass-through at same coords) */
function legMoves(leg: SegmentLeg): boolean {
	return (
		leg.from[0] !== leg.to[0] ||
		leg.from[1] !== leg.to[1] ||
		leg.from[2] !== leg.to[2]
	);
}

function easeOutCubic(t: number): number {
	return 1 - (1 - t) ** 3;
}

/** Interpolate a leg in reverse (to→from) for collapse animation. t=0: at destination, t=1: at origin */
function interpolateLegReverse(leg: SegmentLeg, t: number): SegmentInstance {
	return {
		segId: leg.segId,
		x: leg.to[0] + (leg.from[0] - leg.to[0]) * t,
		y: leg.to[1] + (leg.from[1] - leg.to[1]) * t,
		z: leg.to[2] + (leg.from[2] - leg.to[2]) * t,
		w: leg.toSize[0] + (leg.fromSize[0] - leg.toSize[0]) * t,
		h: leg.toSize[1] + (leg.fromSize[1] - leg.toSize[1]) * t,
		wipeRole: 0,
		isBboxOutline: 0,
		swipeProgress: 0,
	};
}
