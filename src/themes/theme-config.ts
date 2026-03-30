/**
 * theme-config.ts — Theme Sequence Configuration
 *
 * Defines the sequential theme rotation order (sakura -> ume -> fuji -> momiji).
 * Each theme specifies paths to its layout assets, content (others) assets,
 * and background image.
 *
 * Data flow:
 *   ThemeSequence → Scene (index.tsx) → loadManifest / loadAtlasTextures
 */

/** Segment label filters per category */
export type SegmentLabelFilter = {
	/** Labels to include from the layout manifest (null = use all) */
	layout: string[] | null;
	/** Labels to include from the content manifest (null = use all) */
	content: string[] | null;
};

/** Black fill scale per category (how much larger to draw the black silhouette) */
export type BlackFillScale = {
	/** Scale factor for layout segments (default: 1.15) */
	layout: number;
	/** Scale factor for content segments (default: 1.15) */
	content: number;
};

/** A single theme's asset paths and display metadata */
export type ThemeConfig = {
	/** Unique identifier for the theme */
	id: string;
	/** Display name (Japanese) */
	displayName: string;
	/** Base path for layout segments (segments.manifest.json + atlas/) */
	layoutBasePath: string;
	/** Base path for content (others) segments, or null if same as layout */
	contentBasePath: string | null;
	/** Path to kimono background image */
	backgroundPath: string;
	/** Whether the theme's assets are available (false = placeholder for future) */
	available: boolean;
	/** Segment label filters — which labels to use per category */
	segmentLabels: SegmentLabelFilter;
	/** Black fill scale per category */
	blackFillScale: BlackFillScale;
};

/**
 * Ordered theme sequence. Themes rotate in this order.
 * Unavailable themes are skipped during rotation.
 */
export const THEME_SEQUENCE: ThemeConfig[] = [
	
	{
		id: "sakura",
		displayName: "桜",
		layoutBasePath: "/sakura",
		contentBasePath: "/sakurabackground",
		backgroundPath: "/sakura/kimono_bg_inv.jpg",
		available: true,
		segmentLabels: {
			layout: ["sakura"],
			content: ["sakura"]
		},
		blackFillScale: {
			layout: 1.15,
			content: 1.15,
		},
	},
	{
		id: "ume",
		displayName: "梅",
		layoutBasePath: "/ume",
		contentBasePath: "/umebackground",
		backgroundPath: "/ume/output-2a-2x-inv-refine-vec.png",
		available: true,
		segmentLabels: {
			layout: ["ume"],
			content: ["ume"],
		},
		blackFillScale: {
			layout: 1.15,
			content: 1.15,
		},
	},
{
		id: "momiji",
		displayName: "紅葉",
		layoutBasePath: "/momiji",
		contentBasePath: "/momijibackground",
		backgroundPath: "/momiji/output-3-2x-inv-vec.png",
		available: true,
		segmentLabels: {
			layout: ["momiji(black)"],
			content: ["momiji"],
		},
		blackFillScale: {
			layout: 1.3,
			content: 1.3,
		},
	},

	{
		id: "fuji",
		displayName: "藤",
		layoutBasePath: "/fuji",
		contentBasePath: "/fujibackground",
		backgroundPath: "/fuji/output-2-2x-inv-vec.png",
		available: true,
		segmentLabels: {
			layout: ["fuji"],
			content: ["fuji"],
		},
		blackFillScale: {
			layout: 1.3,
			content: 1.3,
		},
	},
	];

/** Get only the available themes for runtime rotation */
export function getAvailableThemes(): ThemeConfig[] {
	return THEME_SEQUENCE.filter((t) => t.available);
}

/** Get the next theme index in the available sequence (wraps around) */
export function getNextThemeIndex(
	currentIndex: number,
	availableThemes: ThemeConfig[],
): number {
	return (currentIndex + 1) % availableThemes.length;
}
