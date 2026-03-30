/**
 * theme-loader.ts — Theme Asset Loading Utilities
 *
 * Pure functions for loading theme manifests, textures, and merging
 * segment content. Extracted from index.tsx for reuse across routes.
 */

import { SRGBColorSpace, type Texture, TextureLoader } from "three";
import { loadAtlasTextures } from "../sakura/segment-manager";
import type { SegmentInfo, SegmentManifest } from "../sakura/types";
import type { SegmentLabelFilter, ThemeConfig } from "./theme-config";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Result of loading all assets for a single theme */
export type ThemeAssets = {
	theme: ThemeConfig;
	segments: SegmentInfo[];
	originalSegments: SegmentInfo[];
	atlasTexture: Texture;
	othersAtlasTexture: Texture | null;
	kimonoTexture: Texture | null;
	/** All textures to dispose on cleanup */
	allTextures: Texture[];
};

// ─── Manifest Loading ───────────────────────────────────────────────────────

/**
 * セグメントマニフェスト（segments.manifest.json）を非同期で取得する。
 * マニフェストには各セグメントの位置・サイズ・アトラス内座標などが定義されている。
 * ロード失敗時は null を返し、画面は何も表示しない（静かに失敗）。
 */
async function loadManifest(basePath: string): Promise<SegmentManifest | null> {
	try {
		const res = await fetch(`${basePath}/segments.manifest.json`);
		if (!res.ok) return null;
		return (await res.json()) as SegmentManifest;
	} catch {
		return null;
	}
}

// ─── Segment Filtering ─────────────────────────────────────────────────────

/**
 * Filter segments by allowed labels.
 * If allowedLabels is null, all segments pass through.
 */
function filterSegmentsByLabel(
	segments: SegmentInfo[],
	allowedLabels: string[] | null,
): SegmentInfo[] {
	if (!allowedLabels) return segments;
	const labelSet = new Set(allowedLabels);
	return segments.filter((s) => s.label != null && labelSet.has(s.label));
}

// ─── Segment Merging ────────────────────────────────────────────────────────

/** サイズ比がこの閾値を超えるペアはスワップしない（面積比） */
const SWAP_SIZE_RATIO_MAX = 4.0;

/**
 * 元のセグメント配列のレイアウト（bboxInSource, originalSize）を維持しつつ、
 * 描画内容（uvRect, trimmedSize, pixelRect）を "others" マニフェストのセグメントに差し替える。
 * others のセグメント数が足りない場合はサイクリックに再利用する。
 */
export function mergeSegmentsWithOthersContent(
	layoutSegments: SegmentInfo[],
	contentSegments: SegmentInfo[],
): SegmentInfo[] {
	const area = (s: SegmentInfo) => s.originalSize[0] * s.originalSize[1];
	const contentCount = contentSegments.length;

	return layoutSegments.map((seg, i) => {
		const content = contentSegments[i % contentCount];
		const layoutArea = area(seg);
		const contentArea = area(content);
		const ratio =
			contentArea > layoutArea
				? contentArea / layoutArea
				: layoutArea / contentArea;

		// サイズ差が大きすぎる場合はスワップせず元のまま
		if (ratio > SWAP_SIZE_RATIO_MAX) {
			return seg;
		}

		return {
			...seg,
			uvRect: content.uvRect,
			trimmedSize: content.trimmedSize,
			pixelRect: content.pixelRect,
			atlasPage: content.atlasPage,
		};
	});
}

// ─── Theme Asset Loading ────────────────────────────────────────────────────

/**
 * Load all assets for a given theme configuration.
 * Returns null if the layout manifest or atlas fails to load.
 */
export async function loadThemeAssets(
	theme: ThemeConfig,
	signal?: AbortSignal,
): Promise<ThemeAssets | null> {
	const textures: Texture[] = [];

	// Load layout manifest (required)
	const layoutManifest = await loadManifest(theme.layoutBasePath);
	if (!layoutManifest || signal?.aborted) return null;

	// Load content (others) manifest (optional)
	const contentManifest = theme.contentBasePath
		? await loadManifest(theme.contentBasePath)
		: null;
	if (signal?.aborted) return null;

	// Filter segments by theme's label config
	const filteredLayoutSegments = filterSegmentsByLabel(
		layoutManifest.segments,
		theme.segmentLabels.layout,
	);
	const originalSegments = filteredLayoutSegments;

	// Merge content if available
	let segments: SegmentInfo[];
	if (contentManifest) {
		const filteredContentSegments = filterSegmentsByLabel(
			contentManifest.segments,
			theme.segmentLabels.content,
		);
		segments = mergeSegmentsWithOthersContent(
			filteredLayoutSegments,
			filteredContentSegments,
		);
	} else {
		segments = filteredLayoutSegments;
	}

	// Load layout atlas (required)
	let atlasTexture: Texture;
	try {
		const loaded = await loadAtlasTextures(
			layoutManifest,
			`${theme.layoutBasePath}/atlas`,
		);
		if (signal?.aborted) return null;
		textures.push(...loaded);
		if (loaded.length === 0) return null;
		atlasTexture = loaded[0];
	} catch {
		return null;
	}

	// Load others atlas (optional)
	let othersAtlasTexture: Texture | null = null;
	if (contentManifest && theme.contentBasePath) {
		try {
			const loaded = await loadAtlasTextures(
				contentManifest,
				`${theme.contentBasePath}/atlas`,
			);
			if (signal?.aborted) return null;
			textures.push(...loaded);
			if (loaded.length > 0) {
				othersAtlasTexture = loaded[0];
			}
		} catch {
			// Others atlas is optional — continue without it
		}
	}

	// Load background image
	let kimonoTexture: Texture | null = null;
	try {
		const loader = new TextureLoader();
		const bgTex = await loader.loadAsync(theme.backgroundPath);
		if (signal?.aborted) return null;
		bgTex.colorSpace = SRGBColorSpace;
		textures.push(bgTex);
		kimonoTexture = bgTex;
	} catch {
		// Background is optional — continue without it
	}

	return {
		theme,
		segments,
		originalSegments,
		atlasTexture,
		othersAtlasTexture,
		kimonoTexture,
		allTextures: textures,
	};
}
