/**
 * types.ts — Layered Shuffle Type Definitions
 *
 * Data structures for the layered shuffle system:
 *   - ShuffleConfig: animation timing & layout parameters
 *   - CompiledPlan: pre-computed shuffle sequence (slot changes, flight legs, mappings)
 *   - BuildState/BuildPhase: runtime state machine for the animation loop
 *
 * Data flow:
 *   SegmentInfo[] + ShuffleConfig → compilePlan() → CompiledPlan → BuildSystem → SegmentMeshes
 */

/** Configuration for the layered shuffle system */
export type ShuffleConfig = {
	/** Derived total layer count for the active plan */
	maxGenerations: number;
	/** Number of bbox flash cycles before swipe (0 to disable) */
	flashCount: number;
	/** Duration of flash-on period in seconds */
	flashOnDuration: number;
	/** Duration of flash-off period in seconds */
	flashOffDuration: number;
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
	/** Duration in seconds for non-active slots to dim (darken) */
	dimFadeInDuration: number;
	/** Duration in seconds for non-active slots to brighten back */
	dimFadeOutDuration: number;
	/** Duration in seconds to hold dim state before brightening starts */
	dimHoldTime: number;
	/** Duration in seconds to dim before swipe starts (0 = dim and swipe start together) */
	dimLeadTime: number;
	/** Minimum layer at which each category begins slot changes (e.g. { sakura: 1, leaf: 4 }) */
	categoryStartLayer: Record<string, number>;
	/** Minimum layer at which each sourceImageId begins participating in slot changes.
	 *  Sources not listed default to 1 (always eligible). */
	sourceImageStartLayer: Record<string, number>;
	/** Number of layers rendered with the base atlas for each category/theme key. */
	categoryBaseLayers: Record<string, number>;
	/** Number of layers rendered with the others atlas after base layers for each key. */
	categoryOthersLayers: Record<string, number>;
	/** Number of slots to switch per category/theme key on each layer. */
	categoryChangeSlotCount: Record<string, number>;
	/** Derived current-category threshold where others atlas begins. */
	contentStartLayer: number;
	/** Derived total layer count per category/theme key. */
	categoryMaxLayer: Record<string, number>;
	/** Derived per-category threshold where others atlas begins. */
	categoryContentStartLayer: Record<string, number>;
};

export const THEME_CATEGORY_NAMES = {
	sakura: "sakurabackground",
	ume: "umebackground",
	fuji: "fujibackground",
	momiji: "momijibackground",
} as const;

/** A single flight leg for one segment between two layers */
export type SegmentLeg = {
	/** Segment ID */
	segId: number;
	/** Layer this leg flies TO */
	toLayer: number;
	/** Mode: "pass" = same position, "settle" = same slot with new content */
	mode: "pass" | "settle";
	/** Source slot index on the previous layer */
	fromSlot: number;
	/** Start position [x, y, z] */
	from: [number, number, number];
	/** End position [x, y, z] */
	to: [number, number, number];
	/** Destination slot index at toLayer */
	destSlot: number;
};

/** GPU-ready data for one segment quad (position, size, atlas selection, wipe state) */
export type SegmentRenderInstance = {
	segId: number;
	x: number;
	y: number;
	z: number;
	w: number;
	h: number;
	useOthersAtlas: number;
	wipeRole: number;
	isBboxOutline: number;
	swipeProgress: number;
};

/** GPU-ready data for a black silhouette at a vacated slot */
export type BlackFillRenderInstance = {
	segId: number;
	x: number;
	y: number;
	z: number;
	w: number;
	h: number;
	/** Layer that receives the black fill (normally the immediately previous layer) */
	sourceLayer: number;
	useOthersAtlas: number;
};

/** A slot whose previous content is masked during a slot switch */
export type VacatedSlot = {
	/** Slot index that was vacated */
	slotIndex: number;
	/** Segment ID that previously occupied this slot (for atlas UV lookup) */
	segId: number;
	/** World position [x, y, z] on the layer where the segment is actually rendered */
	position: [number, number, number];
	/** World size [w, h] matching bboxInSource */
	size: [number, number];
	/** Layer that receives the black fill (normally the immediately previous layer) */
	sourceLayer: number;
};

/** Pre-computed plan for the entire shuffle sequence */
export type CompiledPlan = {
	/** Legs grouped by target layer: legsByLayer[layerIdx] = legs flying TO that layer */
	legsByLayer: SegmentLeg[][];
	/** Slot indices whose displayed segment changed at each layer */
	changedSlotsByLayer: number[][];
	/** Slot-to-segment mapping at each layer after slot changes are applied */
	mappingByLayer: number[][];
	/** Slots vacated by content switches at each layer (black fill targets) */
	vacatedByLayer: VacatedSlot[][];
	/** Effective maximum layer (max of maxGenerations and all categoryMaxLayer values) */
	maxLayer: number;
};

/** Phase of the build state machine */
export type BuildPhase =
	| "flash" // bbox wireframe flash before swipe
	| "dimming" // pre-swipe dim (non-active slots fade before swipe starts)
	| "swipe" // horizontal wipe transition for changed slots
	| "hold" // brief pause after swipe (commit happens inline at end)
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

function normalizeLayerCount(value: number | undefined, fallback = 0): number {
	if (value == null || !Number.isFinite(value)) return fallback;
	return Math.max(0, Math.floor(value));
}

function getCategoryKeys(
	baseLayers: Record<string, number>,
	othersLayers: Record<string, number>,
): string[] {
	return Array.from(
		new Set([...Object.keys(baseLayers), ...Object.keys(othersLayers)]),
	);
}

