/**
 * display-spec.tsx — ディスプレイ仕様ドキュメントページ（"/display-spec" ルート）
 *
 * 本作品を「2枚のディスプレイ」に出力するための仕組みを、
 * 他チーム（会場設営・コンテンツ制作・運用）が読んで理解できる形でまとめた
 * 静的なドキュメントページ。
 *
 * 構成: macOS の「システム設定 → ディスプレイ」で各ディスプレイを 1920×1080 に
 *       設定する。ディスプレイ1の画面に 512×512、ディスプレイ2の画面に 256×256 の
 *       描画領域を、それぞれ配置する。
 *
 * 関連実装:
 *   - レイアウト（座標・サイズ）:     src/routes/index.tsx の App()
 *   - 表示位置の確認用テストパターン: src/routes/debug.tsx
 *
 * このページ自体は描画エンジンを使わない純粋な HTML/Tailwind ドキュメント。
 */

import { createFileRoute } from "@tanstack/react-router";

// ─── 仕様値（src/routes/index.tsx App() / src/routes/debug.tsx と一致させること） ───

/** 1枚あたりのディスプレイ画面の解像度（macOS のディスプレイ設定で指定する値） */
const SCREEN_W = 1920;
const SCREEN_H = 1080;

/** ディスプレイ画面の中に配置する描画領域 */
type Region = {
	/** 画面内の配置（px） */
	x: number;
	y: number;
	w: number;
	h: number;
};

/** 1台のディスプレイの定義 */
type DisplayDef = {
	key: string;
	/** ディスプレイ名 */
	name: string;
	/** 役割 */
	role: string;
	/** 画面に表示するアクセントカラー（debug.tsx のテスト枠と対応） */
	color: string;
	/** この画面に置く描画領域 */
	region: Region;
};

const DISPLAYS: DisplayDef[] = [
	{
		key: "display1",
		name: "ディスプレイ1",
		role: "メイン",
		color: "#ef4444", // red — debug.tsx の赤枠に対応
		region: { x: 0, y: 0, w: 512, h: 512 },
	},
	{
		key: "display2",
		name: "ディスプレイ2",
		role: "サブ",
		color: "#3b82f6", // blue — debug.tsx の青枠に対応
		region: { x: 0, y: 0, w: 256, h: 256 },
	},
];

// ─── 小さな表示部品 ──────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
	return (
		<h2 className="mt-12 mb-4 text-2xl font-bold text-cyan-300 border-b border-gray-700 pb-2">
			{children}
		</h2>
	);
}

function Code({ children }: { children: React.ReactNode }) {
	return (
		<code className="rounded bg-gray-800 px-1.5 py-0.5 font-mono text-[0.85em] text-cyan-200">
			{children}
		</code>
	);
}

/**
 * 1台のディスプレイ画面（1920×1080）の中に描画領域を縮尺どおりに配置した図。
 * debug.tsx のテストパターンと同じ座標・色。
 */
function DisplayDiagram({ display }: { display: DisplayDef }) {
	const { region: r } = display;
	return (
		<div>
			<p className="mb-2 font-mono text-sm" style={{ color: display.color }}>
				{display.name}
				<span className="ml-2 text-gray-400">/ {display.role}</span>
			</p>
			<div
				className="relative w-full overflow-hidden rounded-lg border border-gray-600 bg-black"
				style={{ aspectRatio: `${SCREEN_W} / ${SCREEN_H}` }}
			>
				{/* 画面全体のラベル */}
				<span className="absolute right-2 top-2 font-mono text-xs text-gray-500">
					{SCREEN_W}×{SCREEN_H}
				</span>

				{/* 描画領域 */}
				<div
					className="absolute flex flex-col items-center justify-center text-center"
					style={{
						left: `${(r.x / SCREEN_W) * 100}%`,
						top: `${(r.y / SCREEN_H) * 100}%`,
						width: `${(r.w / SCREEN_W) * 100}%`,
						height: `${(r.h / SCREEN_H) * 100}%`,
						border: `2px solid ${display.color}`,
						backgroundColor: `${display.color}22`,
					}}
				>
					<span
						className="px-1 font-mono text-[0.7rem] font-bold leading-tight md:text-xs"
						style={{ color: display.color }}
					>
						{r.w}×{r.h}
					</span>
					<span className="px-1 font-mono text-[0.65rem] text-gray-300">
						@ ({r.x},{r.y})
					</span>
				</div>
			</div>
		</div>
	);
}

