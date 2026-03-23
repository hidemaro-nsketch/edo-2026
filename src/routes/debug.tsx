/**
 * debug.tsx — ディスプレイテスト用デバッグページ（"/debug" ルート）
 *
 * 1920x1080 の Canvas 上に任意サイズのテストパターンを配置して
 * 特殊ディスプレイでの表示確認を行う。
 */

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

export const Route = createFileRoute("/debug")({ component: DebugPage });

/** Canvas の論理サイズ（PC認識上の解像度） */
const CANVAS_W = 1920;
const CANVAS_H = 1080;

/** テストパターンのサイズと位置 */
const PATTERN_X = 0;
const PATTERN_Y = 0;
const PATTERN_SIZE = 512;

function drawTestPattern(ctx: CanvasRenderingContext2D) {
	// 背景を黒で塗りつぶし
	ctx.fillStyle = "black";
	ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

	const x = PATTERN_X;
	const y = PATTERN_Y;
	const s = PATTERN_SIZE;

	// 赤い枠線
	ctx.strokeStyle = "red";
	ctx.lineWidth = 2;
	ctx.strokeRect(x + 1, y + 1, s - 2, s - 2);

	// 斜め線（バツ印）
	ctx.beginPath();
	ctx.moveTo(x, y);
	ctx.lineTo(x + s, y + s);
	ctx.moveTo(x + s, y);
	ctx.lineTo(x, y + s);
	ctx.stroke();

	// 青い枠（赤の下、右寄せで 256x256）
	const bx = x + s - 256;
	const by = y + s;
	const bs = 256;

	ctx.strokeStyle = "blue";
	ctx.lineWidth = 2;
	ctx.strokeRect(bx + 1, by + 1, bs - 2, bs - 2);

	// 斜め線（バツ印）
	ctx.beginPath();
	ctx.moveTo(bx, by);
	ctx.lineTo(bx + bs, by + bs);
	ctx.moveTo(bx + bs, by);
	ctx.lineTo(bx, by + bs);
	ctx.stroke();
}

function DebugPage() {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		drawTestPattern(ctx);

		function handleKeyDown(e: KeyboardEvent) {
			if (e.key !== "d") return;

			const img = new Image();
			img.onload = () => {
				ctx.drawImage(img, PATTERN_X, PATTERN_Y, PATTERN_SIZE, PATTERN_SIZE);
			};
			img.src = "/sakura/kimono_bg_inv.jpg";
		}

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, []);

	return (
		<div
			style={{
				width: "100vw",
				height: "100vh",
				overflow: "hidden",
				background: "black",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
			}}
		>
			<canvas
				ref={canvasRef}
				width={CANVAS_W}
				height={CANVAS_H}
				style={{ display: "block" }}
			/>
		</div>
	);
}
