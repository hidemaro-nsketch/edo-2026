/**
 * debug-layers.tsx — レイヤー別セグメント配置デバッグページ（"/debug-layers" ルート）
 *
 * compilePlan の各レイヤーで「どのスロットにどのセグメントが入るか」を
 * 512×512 の 2D Canvas で横に並べて表示する。
 * othersアトラスの contain サイズが正しくスロットに収まるか確認する用途。
 */

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { compilePlan } from "../layered-shuffle/compiled-plan";
import {
	buildBlackFillRenderInstancesForLayer,
	buildSettledRenderInstancesForLayer,
	getAtlasSelectionForLayer,
} from "../layered-shuffle/render-snapshot";
import type { CompiledPlan } from "../layered-shuffle/types";
import { DEFAULT_CONFIG } from "../layered-shuffle/types";
import { computeContainedSize, KIMONO_SIZE } from "../sakura/constants";
import type { SegmentInfo, SegmentManifest } from "../sakura/types";

export const Route = createFileRoute("/debug-layers")({
	component: DebugLayersPage,
});

// ─── Constants ───────────────────────────────────────────────────────────────

const SAKURA_BASE_PATH = "/sakura";
const OTHERS_BASE_PATH = "/sakuraothers";
const KIMONO_BG_PATH = "/kimono_bg_inv.jpg";
const CANVAS_SIZE = 512;
const COLUMNS = 2;
const SWAP_SIZE_RATIO_MAX = 4.0;

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function loadManifest(basePath: string): Promise<SegmentManifest | null> {
	try {
		const res = await fetch(`${basePath}/segments.manifest.json`);
		if (!res.ok) return null;
		return (await res.json()) as SegmentManifest;
	} catch {
		return null;
	}
}

async function loadImage(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = reject;
		img.src = src;
	});
}

function mergeSegmentsWithOthersContent(
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
		if (ratio > SWAP_SIZE_RATIO_MAX) return seg;
		return {
			...seg,
			uvRect: content.uvRect,
			trimmedSize: content.trimmedSize,
			pixelRect: content.pixelRect,
			atlasPage: content.atlasPage,
		};
	});
}

/** World coords → canvas pixel coords (center of segment) */
function worldToCanvas(wx: number, wy: number): [number, number] {
	const cx = ((wx + KIMONO_SIZE / 2) / KIMONO_SIZE) * CANVAS_SIZE;
	const cy = ((-wy + KIMONO_SIZE / 2) / KIMONO_SIZE) * CANVAS_SIZE;
	return [cx, cy];
}

/** World size → canvas pixel size */
function worldSizeToCanvas(ww: number, wh: number): [number, number] {
	return [(ww / KIMONO_SIZE) * CANVAS_SIZE, (wh / KIMONO_SIZE) * CANVAS_SIZE];
}

// ─── Drawing ─────────────────────────────────────────────────────────────────

/** Helper: get canvas position & sizes for a slot */
function getSlotCanvas(
	layoutSegments: SegmentInfo[],
	slot: number,
): { cx: number; cy: number; sw: number; sh: number } {
	const seg = layoutSegments[slot];
	const [bx, by, bw, bh] = seg.bboxInSource;
	const nx = (bx + bw * 0.5) / seg.originalSize[0];
	const ny = (by + bh * 0.5) / seg.originalSize[1];
	const [cx, cy] = worldToCanvas(
		(nx - 0.5) * KIMONO_SIZE,
		-(ny - 0.5) * KIMONO_SIZE,
	);
	const [sw, sh] = worldSizeToCanvas(
		(bw / seg.originalSize[0]) * KIMONO_SIZE,
		(bh / seg.originalSize[1]) * KIMONO_SIZE,
	);
	return { cx, cy, sw, sh };
}

/** Draw a single segment into a slot on the canvas */
function drawSegmentAtSlot(
	ctx: CanvasRenderingContext2D,
	segId: number,
	slot: number,
	layoutSegments: SegmentInfo[],
	mergedSegments: SegmentInfo[],
	originalSegments: SegmentInfo[],
	sakuraAtlas: HTMLImageElement,
	othersAtlas: HTMLImageElement | null,
	useOthers: boolean,
) {
	const seg = useOthers ? mergedSegments[segId] : originalSegments[segId];
	const { cx, cy, sw, sh } = getSlotCanvas(layoutSegments, slot);

	// Contained size (sw/sh are already in canvas pixels, result is also canvas pixels)
	const contentW = useOthers ? seg.trimmedSize[0] : seg.bboxInSource[2];
	const contentH = useOthers ? seg.trimmedSize[1] : seg.bboxInSource[3];
	const [dw, dh] = computeContainedSize(contentW, contentH, sw, sh);

	const atlas = useOthers && othersAtlas ? othersAtlas : sakuraAtlas;
	const [srcX, srcY, srcW, srcH] = seg.pixelRect;
	ctx.drawImage(
		atlas,
		srcX,
		srcY,
		srcW,
		srcH,
		cx - dw / 2,
		cy - dh / 2,
		dw,
		dh,
	);
}

