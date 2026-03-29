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
		contentBasePath: "/sakuraothers",
		backgroundPath: "/sakura/kimono_bg_inv.jpg",
		available: true,
	},
	{
		id: "ume",
		displayName: "梅",
		layoutBasePath: "/ume",
		contentBasePath: "/umeothers",
		backgroundPath: "/ume/output-2a-2x-inv-refine.png",
		available: true,
	},
	{
		id: "fuji",
		displayName: "藤",
		layoutBasePath: "/fuji",
		contentBasePath: null,
		backgroundPath: "/fuji/output-2-2x-inv.png",
		available: true,
	},
	{
		id: "momiji",
		displayName: "紅葉",
		layoutBasePath: "/momiji",
		contentBasePath: "/momijibackground",
		backgroundPath: "/momiji/output-3-2x-inv.png",
		available: true,
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
