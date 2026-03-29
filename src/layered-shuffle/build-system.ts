import type { SegmentInfo } from "../sakura/types";
import {
	buildBlackFillRenderInstancesForLayer,
	// Collapse disabled: kept for reference
	// buildCollapseRenderInstances,
	buildFlashRenderInstancesForLayer,
	// buildPreCollapseFlashInstances,
	buildSettledRenderInstancesForLayer,
	buildSwipeRenderInstancesForLayer,
} from "./render-snapshot";
import type {
	BlackFillRenderInstance,
	BuildState,
	CompiledPlan,
	SegmentRenderInstance,
	ShuffleConfig,
} from "./types";

type ConnectionLine = {
	from: [number, number, number];
	to: [number, number, number];
};

export class BuildSystem {
	readonly config: ShuffleConfig;
	readonly segments: SegmentInfo[];
	readonly plan: CompiledPlan;

	state: BuildState;

	// Collapse disabled
	// private collapsingLayer = -1;
	// private collapseTimer = 0;
	// private collapseStaggerTimer = 0;
	private currentSwipeDuration: number;

	constructor(
		plan: CompiledPlan,
		config: ShuffleConfig,
		segments: SegmentInfo[],
	) {
		this.plan = plan;
		this.config = config;
		this.segments = segments;
		this.state = { currentLayer: 1, phase: "flash", phaseTime: 0 };
		this.currentSwipeDuration = this.pickSwipeDuration();
	}

	reset(plan: CompiledPlan): void {
		(this as { plan: CompiledPlan }).plan = plan;
		// Collapse disabled
		// this.collapsingLayer = -1;
		// this.collapseTimer = 0;
		// this.collapseStaggerTimer = 0;
		this.currentSwipeDuration = this.pickSwipeDuration();
		this.state = { currentLayer: 1, phase: "flash", phaseTime: 0 };
	}

	private getFlashDuration(): number {
		return (
			this.config.flashCount *
			(this.config.flashOnDuration + this.config.flashOffDuration)
		);
	}

	private isFlashVisible(time: number): boolean {
		const cycleDuration =
			this.config.flashOnDuration + this.config.flashOffDuration;
		if (this.config.flashCount <= 0 || cycleDuration <= 0) return false;
		return time % cycleDuration < this.config.flashOnDuration;
	}

	private pickSwipeDuration(): number {
		const base = this.config.swipeDuration;
		const jitter = Math.max(0, this.config.swipeDurationJitter ?? 0);
		const offset = (Math.random() * 2 - 1) * jitter;
		return Math.max(0.05, base * (1 + offset));
	}

	update(deltaTime: number): void {
		switch (this.state.phase) {
			case "flash":
				this.updateFlash(deltaTime);
				return;
			case "swipe":
				this.updateSwipe(deltaTime);
				return;
			case "hold":
				this.updateHold(deltaTime);
				return;
			// Collapse disabled: these phases are no longer entered
			// case "preCollapse":
			// 	this.updatePreCollapse(deltaTime);
			// 	return;
			// case "collapsing":
			// 	this.updateCollapse(deltaTime);
			// 	return;
			case "holding":
				this.updateHolding(deltaTime);
				return;
			case "complete":
			case "idle":
				return;
		}
	}

	private updateFlash(dt: number): void {
		const flashTargets = buildFlashRenderInstancesForLayer(
			this.plan,
			this.config,
			this.state.currentLayer,
		);
		if (flashTargets.length === 0 || this.getFlashDuration() <= 0) {
			this.state.phase = "swipe";
			this.state.phaseTime = 0;
			return;
		}

		this.state.phaseTime += dt;
		if (this.state.phaseTime >= this.getFlashDuration()) {
			this.state.phase = "swipe";
			this.state.phaseTime = 0;
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
			this.commitLayer();
		}
	}

	private commitLayer(): void {
		if (this.state.currentLayer >= this.config.maxGenerations) {
			// Collapse disabled: skip preCollapse/collapsing, go directly to holding
			// this.state.phase = "preCollapse";
			this.state.phase = "holding";
			this.state.phaseTime = 0;
			return;
		}

		this.state.currentLayer += 1;
		this.state.phase = "flash";
		this.state.phaseTime = 0;
		this.currentSwipeDuration = this.pickSwipeDuration();
	}