function buildCategoryMaxLayer(
	baseLayers: Record<string, number>,
	othersLayers: Record<string, number>,
): Record<string, number> {
	const result: Record<string, number> = {};
	for (const key of getCategoryKeys(baseLayers, othersLayers)) {
		result[key] =
			normalizeLayerCount(baseLayers[key]) +
			normalizeLayerCount(othersLayers[key]);
	}
	return result;
}

function buildCategoryContentStartLayer(
	baseLayers: Record<string, number>,
	othersLayers: Record<string, number>,
): Record<string, number> {
	const result: Record<string, number> = {};
	for (const key of getCategoryKeys(baseLayers, othersLayers)) {
		const baseCount = normalizeLayerCount(baseLayers[key]);
		const othersCount = normalizeLayerCount(othersLayers[key]);
		result[key] = othersCount > 0 ? baseCount + 1 : baseCount + othersCount + 1;
	}
	return result;
}

export function getCategoryBaseLayerCount(
	config: ShuffleConfig,
	categoryKey: string,
): number {
	return normalizeLayerCount(config.categoryBaseLayers[categoryKey]);
}

export function getCategoryOthersLayerCount(
	config: ShuffleConfig,
	categoryKey: string,
): number {
	return normalizeLayerCount(config.categoryOthersLayers[categoryKey]);
}

export function getCategoryChangeSlotCount(
	config: ShuffleConfig,
	categoryKey: string,
): number {
	return normalizeLayerCount(config.categoryChangeSlotCount[categoryKey], 1);
}

export function getCategoryTotalLayerCount(
	config: ShuffleConfig,
	categoryKey: string,
): number {
	const derived =
		getCategoryBaseLayerCount(config, categoryKey) +
		getCategoryOthersLayerCount(config, categoryKey);
	if (derived > 0) return derived;
	return normalizeLayerCount(
		config.categoryMaxLayer[categoryKey],
		normalizeLayerCount(config.maxGenerations),
	);
}

/**
 * Compute the effective maximum layer across the provided categories.
 * If no category keys are given, all configured categories are considered.
 */
export function getEffectiveMaxLayer(
	config: ShuffleConfig,
	categoryKeys?: Iterable<string>,
): number {
	const keys = categoryKeys
		? Array.from(new Set(categoryKeys))
		: Array.from(
				new Set([
					...Object.keys(config.categoryBaseLayers),
					...Object.keys(config.categoryOthersLayers),
					...Object.keys(config.categoryMaxLayer),
				]),
			);
	if (keys.length === 0) return normalizeLayerCount(config.maxGenerations);
	return Math.max(
		...keys.map((key) => getCategoryTotalLayerCount(config, key)),
	);
}

/** Default configuration values */
const DEFAULT_CATEGORY_BASE_LAYERS = {
	[THEME_CATEGORY_NAMES.sakura]: 2,
	[THEME_CATEGORY_NAMES.ume]: 1,
	[THEME_CATEGORY_NAMES.fuji]: 2,
	[THEME_CATEGORY_NAMES.momiji]: 2,
};

const DEFAULT_CATEGORY_OTHERS_LAYERS = {
	[THEME_CATEGORY_NAMES.sakura]: 8,
	[THEME_CATEGORY_NAMES.ume]: 3,
	[THEME_CATEGORY_NAMES.fuji]: 1,
	[THEME_CATEGORY_NAMES.momiji]: 3,
};

const DEFAULT_CATEGORY_CHANGE_SLOT_COUNT = {
	[THEME_CATEGORY_NAMES.sakura]: 12,
	[THEME_CATEGORY_NAMES.ume]: 12,
	[THEME_CATEGORY_NAMES.fuji]: 1,
	[THEME_CATEGORY_NAMES.momiji]: 4,
};

const DEFAULT_CATEGORY_MAX_LAYERS = buildCategoryMaxLayer(
	DEFAULT_CATEGORY_BASE_LAYERS,
	DEFAULT_CATEGORY_OTHERS_LAYERS,
);

const DEFAULT_CATEGORY_CONTENT_START_LAYERS = buildCategoryContentStartLayer(
	DEFAULT_CATEGORY_BASE_LAYERS,
	DEFAULT_CATEGORY_OTHERS_LAYERS,
);

export const DEFAULT_CONFIG: ShuffleConfig = {
	maxGenerations: DEFAULT_CATEGORY_MAX_LAYERS[THEME_CATEGORY_NAMES.sakura],
	flashCount: 0,
	flashOnDuration: 0.08,
	flashOffDuration: 0.06,
	swipeDuration: 3.0,
	swipeDurationJitter: 0.0,
	holdDuration: 5.0,
	layerSpacing: 1.5,
	collapseDuration: 0.4,
	collapseStagger: 0.2,
	holdAfterComplete: 4.0,
	dimFadeInDuration: 3.5,
	dimFadeOutDuration: 4.5,
	dimHoldTime: 1.7,
	dimLeadTime: 1.7,
	categoryStartLayer: { sakura: 1, leaf: 4, flower: 7 },
	sourceImageStartLayer: {
		"花陽ひいなかた-2_s03_str0.600_seed45": 4,
		"花鳥雛形-107_s01_str0.400_seed43": 4,
	},
	categoryBaseLayers: DEFAULT_CATEGORY_BASE_LAYERS,
	categoryOthersLayers: DEFAULT_CATEGORY_OTHERS_LAYERS,
	categoryChangeSlotCount: DEFAULT_CATEGORY_CHANGE_SLOT_COUNT,
	contentStartLayer:
		DEFAULT_CATEGORY_CONTENT_START_LAYERS[THEME_CATEGORY_NAMES.sakura],
	categoryMaxLayer: DEFAULT_CATEGORY_MAX_LAYERS,
	categoryContentStartLayer: DEFAULT_CATEGORY_CONTENT_START_LAYERS,
};