/**
 * Draw the composite top-down view at a given layer.
 *
 * Matches the 3D rendering order:
 *   1. Kimono background
 *   2. Base layer: all segments at identity positions (sakura atlas)
 *   3. For each layer 1..N (bottom to top):
 *      a. Black fills — cover vacated slots on the immediately previous layer
 *      b. Settled segments — swapped segments at their new positions
 *   4. Debug overlays (slot boundaries, swap highlights, labels)
 */
function drawLayer(
	ctx: CanvasRenderingContext2D,
	layer: number,
	plan: CompiledPlan,
	layoutSegments: SegmentInfo[],
	mergedSegments: SegmentInfo[],
	originalSegments: SegmentInfo[],
	sakuraAtlas: HTMLImageElement,
	othersAtlas: HTMLImageElement | null,
	kimonoBg: HTMLImageElement | null,
	contentStartLayer: number,
) {
	ctx.fillStyle = "black";
	ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

	// ── 1. Kimono background ──
	if (kimonoBg) {
		ctx.globalAlpha = 0.5;
		ctx.drawImage(kimonoBg, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
		ctx.globalAlpha = 1.0;
	}

	// ── 2. Base layer: all segments at identity (sakura atlas) ──
	const baseMapping = plan.mappingByLayer[0];
	for (let slot = 0; slot < baseMapping.length; slot++) {
		drawSegmentAtSlot(
			ctx,
			baseMapping[slot],
			slot,
			layoutSegments,
			mergedSegments,
			originalSegments,
			sakuraAtlas,
			othersAtlas,
			false,
		);
	}

	// ── 3. For each layer 1..N: black fills then settled segments ──
	for (let l = 1; l <= layer; l++) {
		const useOthers = getAtlasSelectionForLayer(l, DEFAULT_CONFIG) > 0;

		// 3a. Black fills — vacated slots, cover the old segment underneath
		const blackFills = buildBlackFillRenderInstancesForLayer(
			plan,
			DEFAULT_CONFIG,
			l,
		);
		for (const fill of blackFills) {
			const [bfX, bfY] = worldToCanvas(fill.x, fill.y);
			const BF_SCALE = 1.15; // same as SegmentMeshes.tsx
			const [bfW, bfH] = worldSizeToCanvas(
				fill.w * BF_SCALE,
				fill.h * BF_SCALE,
			);
			ctx.fillStyle = "#000";
			ctx.fillRect(bfX - bfW / 2, bfY - bfH / 2, bfW, bfH);

			// Red outline for debug visibility
			ctx.strokeStyle = "rgba(255, 0, 0, 0.5)";
			ctx.lineWidth = 1;
			ctx.strokeRect(bfX - bfW / 2, bfY - bfH / 2, bfW, bfH);
		}

		// 3b. Settled segments — only swapped segments at their new positions
		const settled = buildSettledRenderInstancesForLayer(
			plan,
			layoutSegments,
			DEFAULT_CONFIG,
			l,
		);
		for (const instance of settled) {
			const slot = plan.mappingByLayer[l].indexOf(instance.segId);
			if (slot < 0) continue;
			drawSegmentAtSlot(
				ctx,
				instance.segId,
				slot,
				layoutSegments,
				mergedSegments,
				originalSegments,
				sakuraAtlas,
				othersAtlas,
				useOthers,
			);
		}
	}

	// ── 4. Debug overlays ──
	const currentMapping = plan.mappingByLayer[layer];

	// Slot boundaries (yellow) + swap highlights (cyan/magenta)
	const swappedSlots = new Set<number>();
	if (layer > 0) {
		for (const [slotA, slotB] of plan.swapsByLayer[layer]) {
			swappedSlots.add(slotA);
			swappedSlots.add(slotB);
		}
	}

	for (let slot = 0; slot < currentMapping.length; slot++) {
		const { cx, cy, sw, sh } = getSlotCanvas(layoutSegments, slot);

		// Slot boundary
		ctx.strokeStyle = "rgba(255, 255, 0, 0.25)";
		ctx.lineWidth = 0.5;
		ctx.strokeRect(cx - sw / 2, cy - sh / 2, sw, sh);

		// Highlight swapped slots at this layer
		if (swappedSlots.has(slot)) {
			ctx.strokeStyle = "rgba(0, 255, 255, 0.8)";
			ctx.lineWidth = 1.5;
			ctx.strokeRect(cx - sw / 2, cy - sh / 2, sw, sh);

			// Contained size boundary (magenta)
			const segId = currentMapping[slot];
			const useOthers = layer >= contentStartLayer;
			const seg = useOthers ? mergedSegments[segId] : originalSegments[segId];
			const contentW = useOthers ? seg.trimmedSize[0] : seg.bboxInSource[2];
			const contentH = useOthers ? seg.trimmedSize[1] : seg.bboxInSource[3];
			const [dw, dh] = computeContainedSize(contentW, contentH, sw, sh);
			ctx.strokeStyle = "rgba(255, 0, 255, 0.8)";
			ctx.lineWidth = 1;
			ctx.strokeRect(cx - dw / 2, cy - dh / 2, dw, dh);
		}
	}

	// Layer label
	const useOthers = layer >= contentStartLayer;
	ctx.fillStyle = "white";
	ctx.font = "bold 14px monospace";
	ctx.fillText(`Layer ${layer}${useOthers ? " (others)" : " (sakura)"}`, 8, 20);

	// Swap info
	if (layer > 0) {
		const swaps = plan.swapsByLayer[layer];
		ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
		ctx.font = "11px monospace";
		ctx.fillText(`Swaps: ${swaps.length}`, 8, 36);
		for (let i = 0; i < Math.min(swaps.length, 5); i++) {
			const [a, b] = swaps[i];
			ctx.fillText(
				`  slot ${a}(seg${currentMapping[a]}) \u2194 slot ${b}(seg${currentMapping[b]})`,
				8,
				50 + i * 14,
			);
		}
	}
}

// ─── Page Component ──────────────────────────────────────────────────────────

function DebugLayersPage() {
	const containerRef = useRef<HTMLDivElement>(null);
	const [status, setStatus] = useState("Loading...");

	useEffect(() => {
		let disposed = false;

		async function init() {
			const [layoutManifest, contentManifest] = await Promise.all([
				loadManifest(SAKURA_BASE_PATH),
				loadManifest(OTHERS_BASE_PATH),
			]);
			if (!layoutManifest || disposed) return;

			const originalSegments = layoutManifest.segments;
			const mergedSegments = contentManifest
				? mergeSegmentsWithOthersContent(
						layoutManifest.segments,
						contentManifest.segments,
					)
				: layoutManifest.segments;

			// Load atlas images
			const sakuraAtlasFile = layoutManifest.atlas.pages[0]?.file;
			if (!sakuraAtlasFile) {
				setStatus("Error: no sakura atlas file");
				return;
			}
			const sakuraAtlas = await loadImage(
				`${SAKURA_BASE_PATH}/atlas/${sakuraAtlasFile}`,
			);

			let othersAtlas: HTMLImageElement | null = null;
			if (contentManifest) {
				const othersAtlasFile = contentManifest.atlas.pages[0]?.file;
				if (othersAtlasFile) {
					othersAtlas = await loadImage(
						`${OTHERS_BASE_PATH}/atlas/${othersAtlasFile}`,
					);
				}
			}

			// Load kimono background
			let kimonoBg: HTMLImageElement | null = null;
			try {
				kimonoBg = await loadImage(KIMONO_BG_PATH);
			} catch {
				console.warn("Kimono background loading failed");
			}

			if (disposed) return;

			// Compile plan
			const config = DEFAULT_CONFIG;
			const DEBUG_SEED = 42;
			const plan = compilePlan(mergedSegments, config, DEBUG_SEED);

			setStatus(
				`${originalSegments.length} segments, ${config.maxGenerations + 1} layers (0-${config.maxGenerations}), contentStartLayer=${config.contentStartLayer}`,
			);

			// Render canvases in 2-column × 5-row grid
			const container = containerRef.current;
			if (!container) return;
			container.innerHTML = "";

			for (let layer = 0; layer <= config.maxGenerations; layer++) {
				const wrapper = document.createElement("div");
				wrapper.style.margin = "4px";

				const canvas = document.createElement("canvas");
				canvas.width = CANVAS_SIZE;
				canvas.height = CANVAS_SIZE;
				canvas.style.display = "block";
				canvas.style.width = "100%";
				canvas.style.height = "auto";
				canvas.style.border =
					layer >= config.contentStartLayer
						? "2px solid #f06"
						: "2px solid #333";

				const ctx = canvas.getContext("2d");
				if (ctx) {
					drawLayer(
						ctx,
						layer,
						plan,
						layoutManifest.segments,
						mergedSegments,
						originalSegments,
						sakuraAtlas,
						othersAtlas,
						kimonoBg,
						config.contentStartLayer,
					);
				}

				wrapper.appendChild(canvas);
				container.appendChild(wrapper);
			}
		}

		init();
		return () => {
			disposed = true;
		};
	}, []);

	return (
		<div
			style={{
				width: "100vw",
				height: "100vh",
				overflow: "auto",
				background: "#111",
				padding: "8px",
				fontFamily: "monospace",
			}}
		>
			<div style={{ color: "white", marginBottom: "8px", fontSize: "13px" }}>
				<strong>Debug: Layer Segments</strong> | {status}
				<br />
				<span style={{ color: "#888", fontSize: "11px" }}>
					Yellow = slot boundary | Cyan = swapped at this layer | Magenta =
					contained size | Red = black fill (vacated) | Pink border = others
					atlas layer
				</span>
			</div>
			<div
				ref={containerRef}
				style={{
					display: "grid",
					gridTemplateColumns: `repeat(${COLUMNS}, 1fr)`,
					gap: "4px",
				}}
			/>
		</div>
	);
}
