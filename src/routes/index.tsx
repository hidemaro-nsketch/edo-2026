/**
 * index.tsx — メインページ（"/" ルート）
 *
 * 着物の柄をセグメント分割し、レイヤーごとにシャッフル・再構築する
 * Three.js アニメーションを表示するエントリポイント。
 *
 * 処理フロー:
 *   1. segments.manifest.json からセグメント定義をロード
 *   2. アトラステクスチャ（スプライトシート）と着物背景画像をロード
 *   3. BuildSystem がシャッフル計画に従ってフレームごとにアニメーション状態を更新
 *   4. SegmentMeshes / ConnectionLines / KimonoBackground で描画
 *   5. アニメーション完了後 idle → 自動リスタート
 *
 * Leva GUI でアニメーションパラメータ（速度・レイヤー数・コラプス等）を
 * リアルタイムに調整できる。
 */

import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { createFileRoute } from "@tanstack/react-router";
import { button, useControls } from "leva"; // Leva: ブラウザ上のデバッグ GUI ライブラリ
import { useEffect, useMemo, useRef, useState } from "react";
import { SRGBColorSpace, type Texture, TextureLoader } from "three";
import { BuildSystem } from "../layered-shuffle/build-system"; // シャッフルアニメーションの状態管理エンジン
import { compilePlan } from "../layered-shuffle/compiled-plan"; // セグメント＋設定 → 実行プランへ変換
import { DEFAULT_CONFIG, type ShuffleConfig } from "../layered-shuffle/types";
import { CameraRig, Y_CENTER_OFFSET } from "../render/CameraRig"; // レイヤー追従カメラ
import { ConnectionLines } from "../render/ConnectionLines"; // セグメント間の接続線描画
import { SegmentMeshes } from "../render/SegmentMeshes"; // 各セグメントの矩形メッシュ描画
import { KIMONO_SIZE } from "../sakura/constants";
import { loadAtlasTextures } from "../sakura/segment-manager"; // アトラス画像の読み込み・テクスチャ化
import type { SegmentInfo, SegmentManifest } from "../sakura/types";

/** TanStack Router: "/" パスにこのページを登録 */
export const Route = createFileRoute("/")({ component: App });

// ─── Constants ──────────────────────────────────────────────────────────────

/** public/ 配下の静的アセットのベースパス */
const SAKURA_BASE_PATH = "/sakura";

// ─── Manifest loader ────────────────────────────────────────────────────────

/**
 * セグメントマニフェスト（segments.manifest.json）を非同期で取得する。
 * マニフェストには各セグメントの位置・サイズ・アトラス内座標などが定義されている。
 * ロード失敗時は null を返し、画面は何も表示しない（静かに失敗）。
 */
async function loadManifest(): Promise<SegmentManifest | null> {
	try {
		const res = await fetch(`${SAKURA_BASE_PATH}/segments.manifest.json`);
		if (!res.ok) return null;
		return (await res.json()) as SegmentManifest;
	} catch {
		return null;
	}
}

// ─── Debug GUI ──────────────────────────────────────────────────────────────

/** デバッグコントロール: 一時停止・ステップ実行・速度倍率 */
export type DebugControls = {
	/** true の間 BuildSystem.update() をスキップ */
	pausedRef: React.RefObject<boolean>;
	/** true になったら 1 フレーム分だけ進めて自動で false に戻す */
	stepRef: React.MutableRefObject<boolean>;
	/** アニメーション速度倍率（0.1〜3.0） */
	speedRef: React.RefObject<number>;
	/** BuildSystem.getDebugLabel() の結果を書き込む先（GUI 表示用） */
	debugLabelRef: React.MutableRefObject<string>;
	/** Leva Phase Monitor の set 関数（useFrame 内からリアルタイム更新） */
	setMonitorRef: React.RefObject<(values: Record<string, unknown>) => void>;
};

/** useDebugGui の戻り値型。ShuffleConfig + 背景透明度 + リセットトリガー + デバッグコントロール */
type DebugGuiResult = ShuffleConfig & {
	bgOpacity: number;
	resetTrigger: number;
	debugControls: DebugControls;
};

/**
 * Leva を使ったデバッグ GUI フック。
 * ブラウザ右上にパネルが表示され、以下のパラメータをスライダーで調整可能:
 *
 * - Opacity: 着物背景の透明度
 * - Animation: スワイプ（セグメント移動）の速度・ジッター・ホールド時間
 * - Layers: 最大レイヤー数、レイヤー間の Z 軸間隔
 * - Collapse: コラプス（最終合体）アニメーションの速度・スタガー
 * - Actions: Reset ボタンでアニメーションを最初からやり直し
 */
