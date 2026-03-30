/**
 * types.ts — Theme Transition Type Definitions
 *
 * Data structures for the theme transition animation system:
 *   - TransitionPhase: the four sequential phases of a theme switch
 *   - TransitionConfig: timing and stagger parameters
 *   - SegmentTransitionState: per-segment animation state
 *   - BackgroundTransitionState: background tile animation state
 */

/** Sequential phases of a theme transition */
export type TransitionPhase =
	| "scatter-out"
	| "blackout"
	| "gather-in"
	| "complete";

/** Configuration for theme transition timing and stagger */
export type TransitionConfig = {
	/** Duration of the scatter-out phase in seconds */
	scatterDuration: number;
	/** Duration of the blackout (hold) phase in seconds */
	blackoutDuration: number;
	/** Duration of the gather-in phase in seconds */
	gatherDuration: number;
	/** Weights for stagger priority calculation */
	staggerWeights: {
		/** Weight for edge distance (0-1) */
		edge: number;
		/** Weight for seeded noise (0-1) */
		noise: number;
		/** Weight for normalized area (0-1) */
		area: number;
	};
	/** Seed for deterministic noise in stagger calculation */
	noiseSeed: number;
	/** Number of Voronoi seed points for background fragmentation */
	bgFragmentCount: number;
	/** How much individual directions deviate from unified direction (0=identical, 1=full spread) */
	directionSpread: number;
	/** Max stagger spread for scatter-out (0..1 of phase duration) */
	staggerOutDuration: number;
	/** Max stagger spread for gather-in (0..1 of phase duration) */
	staggerInDuration: number;
	/** Theme ID of the old (outgoing) theme — determines scatter-out direction */
	oldThemeId: string;
	/** Theme ID of the new (incoming) theme — determines gather-in direction */
	newThemeId: string;
};

/** Per-segment state during a transition */
export type SegmentTransitionState = {
	/** Stable transition-state index */
	index: number;
	/** Actual segment ID used for atlas lookup/rendering */
	segId: number;
	/** Stagger start delay (0..1 normalized within phase duration) */
	startDelay: number;
	/** Exit/entry direction as normalized screen-space vector */
	exitDirection: [number, number];
	/** Stagger priority (higher = exits earlier in scatter, enters later in gather) */
	priority: number;
	/** Category name for gather-in grouping */
	categoryName: string;
};

/** Per-fragment animation state (built at transition start) */
export type BackgroundFragmentState = {
	/** Fragment index */
	fragmentIndex: number;
	/** Centroid in world coordinates [x, y] */
	centroid: [number, number];
	/** Exit direction (unified with slight per-fragment variation) */
	exitDirection: [number, number];
	/** Stagger delay (0..1) — background lags behind segments by half-beat */
	startDelay: number;
};

/** Per-fragment render state computed each frame */
export type BackgroundFragmentRenderState = {
	/** Fragment index */
	fragmentIndex: number;
	/** Translation offset from base position [dx, dy] */
	translateOffset: [number, number];
	/** Opacity (0..1) */
	opacity: number;
};

/** State of the background during transition */
export type BackgroundTransitionState = {
	/** Per-fragment render states */
	fragmentRenderStates: BackgroundFragmentRenderState[];
};

/** Default transition configuration */
export const DEFAULT_TRANSITION_CONFIG: TransitionConfig = {
	scatterDuration: 2.5,
	blackoutDuration: 2.5,
	gatherDuration: 3.8,
	staggerWeights: {
		edge: 0.6,
		noise: 0.25,
		area: 0.15,
	},
	noiseSeed: 42,
	bgFragmentCount: 160,
	directionSpread: 0.15,
	staggerOutDuration: 0.8,
	staggerInDuration: 0.8,
	oldThemeId: "sakura",
	newThemeId: "ume",
};