// ─── ページ本体 ──────────────────────────────────────────────────────────────

function DisplaySpecPage() {
	return (
		// styles.css で body は overflow:hidden のため、ここで独自にスクロール領域を作る
		<div className="h-screen w-screen overflow-y-auto bg-gray-900 text-gray-200">
			<div className="mx-auto max-w-3xl px-6 py-12">
				{/* ── 概要 ── */}
				<div className="rounded-lg border border-cyan-800 bg-cyan-950/40 p-5">
					<p className="font-bold text-cyan-200">要約</p>
					<ol className="mt-2 list-decimal space-y-1 pl-5 text-gray-200">
						<li>
							macOS の「システム設定 → ディスプレイ」で、2枚のディスプレイを
							それぞれ <Code>1920×1080</Code> に設定する。
						</li>
						<li>
							<strong>ディスプレイ1の画面</strong> の中に{" "}
							<strong>512×512</strong>、<strong>ディスプレイ2の画面</strong> の中に{" "}
							<strong>256×256</strong> の描画領域を、それぞれ左上に配置する。
						</li>
					</ol>
				</div>

				{/* ── 前提：ディスプレイ設定 ── */}
				<SectionTitle>前提：ディスプレイの画面サイズ</SectionTitle>
				<p className="text-gray-300">
					ここでいう「画面」とは、<strong>macOS の「システム設定 → ディスプレイ」で
					各ディスプレイに設定する解像度</strong>（<Code>1920×1080</Code>）のことです。
					Mac のディスプレイ設定でいつもやる、あの設定だと思ってください。
				</p>
				<p className="mt-3 text-gray-300">
					今回はディスプレイが2枚あるので、画面も2つ（ディスプレイ1 / ディスプレイ2）。
					それぞれの画面の中に、表示したい絵を「描画領域」として配置します。
					<strong>ディスプレイ1</strong> の画面には <Code>512×512</Code>、
					<strong>ディスプレイ2</strong> の画面には <Code>256×256</Code>{" "}
					の描画領域を、どちらも左上に置いています。
				</p>

				{/* ── レイアウト図 ── */}
				<SectionTitle>レイアウト全体図</SectionTitle>
				<p className="text-gray-300">
					2枚のディスプレイ画面（各 <Code>{`${SCREEN_W}×${SCREEN_H}`}</Code>）と、
					その中の描画領域は以下のとおりです。
				</p>
				<div className="my-6 grid gap-6 md:grid-cols-2">
					{DISPLAYS.map((d) => (
						<DisplayDiagram key={d.key} display={d} />
					))}
				</div>

				{/* ── レイアウト定義表 ── */}
				<SectionTitle>レイアウト定義</SectionTitle>
				<div className="overflow-x-auto">
					<table className="w-full border-collapse text-sm">
						<thead>
							<tr className="border-b border-gray-600 text-left text-cyan-300">
								<th className="py-2 pr-4">ディスプレイ</th>
								<th className="py-2 pr-4">描画領域 位置 (x, y)</th>
								<th className="py-2">描画領域 サイズ (w×h)</th>
							</tr>
						</thead>
						<tbody>
							{DISPLAYS.map((d) => (
								<tr key={d.key} className="border-b border-gray-800 align-top">
									<td className="py-3 pr-4">
										<span
											className="mr-2 inline-block h-3 w-3 rounded-sm align-middle"
											style={{ backgroundColor: d.color }}
										/>
										{d.name}
										<span className="ml-1 text-gray-400">（{d.role}）</span>
									</td>
									<td className="py-3 pr-4 font-mono text-gray-300">
										({d.region.x}, {d.region.y})
									</td>
									<td className="py-3 font-mono text-gray-300">
										{d.region.w}×{d.region.h}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</div>
		</div>
	);
}

export const Route = createFileRoute("/display-spec")({
	component: DisplaySpecPage,
});