function useDebugGui(): DebugGuiResult {
	const resetTriggerRef = useRef(0);
	const [resetTrigger, setResetTrigger] = useState(0);

	// ── デバッグコントロール用 ref ──
	const pausedRef = useRef(false);
	const stepRef = useRef(false);
	const speedRef = useRef(1.0);
	const debugLabelRef = useRef("-- | -- | --");

	// 着物背景画像の透明度（0=完全透明、1=完全不透明）
	const opacity = useControls("Opacity", {
		bgOpacity: { value: 1.0, min: 0, max: 1, step: 0.01 },
	});

	// セグメントが次の位置へ移動する際のアニメーション設定
	const animation = useControls("Animation", {
		swipeDuration: { value: 2.2, min: 0.1, max: 8, step: 0.1 }, // 移動にかかる秒数
		swipeDurationJitter: { value: 0.25, min: 0, max: 0.8, step: 0.01 }, // ランダムなばらつき
		holdDuration: { value: 1.4, min: 0, max: 10, step: 0.1 }, // 到着後に静止する秒数
	});

	// レイヤー構成の設定
	const layers = useControls("Layers", {
		maxGenerations: { value: 2, min: 1, max: 20, step: 1 }, // シャッフルの世代数（レイヤー数）
		layerSpacing: { value: 1.5, min: 0.1, max: 4, step: 0.1 }, // レイヤー間の Z 軸距離
	});

	// コラプスフェーズ（全レイヤーが最終位置に収束）の設定
	const collapse = useControls("Collapse", {
		collapseDuration: { value: 0.1, min: 0.05, max: 3, step: 0.05 }, // 各セグメントの収束アニメ秒数
		collapseStagger: { value: 0.08, min: 0, max: 2, step: 0.01 }, // セグメント間の開始時間差
		holdAfterComplete: { value: 1.0, min: 0, max: 5, step: 0.1 }, // 完了後の静止秒数
	});

	// ── Playback: 速度倍率スライダー ──
	// onChange で ref に直接書き込み（React re-render を避ける）
	useControls("Playback", {
		speed: {
			value: 1.0,
			min: 0.1,
			max: 3.0,
			step: 0.1,
			onChange: (v: number) => {
				speedRef.current = v;
			},
		},
	});

	useControls("Actions", {
		Reset: button(() => {
			resetTriggerRef.current += 1;
			setResetTrigger(resetTriggerRef.current);
		}),
		"Pause / Resume": button(() => {
			pausedRef.current = !pausedRef.current;
		}),
		"Step (1 frame)": button(() => {
			if (pausedRef.current) {
				stepRef.current = true;
			}
		}),
	});

	// ── Phase Monitor: フェーズ情報をリアルタイム表示 ──
	// set 関数で useFrame から値を更新する
	const [, setMonitor] = useControls("Phase Monitor", () => ({
		status: {
			value: "-- | -- | --",
			editable: false,
		},
		paused: {
			value: false,
			editable: false,
		},
	}));

	// setMonitor を ref 経由で SegmentMeshes に渡す
	const setMonitorRef = useRef(setMonitor);
	setMonitorRef.current = setMonitor;

	const debugControls: DebugControls = useMemo(
		() => ({ pausedRef, stepRef, speedRef, debugLabelRef, setMonitorRef }),
		[],
	);

	return {
		...opacity,
		...animation,
		...layers,
		...collapse,
		resetTrigger,
		debugControls,
	};
}

// ─── KimonoBackground ───────────────────────────────────────────────────────

/**
 * 着物の全体画像を背景として表示する平面メッシュ。
 * セグメントアニメーションの後ろに配置され（z=-0.1, renderOrder=-100）、
 * depthTest/depthWrite を無効にして常に最背面に描画される。
 */
function KimonoBackground({
	texture,
	opacity,
}: {
	texture: Texture | null;
	opacity: number;
}) {
	if (!texture) return null;

	return (
		<mesh position={[0, 0, -0.1]} renderOrder={-100}>
			<planeGeometry args={[KIMONO_SIZE, KIMONO_SIZE]} />
			<meshBasicMaterial
				map={texture}
				transparent
				opacity={opacity}
				depthTest={false}
				depthWrite={false}
			/>
		</mesh>
	);
}