	// Collapse disabled: updatePreCollapse and updateCollapse commented out
	// private updatePreCollapse(dt: number): void {
	// 	this.state.phaseTime += dt;
	// 	if (
	// 		this.state.phaseTime >=
	// 		Math.max(this.getFlashDuration(), this.config.holdAfterComplete)
	// 	) {
	// 		this.state.phase = "collapsing";
	// 		this.collapsingLayer = this.config.maxGenerations;
	// 		this.collapseTimer = 0;
	// 		this.collapseStaggerTimer = 0;
	// 	}
	// }

	// private updateCollapse(dt: number): void {
	// 	if (this.collapsingLayer <= 0) {
	// 		this.state.phase = "holding";
	// 		this.state.phaseTime = 0;
	// 		this.collapseStaggerTimer = 0;
	// 		return;
	// 	}
	//
	// 	if (this.collapseStaggerTimer > 0) {
	// 		this.collapseStaggerTimer -= dt;
	// 		return;
	// 	}
	//
	// 	this.collapseTimer += dt;
	// 	if (this.collapseTimer >= this.config.collapseDuration) {
	// 		this.collapsingLayer -= 1;
	// 		if (this.collapsingLayer <= 0) {
	// 			this.state.phase = "holding";
	// 			this.state.phaseTime = 0;
	// 		} else {
	// 			this.collapseTimer = 0;
	// 			this.collapseStaggerTimer = this.config.collapseStagger;
	// 		}
	// 	}
	// }

	private updateHolding(dt: number): void {
		this.state.phaseTime += dt;
		if (this.state.phaseTime >= this.config.holdAfterComplete) {
			this.state.phase = "idle";
		}
	}

	private getSwipeProgress(): number {
		if (this.state.phase !== "swipe") return 1;
		return Math.min(this.state.phaseTime / this.currentSwipeDuration, 1);
	}

	getActiveInstances(): SegmentRenderInstance[] {
		const { currentLayer, phase } = this.state;

		// Collapse disabled: collapsing phase no longer entered
		// if (phase === "collapsing") {
		// 	const progress = Math.min(
		// 		this.collapseTimer / this.config.collapseDuration,
		// 		1,
		// 	);
		// 	return buildCollapseRenderInstances(
		// 		this.plan,
		// 		this.config,
		// 		this.collapsingLayer,
		// 		easeOutCubic(progress),
		// 	);
		// }

		if (phase === "flash") {
			if (!this.isFlashVisible(this.state.phaseTime)) return [];
			return buildFlashRenderInstancesForLayer(
				this.plan,
				this.config,
				currentLayer,
			);
		}

		// Collapse disabled: preCollapse phase no longer entered
		// if (phase === "preCollapse") {
		// 	if (
		// 		this.state.phaseTime >= this.getFlashDuration() ||
		// 		!this.isFlashVisible(this.state.phaseTime)
		// 	) {
		// 		return [];
		// 	}
		// 	return buildPreCollapseFlashInstances(
		// 		this.plan,
		// 		this.segments,
		// 		this.config,
		// 		this.config.maxGenerations,
		// 	);
		// }

		if (phase === "idle" || phase === "complete") {
			return [];
		}

		// Holding phase: return all settled instances (opacity handled externally via getFadeOutProgress)
		if (phase === "holding") {
			const instances: SegmentRenderInstance[] = [];
			for (let layer = 1; layer <= this.config.maxGenerations; layer++) {
				instances.push(
					...buildSettledRenderInstancesForLayer(
						this.plan,
						this.segments,
						this.config,
						layer,
					),
				);
			}
			return instances;
		}

		if (phase === "hold") {
			return buildSettledRenderInstancesForLayer(
				this.plan,
				this.segments,
				this.config,
				currentLayer,
			);
		}

		return buildSwipeRenderInstancesForLayer(
			this.plan,
			this.config,
			currentLayer,
			this.getSwipeProgress(),
		);
	}

	getSettledByLayer(): Map<number, SegmentRenderInstance[]> {
		const maxSettledLayer = this.getMaxSettledLayer();
		const settled = new Map<number, SegmentRenderInstance[]>();

		for (let layer = 1; layer <= maxSettledLayer; layer++) {
			settled.set(
				layer,
				buildSettledRenderInstancesForLayer(
					this.plan,
					this.segments,
					this.config,
					layer,
				),
			);
		}

		return settled;
	}

