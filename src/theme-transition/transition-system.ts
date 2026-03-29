/**
 * transition-system.ts — Theme Transition State Machine
 *
 * Manages the four-phase transition between themes:
 *   1. scatter-out: segments fly to nearest screen edge with staggered timing
 *   2. blackout: hold on black, dispose old textures, wait for new assets
 *   3. gather-in: new segments fly in from edges with category-grouped stagger
 *   4. complete: transition finished
 *
 * Key design decisions:
 *   - Scatter-out stagger: priority = edgeDistance * 0.6 + noise * 0.25 + area * 0.15
 *   - Exit direction: screen-space nearest edge
 *   - Different easing for position vs opacity (cubic vs quad/smoothstep)
 *   - Background lags segments by half-beat with 8-16 tile coarse splitting
 *   - Gather-in uses category-based grouping (different from scatter-out's edge-based)
 */

import { KIMONO_SIZE } from "../sakura/constants";
import type { SegmentInfo } from "../sakura/types";
import type { SegmentRenderInstance } from "../layered-shuffle/types";
import type {
	BackgroundTransitionState,
	BackgroundFragmentRenderState,
	BackgroundFragmentState,
	SegmentTransitionState,
	TransitionConfig,
	TransitionPhase,
} from "./types";
import { DEFAULT_TRANSITION_CONFIG } from "./types";
import {
	generateVoronoiFragments,
	disposeFragments,
	type VoronoiFragment,
} from "./voronoi-fragments";

// ─── Easing Functions ────────────────────────────────────────────────────────

function easeInCubic(t: number): number {
	return t * t * t;
}

function easeOutCubic(t: number): number {
	const t1 = t - 1;
	return t1 * t1 * t1 + 1;
}

function easeInQuad(t: number): number {
	return t * t;
}

function smoothstep(t: number): number {
	return t * t * (3 - 2 * t);
}

// ─── Seeded RNG (Mulberry32) ─────────────────────────────────────────────────