// ─── ShuffleContent ─────────────────────────────────────────────────────────

type ShuffleContentProps = {
	segments: SegmentInfo[];
	atlasTexture: Texture;
	config: ShuffleConfig;
	resetTrigger: number;
	debugControls: DebugControls;
};

/**
 * シャッフルアニメーションの本体。
 *
 * BuildSystem（アニメーション状態管理エンジン）を保持し、
 * 子コンポーネントに共有する:
 *   - CameraAndLifecycle: カメラ追従 + idle 時の自動リスタート
 *   - SegmentMeshes: 各セグメントをアトラステクスチャで描画
 *   - ConnectionLines: セグメント間の接続線（デバッグ/演出用）
 *
 * resetTrigger が変化すると新しい BuildSystem を生成してアニメーションをリセットする。
 */
function ShuffleContent({
	segments,
	atlasTexture,
	config,
	resetTrigger,
	debugControls,
}: ShuffleContentProps) {
	const systemRef = useRef<BuildSystem | null>(null);
	const lastResetRef = useRef(0);

	// 初回: セグメント＋設定からプランをコンパイルし、BuildSystem を生成
	if (!systemRef.current) {
		const plan = compilePlan(segments, config);
		systemRef.current = new BuildSystem(plan, config);
	}

	// GUI の Reset ボタン押下時: resetTrigger の変化を検知して再生成
	if (resetTrigger !== lastResetRef.current) {
		lastResetRef.current = resetTrigger;
		const plan = compilePlan(segments, config);
		systemRef.current = new BuildSystem(plan, config);
	}

	const system = systemRef.current;

	return (
		<>
			<CameraAndLifecycle
				buildSystem={system}
				segments={segments}
				config={config}
			/>
			<SegmentMeshes
				segments={segments}
				atlasTexture={atlasTexture}
				buildSystem={system}
				debugControls={debugControls}
			/>
			<ConnectionLines buildSystem={system} />
		</>
	);
}

/**
 * カメラ追従 + アニメーションのライフサイクル管理。
 *
 * 毎フレーム（useFrame）で以下を実行:
 *   1. BuildSystem が idle フェーズになったら新しいプランで自動リスタート
 *   2. 現在のレイヤー番号を ref で CameraRig に渡し、カメラが追従
 *
 * ref を使うことで React の再レンダーを回避し、60fps でスムーズに更新する。
 */
function CameraAndLifecycle({
	buildSystem,
	segments,
	config,
}: {
	buildSystem: BuildSystem;
	segments: SegmentInfo[];
	config: ShuffleConfig;
}) {
	const currentLayerRef = useRef(1);

	useFrame(() => {
		// アニメーション完了 → idle に遷移したら、新しいシャッフルプランで再開
		if (buildSystem.state.phase === "idle") {
			const plan = compilePlan(segments, config);
			buildSystem.reset(plan);
			currentLayerRef.current = 1;
		}

		// 現在レイヤーを ref 経由で CameraRig に伝達（setState を避けてパフォーマンス維持）
		currentLayerRef.current = buildSystem.state.currentLayer;
	});

	return (
		<CameraRig
			currentGen={1}
			currentGenRef={currentLayerRef}
			maxGenerations={config.maxGenerations}
			layerSpacing={config.layerSpacing}
		/>
	);
}

// ─── Scene ──────────────────────────────────────────────────────────────────

/**
 * シーン全体の初期化と描画構成を管理するコンポーネント。
 *
 * マウント時に以下を非同期ロード:
 *   1. セグメントマニフェスト（segments.manifest.json）
 *   2. アトラステクスチャ（セグメント画像をまとめたスプライトシート）
 *   3. 着物背景画像（kimono_bg_inv.jpg）
 *
 * ロード完了後に ShuffleContent + KimonoBackground を描画する。
 * アンマウント時はすべてのテクスチャを dispose してメモリを解放する。
 */