	getBlackFillInstances(): BlackFillRenderInstance[] {
		if (this.state.phase === "swipe" || this.state.phase === "hold") {
			return buildBlackFillRenderInstancesForLayer(
				this.plan,
				this.config,
				this.state.currentLayer,
			);
		}
		return [];
	}

	getCommittedBlackFills(): Map<number, BlackFillRenderInstance[]> {
		// Collapse disabled: these phases are no longer entered
		// if (
		// 	this.state.phase === "preCollapse" ||
		// 	this.state.phase === "collapsing"
		// ) {
		// 	return new Map();
		// }

		const maxSettledLayer = this.getMaxSettledLayer();
		const fills = new Map<number, BlackFillRenderInstance[]>();

		for (let layer = 1; layer <= maxSettledLayer; layer++) {
			const layerFills = buildBlackFillRenderInstancesForLayer(
				this.plan,
				this.config,
				layer,
			);
			for (const fill of layerFills) {
				if (fill.sourceLayer > maxSettledLayer) continue;
				const existing = fills.get(fill.sourceLayer);
				if (existing) {
					existing.push(fill);
				} else {
					fills.set(fill.sourceLayer, [fill]);
				}
			}
		}

		return fills;
	}

	getCurrentLayer(): number {
		return this.state.currentLayer;
	}

	/** Returns 0..1 fade-out progress during holding phase (0 = fully visible, 1 = fully faded) */
	getFadeOutProgress(): number {
		if (this.state.phase !== "holding") return 0;
		return Math.min(this.state.phaseTime / this.config.holdAfterComplete, 1);
	}

	getDebugLabel(): string {
		const { phase, currentLayer, phaseTime } = this.state;
		return `L${currentLayer} | ${phase} | ${phaseTime.toFixed(2)}s`;
	}

	getConnectionLines(): ConnectionLine[] {
		// Collapse disabled: these phases are no longer entered
		// if (this.state.phase === "preCollapse") return this.getStaticLines();
		// if (this.state.phase === "collapsing") return this.getCollapseLines();
		return [];
	}

	// Collapse disabled: getStaticLines and getCollapseLines commented out
	// private getStaticLines(): ConnectionLine[] {
	// 	const lines: ConnectionLine[] = [];
	// 	for (let layer = 1; layer <= this.config.maxGenerations; layer++) {
	// 		for (const leg of this.plan.legsByLayer[layer] ?? []) {
	// 			if (leg.mode !== "settle") continue;
	// 			lines.push({ from: leg.from, to: leg.to });
	// 		}
	// 	}
	// 	return lines;
	// }

	// private getCollapseLines(): ConnectionLine[] {
	// 	const lines: ConnectionLine[] = [];
	// 	const progress = Math.min(
	// 		this.collapseTimer / this.config.collapseDuration,
	// 		1,
	// 	);
	// 	const t = easeOutCubic(progress);
	// 	const collapsing = buildCollapseRenderInstances(
	// 		this.plan,
	// 		this.config,
	// 		this.collapsingLayer,
	// 		t,
	// 	);
	//
	// 	for (const leg of this.plan.legsByLayer[this.collapsingLayer] ?? []) {
	// 		if (leg.mode !== "settle") continue;
	// 		const inst = collapsing.find(
	// 			(candidate) => candidate.segId === leg.segId,
	// 		);
	// 		if (!inst) continue;
	// 		lines.push({
	// 			from: [leg.to[0], leg.to[1], leg.to[2]],
	// 			to: [inst.x, inst.y, inst.z],
	// 		});
	// 	}
	//
	// 	for (let layer = this.collapsingLayer - 1; layer >= 1; layer--) {
	// 		for (const leg of this.plan.legsByLayer[layer] ?? []) {
	// 			if (leg.mode !== "settle") continue;
	// 			lines.push({ from: leg.from, to: leg.to });
	// 		}
	// 	}
	//
	// 	return lines;
	// }

	private getMaxSettledLayer(): number {
		switch (this.state.phase) {
			case "flash":
			case "swipe":
			case "hold":
				return this.state.currentLayer - 1;
			// Collapse disabled: preCollapse no longer entered
			// case "preCollapse":
			// 	return this.config.maxGenerations;
			// case "collapsing":
			case "preCollapse":
			case "collapsing":
			case "holding":
			case "complete":
			case "idle":
				return 0;
		}
	}
}

// Collapse disabled
// function easeOutCubic(t: number): number {
// 	return 1 - (1 - t) ** 3;
// }