function seededRandom(seed: number): () => number {
	let s = seed | 0;
	return () => {
		s = (s + 0x6d2b79f5) | 0;
		let t = Math.imul(s ^ (s >>> 15), 1 | s);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// ─── Helper: Pick a unified exit direction based on seed ─────────────────────

/** Cardinal directions to choose from */
const DIRECTIONS: Array<[number, number]> = [
	[-1, 0], // left
	[1, 0],  // right
	[0, -1], // down
	[0, 1],  // up
];

function pickUnifiedDirection(seed: number): [number, number] {
	const idx = Math.abs(seed) % DIRECTIONS.length;
	return DIRECTIONS[idx];
}

/**
 * Apply small per-element variation to a unified direction.
 * spread=0 means identical, spread=1 means up to ±45° deviation.
 */
function varyDirection(
	base: [number, number],
	rng: () => number,
	spread: number,
): [number, number] {
	const angle = Math.atan2(base[1], base[0]);
	const deviation = (rng() - 0.5) * spread * Math.PI * 0.5; // ±45° max
	const newAngle = angle + deviation;
	return [Math.cos(newAngle), Math.sin(newAngle)];
}


// ─── Helper: Build fragment animation states from Voronoi cells ─────────────

function buildFragmentStates(
	fragments: VoronoiFragment[],
	unifiedDir: [number, number],
	rng: () => number,
	directionSpread: number,
): BackgroundFragmentState[] {
	const half = KIMONO_SIZE / 2;

	return fragments.map((frag) => {
		const [cx, cy] = frag.centroid;
		const dir = varyDirection(unifiedDir, rng, directionSpread);

		// Stagger: project centroid onto exit direction axis
		const projectedDist = cx * unifiedDir[0] + cy * unifiedDir[1];
		const normalizedDist = (projectedDist + half) / KIMONO_SIZE; // 0..1
		const startDelay = (1 - normalizedDist) * 0.4;

		return {
			fragmentIndex: frag.index,
			centroid: [cx, cy] as [number, number],
			exitDirection: dir,
			startDelay,
		};
	});
}

// ─── ThemeTransitionSystem ──────────────────────────────────────────────────

export class ThemeTransitionSystem {
	readonly config: TransitionConfig;

	private phase: TransitionPhase = "scatter-out";
	private phaseTime = 0;
	private totalTime = 0;

	/** Unified exit direction for all elements */
	private unifiedDirection: [number, number];

	/** Per-segment transition states (scatter-out ordering) */
	private scatterStates: SegmentTransitionState[] = [];
	/** Per-segment transition states (gather-in ordering) */
	private gatherStates: SegmentTransitionState[] = [];

	/** Voronoi fragments for background */
	private bgFragments: VoronoiFragment[] = [];
	/** Per-fragment animation states */
	private bgFragmentStates: BackgroundFragmentState[] = [];

	/** Segments for the old theme (scatter-out) */
	private oldSegments: SegmentInfo[] = [];
	/** Segments for the new theme (gather-in) */
	private newSegments: SegmentInfo[] = [];

	/** Base positions for old segments (where they start from) */
	private oldBasePositions: Array<{ x: number; y: number; w: number; h: number }> = [];
	/** Base positions for new segments (where they land) */
	private newBasePositions: Array<{ x: number; y: number; w: number; h: number }> = [];

	/** Callback when old textures can be safely disposed */
	private onOldTexturesDisposable: (() => void) | null = null;
	private disposeNotified = false;
	private blackoutFrameCount = 0;

	/** Whether new assets have been loaded */
	private newAssetsReady = false;

	/** Whether load failed (triggers fallback) */
	private loadFailed = false;

	constructor(
		oldSegments: SegmentInfo[],
		config?: Partial<TransitionConfig>,
	) {
		this.config = { ...DEFAULT_TRANSITION_CONFIG, ...config };
		this.unifiedDirection = pickUnifiedDirection(this.config.noiseSeed);
		this.oldSegments = oldSegments;
		this.oldBasePositions = this.computeBasePositions(oldSegments);
		this.scatterStates = this.buildScatterStates(oldSegments);

		// Generate Voronoi background fragments (unique per transition via seed)
		this.bgFragments = generateVoronoiFragments(
			this.config.bgFragmentCount,
			this.config.noiseSeed + 500,
		);
		const bgRng = seededRandom(this.config.noiseSeed + 500);
		this.bgFragmentStates = buildFragmentStates(
			this.bgFragments,
			this.unifiedDirection,
			bgRng,
			this.config.directionSpread,
		);
	}

	// ─── Public API ──────────────────────────────────────────────────────────

	/** Get the Voronoi fragment geometries for rendering */
	getFragments(): VoronoiFragment[] {
		return this.bgFragments;
	}

	/** Dispose Voronoi fragment geometries */
	disposeFragments(): void {
		disposeFragments(this.bgFragments);
	}

	/** Set the new theme's segments once loaded */
	setNewAssets(newSegments: SegmentInfo[]): void {
		this.newSegments = newSegments;
		this.newBasePositions = this.computeBasePositions(newSegments);
		this.gatherStates = this.buildGatherStates(newSegments);
		this.newAssetsReady = true;
	}

	/** Mark asset loading as failed — will skip to complete and restore old theme */
	setLoadFailed(): void {
		this.loadFailed = true;
	}

	/** Set dispose callback for old textures */
	onDispose(callback: () => void): void {
		this.onOldTexturesDisposable = callback;
	}

	/** Get current transition phase */
	getPhase(): TransitionPhase {
		return this.phase;
	}

	/** Get current phase time */
	getPhaseTime(): number {
		return this.phaseTime;
	}

	/** Advance the transition by dt seconds */
	update(dt: number): void {
		this.totalTime += dt;
		this.phaseTime += dt;

		switch (this.phase) {
			case "scatter-out":
				this.updateScatterOut();
				break;
			case "blackout":
				this.updateBlackout(dt);
				break;
			case "gather-in":
				this.updateGatherIn();
				break;
			case "complete":
				// No-op: transition is done
				break;
		}
	}

	/** Get current segment render instances for display */
	getInstances(): SegmentRenderInstance[] {
		switch (this.phase) {
			case "scatter-out":
				return this.getScatterOutInstances();
			case "blackout":
				return [];
			case "gather-in":
				return this.getGatherInInstances();
			case "complete":
				return [];
		}
	}

	/** Get current background state with per-fragment translate/opacity */
	getBackgroundState(): BackgroundTransitionState {
		switch (this.phase) {
			case "scatter-out":
				return this.getScatterOutBgState();
			case "blackout":
				return { fragmentRenderStates: [] };
			case "gather-in":
				return this.getGatherInBgState();
			case "complete":
				return {
					fragmentRenderStates: this.bgFragmentStates.map((fs) => ({
						fragmentIndex: fs.fragmentIndex,
						translateOffset: [0, 0],
						opacity: 1,
					})),
				};
		}
	}

	/** Get the segments array to use for UV lookups in the current phase */
	getCurrentSegments(): SegmentInfo[] {
		if (this.phase === "gather-in" || this.phase === "complete") {
			return this.newSegments.length > 0 ? this.newSegments : this.oldSegments;
		}
		return this.oldSegments;
	}

	// ─── Phase Updates ───────────────────────────────────────────────────────

	private updateScatterOut(): void {
		const progress = this.phaseTime / this.config.scatterDuration;
		if (progress >= 1) {
			this.phase = "blackout";
			this.phaseTime = 0;
			this.blackoutFrameCount = 0;
		}
	}

	private updateBlackout(_dt: number): void {
		this.blackoutFrameCount += 1;

		// Wait 1 frame after full black before disposing old textures
		if (this.blackoutFrameCount >= 2 && !this.disposeNotified) {
			this.disposeNotified = true;
			this.onOldTexturesDisposable?.();
		}

		// Handle load failure: skip to complete
		if (this.loadFailed) {
			this.phase = "complete";
			this.phaseTime = 0;
			return;
		}

		// Wait for new assets + minimum blackout duration
		if (
			this.newAssetsReady &&
			this.phaseTime >= this.config.blackoutDuration
		) {
			this.phase = "gather-in";
			this.phaseTime = 0;
		}
	}

	private updateGatherIn(): void {
		const progress = this.phaseTime / this.config.gatherDuration;
		if (progress >= 1) {
			this.phase = "complete";
			this.phaseTime = 0;
		}
	}

	// ─── Instance Generation ─────────────────────────────────────────────────

	private getScatterOutInstances(): SegmentRenderInstance[] {
		const progress = Math.min(
			1,
			this.phaseTime / this.config.scatterDuration,
		);
		const instances: SegmentRenderInstance[] = [];
		const exitDistance = KIMONO_SIZE * 1.5; // fly well off-screen

		for (const state of this.scatterStates) {
			const base = this.oldBasePositions[state.segId];
			if (!base) continue;

			// Staggered progress: each segment starts at its delay
			const segProgress = Math.max(
				0,
				Math.min(1, (progress - state.startDelay) / (1 - state.startDelay)),
			);

			// Position: easeInCubic for acceleration feel
			const posT = easeInCubic(segProgress);
			const x = base.x + state.exitDirection[0] * exitDistance * posT;
			const y = base.y + state.exitDirection[1] * exitDistance * posT;

			instances.push({
				segId: state.segId,
				x,
				y,
				z: 0,
				w: base.w,
				h: base.h,
				useOthersAtlas: 0,
				wipeRole: 0,
				isBboxOutline: 0,
				swipeProgress: 0,
			});

			// Encode opacity into the last instance — SegmentMeshRenderer uses
			// opacityOverride via writeInstances. We'll handle this via a modified approach.
			// For now, we embed opacity directly in a way the renderer can consume.
			// We use a simple approach: the parent will read opacity from a separate map.
		}

		return instances;
	}

	/** Get opacity map for current scatter-out state */
	getOpacityMap(): Map<number, number> {
		const map = new Map<number, number>();

		if (this.phase === "scatter-out") {
			const progress = Math.min(
				1,
				this.phaseTime / this.config.scatterDuration,
			);
			for (const state of this.scatterStates) {
				const segProgress = Math.max(
					0,
					Math.min(
						1,
						(progress - state.startDelay) / (1 - state.startDelay),
					),
				);
				map.set(state.segId, 1 - easeInQuad(segProgress));
			}
		} else if (this.phase === "gather-in") {
			const progress = Math.min(
				1,
				this.phaseTime / this.config.gatherDuration,
			);
			for (const state of this.gatherStates) {
				const segProgress = Math.max(
					0,
					Math.min(
						1,
						(progress - state.startDelay) / (1 - state.startDelay),
					),
				);
				map.set(state.segId, smoothstep(segProgress));
			}
		}

		return map;
	}

	private getGatherInInstances(): SegmentRenderInstance[] {
		const progress = Math.min(
			1,
			this.phaseTime / this.config.gatherDuration,
		);
		const instances: SegmentRenderInstance[] = [];
		const entryDistance = KIMONO_SIZE * 1.5;

		for (const state of this.gatherStates) {
			const base = this.newBasePositions[state.segId];
			if (!base) continue;

			// Staggered progress
			const segProgress = Math.max(
				0,
				Math.min(1, (progress - state.startDelay) / (1 - state.startDelay)),
			);

			// Position: easeOutCubic for deceleration feel (coming in from outside)
			const posT = easeOutCubic(segProgress);
			// Start from outside (1 - posT), end at base position
			const startX =
				base.x - state.exitDirection[0] * entryDistance;
			const startY =
				base.y - state.exitDirection[1] * entryDistance;
			const x = startX + (base.x - startX) * posT;
			const y = startY + (base.y - startY) * posT;

			instances.push({
				segId: state.segId,
				x,
				y,
				z: 0,
				w: base.w,
				h: base.h,
				useOthersAtlas: 0,
				wipeRole: 0,
				isBboxOutline: 0,
				swipeProgress: 0,
			});
		}

		return instances;
	}

	// ─── Background State ────────────────────────────────────────────────────

	private getScatterOutBgState(): BackgroundTransitionState {
		const progress = Math.min(1, this.phaseTime / this.config.scatterDuration);
		const exitDistance = KIMONO_SIZE * 1.5;
		const fragmentRenderStates: BackgroundFragmentRenderState[] = [];

		for (const fs of this.bgFragmentStates) {
			// Background lags segments: effective progress starts later
			const laggedProgress = Math.max(0, (progress - 0.3) / 0.7);
			const fragProgress = Math.max(
				0,
				Math.min(1, (laggedProgress - fs.startDelay) / (1 - fs.startDelay)),
			);

			const posT = easeInCubic(fragProgress);
			const opacityT = easeInQuad(fragProgress);

			fragmentRenderStates.push({
				fragmentIndex: fs.fragmentIndex,
				translateOffset: [
					fs.exitDirection[0] * exitDistance * posT,
					fs.exitDirection[1] * exitDistance * posT,
				],
				opacity: 1 - opacityT,
			});
		}

		return { fragmentRenderStates };
	}

	private getGatherInBgState(): BackgroundTransitionState {
		const progress = Math.min(1, this.phaseTime / this.config.gatherDuration);
		const entryDistance = KIMONO_SIZE * 1.5;
		const fragmentRenderStates: BackgroundFragmentRenderState[] = [];

		for (const fs of this.bgFragmentStates) {
			const laggedProgress = Math.max(0, (progress - 0.3) / 0.7);
			const fragProgress = Math.max(
				0,
				Math.min(1, (laggedProgress - fs.startDelay) / (1 - fs.startDelay)),
			);

			const posT = easeOutCubic(fragProgress);
			const opacityT = smoothstep(fragProgress);

			// Start from outside (full offset), arrive at base (0 offset)
			const fullOffsetX = -fs.exitDirection[0] * entryDistance;
			const fullOffsetY = -fs.exitDirection[1] * entryDistance;

			fragmentRenderStates.push({
				fragmentIndex: fs.fragmentIndex,
				translateOffset: [
					fullOffsetX * (1 - posT),
					fullOffsetY * (1 - posT),
				],
				opacity: opacityT,
			});
		}

		return { fragmentRenderStates };
	}

	// ─── State Builders ──────────────────────────────────────────────────────

	private computeBasePositions(
		segments: SegmentInfo[],
	): Array<{ x: number; y: number; w: number; h: number }> {
		return segments.map((seg) => {
			const cx =
				(seg.bboxInSource[0] + seg.bboxInSource[2] * 0.5) /
				seg.originalSize[0];
			const cy =
				(seg.bboxInSource[1] + seg.bboxInSource[3] * 0.5) /
				seg.originalSize[1];
			const bboxW = seg.bboxInSource[2] / seg.originalSize[0];
			const bboxH = seg.bboxInSource[3] / seg.originalSize[1];
			return {
				x: (cx - 0.5) * KIMONO_SIZE,
				y: -(cy - 0.5) * KIMONO_SIZE,
				w: bboxW * KIMONO_SIZE,
				h: bboxH * KIMONO_SIZE,
			};
		});
	}

	private buildScatterStates(
		segments: SegmentInfo[],
	): SegmentTransitionState[] {
		const rng = seededRandom(this.config.noiseSeed);
		const positions = this.oldBasePositions;
		const { edge, noise, area } = this.config.staggerWeights;
		const half = KIMONO_SIZE / 2;

		// Compute areas for normalization
		const areas = segments.map(
			(seg) => seg.bboxInSource[2] * seg.bboxInSource[3],
		);
		const maxArea = Math.max(...areas, 1);

		const states: SegmentTransitionState[] = segments.map((seg, i) => {
			const pos = positions[i];
			const noiseVal = rng();
			const normalizedArea = areas[i] / maxArea;

			// Stagger based on projection onto unified direction:
			// segments aligned with exit direction leave first
			const projectedDist =
				pos.x * this.unifiedDirection[0] + pos.y * this.unifiedDirection[1];
			const normalizedProj = (projectedDist + half) / KIMONO_SIZE; // 0..1

			const priority =
				(1 - normalizedProj) * edge + noiseVal * noise + normalizedArea * area;

			return {
				segId: i,
				startDelay: priority * this.config.staggerOutDuration,
				exitDirection: varyDirection(
					this.unifiedDirection,
					rng,
					this.config.directionSpread,
				),
				priority,
				categoryName: seg.categoryName,
			};
		});

		return states;
	}

	private buildGatherStates(
		segments: SegmentInfo[],
	): SegmentTransitionState[] {
		const rng = seededRandom(this.config.noiseSeed + 1000);

		// Group by category for category-based stagger
		const categoryGroups = new Map<string, number[]>();
		for (let i = 0; i < segments.length; i++) {
			const cat = segments[i].categoryName;
			let group = categoryGroups.get(cat);
			if (!group) {
				group = [];
				categoryGroups.set(cat, group);
			}
			group.push(i);
		}

		const sortedCategories = [...categoryGroups.keys()].sort();
		const categoryOrder = new Map<string, number>();
		sortedCategories.forEach((cat, idx) => {
			categoryOrder.set(cat, idx);
		});

		const totalCategories = sortedCategories.length;

		// Gather uses opposite direction (elements come from the opposite side)
		const gatherDir: [number, number] = [
			-this.unifiedDirection[0],
			-this.unifiedDirection[1],
		];

		const states: SegmentTransitionState[] = segments.map((seg, i) => {
			const catIdx = categoryOrder.get(seg.categoryName) ?? 0;
			const noiseVal = rng();

			const categoryDelay =
				totalCategories > 1 ? catIdx / totalCategories : 0;
			const priority = categoryDelay * 0.7 + noiseVal * 0.3;

			return {
				segId: i,
				startDelay: priority * this.config.staggerInDuration,
				exitDirection: varyDirection(
					gatherDir,
					rng,
					this.config.directionSpread,
				),
				priority,
				categoryName: seg.categoryName,
			};
		});

		return states;
	}
}