function Scene() {
	const [segments, setSegments] = useState<SegmentInfo[]>([]);
	const [atlasTexture, setAtlasTexture] = useState<Texture | null>(null);
	const [kimonoTexture, setKimonoTexture] = useState<Texture | null>(null);
	const gui = useDebugGui();

	useEffect(() => {
		let disposed = false; // コンポーネントがアンマウントされたか追跡
		const textures: Texture[] = []; // クリーンアップ対象のテクスチャを蓄積

		async function init() {
			// ① マニフェスト読み込み
			const manifest = await loadManifest();
			if (!manifest || disposed) return;

			setSegments(manifest.segments);

			// ② アトラステクスチャ読み込み（セグメント画像のスプライトシート）
			try {
				const loaded = await loadAtlasTextures(
					manifest,
					`${SAKURA_BASE_PATH}/atlas`,
				);
				if (disposed) return;
				textures.push(...loaded);
				if (loaded.length > 0) {
					setAtlasTexture(loaded[0]); // 最初のアトラスページを使用
				}
			} catch (err) {
				console.warn("Atlas loading failed:", err);
			}

			// ③ 着物全体の背景画像を読み込み（反転版）
			try {
				const loader = new TextureLoader();
				const bgTex = await loader.loadAsync(
					`${SAKURA_BASE_PATH}/kimono_bg_inv.jpg`,
				);
				if (disposed) return;
				bgTex.colorSpace = SRGBColorSpace; // sRGB 色空間を明示（色味の正確性のため）
				textures.push(bgTex);
				setKimonoTexture(bgTex);
			} catch (err) {
				console.warn("Kimono background loading failed:", err);
			}

			if (!disposed) {
				console.log(
					`Loaded: ${manifest.segments.length} segments, kimono background`,
				);
			}
		}

		init();

		// クリーンアップ: GPU メモリからテクスチャを解放
		return () => {
			disposed = true;
			for (const tex of textures) {
				tex.dispose();
			}
		};
	}, []);

	// GUI の値を ShuffleConfig 型に変換（未設定時はデフォルト値にフォールバック）
	const config: ShuffleConfig = useMemo(
		() => ({
			maxGenerations: gui.maxGenerations ?? DEFAULT_CONFIG.maxGenerations,
			swipeDuration: gui.swipeDuration ?? DEFAULT_CONFIG.swipeDuration,
			swipeDurationJitter:
				gui.swipeDurationJitter ?? DEFAULT_CONFIG.swipeDurationJitter,
			holdDuration: gui.holdDuration ?? DEFAULT_CONFIG.holdDuration,
			layerSpacing: gui.layerSpacing ?? DEFAULT_CONFIG.layerSpacing,
			collapseDuration: gui.collapseDuration ?? DEFAULT_CONFIG.collapseDuration,
			collapseStagger: gui.collapseStagger ?? DEFAULT_CONFIG.collapseStagger,
			holdAfterComplete:
				gui.holdAfterComplete ?? DEFAULT_CONFIG.holdAfterComplete,
			categoryStartLayer: DEFAULT_CONFIG.categoryStartLayer,
		}),
		[
			gui.maxGenerations,
			gui.swipeDuration,
			gui.swipeDurationJitter,
			gui.holdDuration,
			gui.layerSpacing,
			gui.collapseDuration,
			gui.collapseStagger,
			gui.holdAfterComplete,
		],
	);

	// セグメントがまだロードされていなければ何も描画しない
	if (segments.length === 0) return null;

	return (
		<>
			{/* <KimonoBackground texture={kimonoTexture} opacity={gui.bgOpacity} /> */}
			{atlasTexture && (
				<ShuffleContent
					segments={segments}
					atlasTexture={atlasTexture}
					config={config}
					resetTrigger={gui.resetTrigger}
					debugControls={gui.debugControls}
				/>
			)}
		</>
	);
}

// ─── App ────────────────────────────────────────────────────────────────────

/**
 * ルートコンポーネント。画面全体に Three.js Canvas を配置する。
 *
 * - orthographic カメラ: 遠近感なしの正射影（2D 的な見た目）
 * - zoom=250: 着物のサイズ（約 2〜3 単位）を画面に収まるスケールに拡大
 * - Y_CENTER_OFFSET: 着物の中心が画面中央に来るよう Y 方向にオフセット
 * - OrbitControls: マウスでカメラ回転・ズーム可能（デバッグ用）
 * - 背景色は黒
 */
function App() {
	return (
		<div className="h-100vh min-h-[520px]">
			<Canvas
				orthographic
				camera={{
					position: [0, Y_CENTER_OFFSET, 50],
					zoom: 250,
					near: 0.1,
					far: 200,
				}}
			>
				<color attach="background" args={["black"]} />
				<OrbitControls />
				<Scene />
			</Canvas>
		</div>
	);
}
