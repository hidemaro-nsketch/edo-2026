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
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { createFileRoute } from "@tanstack/react-router";
import { button, Leva, useControls } from "leva"; // Leva: ブラウザ上のデバッグ GUI ライブラリ
import { useEffect, useMemo, useRef, useState } from "react";
import type * as THREE from "three";
import { SRGBColorSpace, type Texture, TextureLoader } from "three";
import { BuildSystem } from "../layered-shuffle/build-system"; // シャッフルアニメーションの状態管理エンジン
import { compilePlan } from "../layered-shuffle/compiled-plan"; // セグメント＋設定 → 実行プランへ変換
import { DEFAULT_CONFIG, type ShuffleConfig } from "../layered-shuffle/types";
import { CameraRig, Y_CENTER_OFFSET } from "../render/CameraRig"; // レイヤー追従カメラ
import { ConnectionLines } from "../render/ConnectionLines"; // セグメント間の接続線描画
import { SegmentMeshes, type SwipeEffectParams } from "../render/SegmentMeshes"; // 各セグメントの矩形メッシュ描画
import { TransitionRenderer } from "../render/TransitionRenderer"; // テーマ転換描画
import { KIMONO_SIZE } from "../sakura/constants";
import { loadAtlasTextures } from "../sakura/segment-manager"; // アトラス画像の読み込み・テクスチャ化
import type { SegmentInfo, SegmentManifest } from "../sakura/types";
import { ThemeTransitionSystem } from "../theme-transition/transition-system";
import type {
	TransitionConfig,
	TransitionPhase,
} from "../theme-transition/types";
import { DEFAULT_TRANSITION_CONFIG } from "../theme-transition/types";
import {
	getAvailableThemes,
	getNextThemeIndex,
	type ThemeConfig,
} from "../themes/theme-config";

/** TanStack Router: "/" パスにこのページを登録 */
export const Route = createFileRoute("/")({ component: App });

// ─── Constants ──────────────────────────────────────────────────────────────

/** Available themes for sequential rotation */
const AVAILABLE_THEMES = getAvailableThemes();
const INITIAL_PLAN_SEED = 42;

// ─── Scene Status (shared via ref between R3F and HTML) ────────────────────

/** Mutable status object written per-frame inside R3F, read by HTML panel */
type SceneStatus = {
	themeId: string;
	themeName: string;
	themeIndex: number;
	themeCount: number;
	phase: string;
	currentLayer: number;
	maxLayers: number;
	phaseTime: number;
	segmentCount: number;
	loading: boolean;
	/** Swap pairs for the current layer: [slotA, slotB][] */
	activeSwaps: [number, number][];
	/** Slot→segment mapping at current layer */
	slotMapping: number[];
	/** Whether current layer uses "others" atlas */
	usingOthers: boolean;
	/** Set of segment indices that were replaced with others content (via merge) */
	othersSegIndices: Set<number>;
	/** Current theme transition phase (null = no transition) */
	transitionPhase: TransitionPhase | null;
	/** GPU texture memory count (from renderer.info.memory.textures) */
	textureCount: number;
};

// ─── Manifest loader ────────────────────────────────────────────────────────

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

/**
 * 元のセグメント配列のレイアウト（bboxInSource, originalSize）を維持しつつ、
 * 描画内容（uvRect, trimmedSize, pixelRect）を "others" マニフェストのセグメントに差し替える。
 * others のセグメント数が足りない場合はサイクリックに再利用する。
 */
/** サイズ比がこの閾値を超えるペアはスワップしない（面積比） */
const SWAP_SIZE_RATIO_MAX = 4.0;

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

// ─── Theme Asset Loading ───────────────────────────────────────────────────

/** Result of loading all assets for a single theme */
type ThemeAssets = {
	theme: ThemeConfig;
	segments: SegmentInfo[];
	originalSegments: SegmentInfo[];
	atlasTexture: Texture;
	othersAtlasTexture: Texture | null;
	kimonoTexture: Texture | null;
	/** All textures to dispose on cleanup */
	allTextures: Texture[];
};

/**
 * Load all assets for a given theme configuration.
 * Returns null if the layout manifest or atlas fails to load.
 */
async function loadThemeAssets(
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

	const originalSegments = layoutManifest.segments;

	// Merge content if available
	let segments: SegmentInfo[];
	if (contentManifest) {
		segments = mergeSegmentsWithOthersContent(
			layoutManifest.segments,
			contentManifest.segments,
		);
	} else {
		segments = layoutManifest.segments;
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
	swipeEffect: SwipeEffectParams;
	transitionConfig: Partial<TransitionConfig>;
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
		flashCount: { value: DEFAULT_CONFIG.flashCount, min: 0, max: 6, step: 1 },
		flashOnDuration: {
			value: DEFAULT_CONFIG.flashOnDuration,
			min: 0.01,
			max: 0.5,
			step: 0.01,
		},
		flashOffDuration: {
			value: DEFAULT_CONFIG.flashOffDuration,
			min: 0.0,
			max: 0.5,
			step: 0.01,
		},
		swipeDuration: {
			value: DEFAULT_CONFIG.swipeDuration,
			min: 0.1,
			max: 8,
			step: 0.1,
		}, // 移動にかかる秒数
		swipeDurationJitter: {
			value: DEFAULT_CONFIG.swipeDurationJitter,
			min: 0,
			max: 0.8,
			step: 0.01,
		}, // ランダムなばらつき
		holdDuration: {
			value: DEFAULT_CONFIG.holdDuration,
			min: 0,
			max: 10,
			step: 0.1,
		}, // 到着後に静止する秒数
	});

	// レイヤー構成の設定
	const layers = useControls("Layers", {
		maxGenerations: {
			value: DEFAULT_CONFIG.maxGenerations,
			min: 1,
			max: 20,
			step: 1,
		}, // シャッフルの世代数（レイヤー数）
		layerSpacing: {
			value: DEFAULT_CONFIG.layerSpacing,
			min: 0.1,
			max: 4,
			step: 0.1,
		}, // レイヤー間の Z 軸距離
		contentStartLayer: {
			value: DEFAULT_CONFIG.contentStartLayer,
			min: 1,
			max: 20,
			step: 1,
		}, // othersアトラスを使い始めるレイヤー
	});

	// コラプスフェーズ（全レイヤーが最終位置に収束）の設定
	const collapse = useControls("Collapse", {
		collapseDuration: {
			value: DEFAULT_CONFIG.collapseDuration,
			min: 0.05,
			max: 3,
			step: 0.05,
		}, // 各セグメントの収束アニメ秒数
		collapseStagger: {
			value: DEFAULT_CONFIG.collapseStagger,
			min: 0,
			max: 2,
			step: 0.01,
		}, // セグメント間の開始時間差
		holdAfterComplete: {
			value: DEFAULT_CONFIG.holdAfterComplete,
			min: 0,
			max: 5,
			step: 0.1,
		}, // 完了後の静止秒数
	});

	// スワイプエフェクト設定（ノイズ境界線 + 非アクティブスロットの暗さ）
	const swipeEffectGui = useControls("Swipe Effect", {
		noiseFreq: { value: 15.0, min: 1, max: 50, step: 0.5 },
		noiseAmp: { value: 0.08, min: 0, max: 0.3, step: 0.005 },
		noiseSpeed: { value: 8.0, min: 0, max: 20, step: 0.5 },
		dimFactor: { value: 0.3, min: 0, max: 1, step: 0.05 },
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

	// テーマ転換アニメーション設定
	const transitionGui = useControls("Theme Transition", {
		scatterDuration: {
			value: DEFAULT_TRANSITION_CONFIG.scatterDuration,
			min: 0.3,
			max: 5,
			step: 0.1,
		},
		blackoutDuration: {
			value: DEFAULT_TRANSITION_CONFIG.blackoutDuration,
			min: 0.1,
			max: 3,
			step: 0.1,
		},
		gatherDuration: {
			value: DEFAULT_TRANSITION_CONFIG.gatherDuration,
			min: 0.3,
			max: 5,
			step: 0.1,
		},
	});

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
		dimFadeInDuration: DEFAULT_CONFIG.dimFadeInDuration,
		dimFadeOutDuration: DEFAULT_CONFIG.dimFadeOutDuration,
		dimHoldTime: DEFAULT_CONFIG.dimHoldTime,
		dimLeadTime: DEFAULT_CONFIG.dimLeadTime,
		categoryStartLayer: DEFAULT_CONFIG.categoryStartLayer,
		sourceImageStartLayer: DEFAULT_CONFIG.sourceImageStartLayer,
		contentStartLayer: layers.contentStartLayer,
		resetTrigger,
		debugControls,
		swipeEffect: swipeEffectGui,
		transitionConfig: transitionGui,
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
	bgDimRef,
}: {
	texture: Texture | null;
	opacity: number;
	bgDimRef: React.RefObject<number>;
}) {
	const matRef = useRef<THREE.MeshBasicMaterial>(null);

	useFrame(() => {
		if (matRef.current) {
			matRef.current.opacity = opacity * bgDimRef.current;
		}
	});

	if (!texture) return null;

	return (
		<mesh position={[0, 0, -0.1]} renderOrder={-100}>
			<planeGeometry args={[KIMONO_SIZE, KIMONO_SIZE]} />
			<meshBasicMaterial
				ref={matRef}
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
	originalSegments: SegmentInfo[];
	atlasTexture: Texture;
	othersAtlasTexture: Texture | null;
	config: ShuffleConfig;
	resetTrigger: number;
	debugControls: DebugControls;
	swipeEffect: SwipeEffectParams;
	bgDimRef: React.MutableRefObject<number>;
	/** Called when the animation cycle completes (idle), to trigger theme switch */
	onCycleComplete?: (buildSystem: BuildSystem) => void;
	/** Shared mutable status for the HTML status panel */
	statusRef?: React.MutableRefObject<SceneStatus>;
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
	originalSegments,
	atlasTexture,
	othersAtlasTexture,
	config,
	resetTrigger,
	debugControls,
	swipeEffect,
	bgDimRef,
	onCycleComplete,
	statusRef,
}: ShuffleContentProps) {
	const systemRef = useRef<BuildSystem | null>(null);
	const lastResetRef = useRef(0);
	const nextPlanSeedRef = useRef(INITIAL_PLAN_SEED);

	const createNextPlan = () => {
		const plan = compilePlan(segments, config, nextPlanSeedRef.current);
		nextPlanSeedRef.current += 1;
		return plan;
	};

	// 初回: セグメント＋設定からプランをコンパイルし、BuildSystem を生成
	if (!systemRef.current) {
		const plan = createNextPlan();
		systemRef.current = new BuildSystem(
			plan,
			config,
			originalSegments,
			segments,
		);
	}

	// GUI の Reset ボタン押下時: resetTrigger の変化を検知して再生成
	if (resetTrigger !== lastResetRef.current) {
		lastResetRef.current = resetTrigger;
		const plan = createNextPlan();
		systemRef.current = new BuildSystem(
			plan,
			config,
			originalSegments,
			segments,
		);
	}

	const system = systemRef.current;

	// Pre-compute which segment indices were replaced with "others" content.
	// Compare merged segments vs originalSegments by uvRect reference.
	const othersIndices = useMemo(() => {
		const set = new Set<number>();
		for (let i = 0; i < segments.length; i++) {
			if (segments[i].uvRect !== originalSegments[i]?.uvRect) {
				set.add(i);
			}
		}
		return set;
	}, [segments, originalSegments]);

	// Sync othersSegIndices once
	if (statusRef) {
		statusRef.current.othersSegIndices = othersIndices;
	}

	// Update background dim ref + scene status per-frame
	useFrame((_, delta) => {
		const phase = system.state.phase;
		const stayDim =
			phase === "swipe" ||
			phase === "dimming" ||
			(phase === "hold" && system.state.phaseTime < config.dimHoldTime);
		const dimTarget = stayDim ? swipeEffect.dimFactor : 1.0;
		const isDimming = dimTarget < bgDimRef.current;
		const dimDuration = isDimming
			? config.dimFadeInDuration
			: config.dimFadeOutDuration;
		const dimSpeed = 4.6 / Math.max(0.01, dimDuration);
		bgDimRef.current +=
			(dimTarget - bgDimRef.current) * Math.min(1, delta * dimSpeed);

		// Write status for HTML panel (no React re-render)
		if (statusRef) {
			const s = statusRef.current;
			const { phase, currentLayer } = system.state;
			s.phase = phase;
			s.currentLayer = currentLayer;
			s.phaseTime = system.state.phaseTime;

			s.usingOthers = currentLayer >= config.contentStartLayer;

			const plan = system.plan;
			if (currentLayer >= 1 && currentLayer < plan.legsByLayer.length) {
				s.activeSwaps = plan.swapsByLayer[currentLayer] ?? [];
				s.slotMapping = plan.mappingByLayer[currentLayer] ?? [];
			} else {
				s.activeSwaps = [];
				s.slotMapping = [];
			}
		}
	});

	return (
		<>
			<CameraAndLifecycle
				buildSystem={system}
				config={config}
				createNextPlan={createNextPlan}
				onCycleComplete={onCycleComplete}
			/>
			<SegmentMeshes
				segments={segments}
				originalSegments={originalSegments}
				atlasTexture={atlasTexture}
				othersAtlasTexture={othersAtlasTexture}
				contentStartLayer={config.contentStartLayer}
				buildSystem={system}
				debugControls={debugControls}
				swipeEffect={swipeEffect}
			/>
			<ConnectionLines buildSystem={system} />
		</>
	);
}

/**
 * カメラ追従 + アニメーションのライフサイクル管理。
 *
 * 毎フレーム（useFrame）で以下を実行:
 *   1. BuildSystem が idle フェーズになったら onCycleComplete でテーマ切り替えを通知
 *      （onCycleComplete がない場合は同テーマ内で新プランで再開）
 *   2. 現在のレイヤー番号を ref で CameraRig に渡し、カメラが追従
 *
 * ref を使うことで React の再レンダーを回避し、60fps でスムーズに更新する。
 */
function CameraAndLifecycle({
	buildSystem,
	config,
	createNextPlan,
	onCycleComplete,
}: {
	buildSystem: BuildSystem;
	config: ShuffleConfig;
	createNextPlan: () => ReturnType<typeof compilePlan>;
	onCycleComplete?: (buildSystem: BuildSystem) => void;
}) {
	const currentLayerRef = useRef(1);
	const cycleCompleteCalledRef = useRef(false);
	const prevPhaseRef = useRef<string>("");

	useFrame(() => {
		const phase = buildSystem.state.phase;
		const isTerminalPhase = phase === "complete" || phase === "idle";

		// Reset guard only when leaving a terminal phase.
		if (
			(prevPhaseRef.current === "idle" ||
				prevPhaseRef.current === "complete") &&
			!isTerminalPhase
		) {
			cycleCompleteCalledRef.current = false;
		}
		prevPhaseRef.current = phase;

		// アニメーション完了 → complete / idle に遷移したらテーマ切り替え or 同テーマ再開
		if (isTerminalPhase) {
			if (onCycleComplete && !cycleCompleteCalledRef.current) {
				// Notify parent to switch theme (will unmount this component via key change)
				cycleCompleteCalledRef.current = true;
				onCycleComplete(buildSystem);
			} else if (!onCycleComplete) {
				// No theme switching — restart with new plan in same theme
				const plan = createNextPlan();
				buildSystem.reset(plan);
				currentLayerRef.current = 1;
			}
			return;
		}

		// 現在レイヤーを ref 経由で CameraRig に伝達（setState を避けてパフォーマンス維持）
		// Collapse disabled: カメラは常に top-down を維持（oblique 遷移しない）
		currentLayerRef.current = Math.min(
			buildSystem.state.currentLayer,
			config.maxGenerations - 1,
		);
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
 * テーマ転換システム:
 *   - key={} によるアンマウント方式を廃止
 *   - scatter-out → blackout → gather-in のアニメーション転換
 *   - currentAssets / nextAssets / transitionPhase による状態管理
 *   - 転換中は ShuffleContent をフリーズし TransitionRenderer を表示
 *   - 転換完了後 currentAssets = nextAssets で切り替え
 */
function Scene({
	statusRef,
}: {
	statusRef: React.MutableRefObject<SceneStatus>;
}) {
	const [currentAssets, setCurrentAssets] = useState<ThemeAssets | null>(null);
	const [transitionPhase, setTransitionPhase] =
		useState<TransitionPhase | null>(null);

	const themeIndexRef = useRef(0);
	const currentAssetsRef = useRef<ThemeAssets | null>(null);
	const nextAssetsRef = useRef<ThemeAssets | null>(null);
	const transitionSystemRef = useRef<ThemeTransitionSystem | null>(null);
	const transitionAbortRef = useRef<AbortController | null>(null);
	const shuffleFrozenRef = useRef(false);
	const transitionCountRef = useRef(0);
	const { gl } = useThree();
	const gui = useDebugGui();

	// Keep ref in sync with state
	currentAssetsRef.current = currentAssets;

	// Initial theme load
	useEffect(() => {
		const controller = new AbortController();

		async function init() {
			const theme = AVAILABLE_THEMES[0];
			if (!theme) return;
			const assets = await loadThemeAssets(theme, controller.signal);
			if (!controller.signal.aborted && assets) {
				console.log(
					`Theme [${theme.id}] loaded: ${assets.segments.length} segments`,
				);
				statusRef.current.themeId = theme.id;
				statusRef.current.themeName = theme.displayName;
				statusRef.current.themeIndex = 0;
				statusRef.current.themeCount = AVAILABLE_THEMES.length;
				statusRef.current.segmentCount = assets.segments.length;
				statusRef.current.loading = false;
				setCurrentAssets(assets);
			}
		}

		init();
		return () => {
			controller.abort();
		};
	}, [statusRef]);

	// Cleanup textures on unmount
	useEffect(() => {
		return () => {
			transitionAbortRef.current?.abort();
			if (currentAssetsRef.current) {
				for (const tex of currentAssetsRef.current.allTextures) {
					tex.dispose();
				}
			}
		};
	}, []);

	// Monitor texture memory in StatusPanel
	useFrame(() => {
		statusRef.current.textureCount = gl.info.memory.textures;
		statusRef.current.transitionPhase = transitionPhase;

		// Drive transition system each frame
		if (transitionSystemRef.current && transitionPhase) {
			// delta is handled by useFrame's second arg, but we need manual delta here
			// since this is a separate useFrame from ShuffleContent
		}
	});

	/**
	 * Called by ShuffleContent when animation cycle completes (idle).
	 * Starts the scatter-out transition and begins loading next theme's assets.
	 */
	const onCycleComplete = useRef(async (buildSystem: BuildSystem) => {
		const curAssets = currentAssetsRef.current;
		if (!curAssets) return;

		// Abort any in-flight transition load
		transitionAbortRef.current?.abort();
		const controller = new AbortController();
		transitionAbortRef.current = controller;

		const nextIndex = getNextThemeIndex(
			themeIndexRef.current,
			AVAILABLE_THEMES,
		);
		const nextTheme = AVAILABLE_THEMES[nextIndex];
		if (!nextTheme) return;

		console.log(
			`Theme transition: ${AVAILABLE_THEMES[themeIndexRef.current]?.id} → ${nextTheme.id}`,
		);

		// Freeze shuffle content and start scatter-out
		shuffleFrozenRef.current = true;

		// Use a unique seed per transition so Voronoi pattern differs each time
		transitionCountRef.current += 1;
		const oldThemeId = AVAILABLE_THEMES[themeIndexRef.current]?.id ?? "sakura";
		const transitionConfig: Partial<TransitionConfig> = {
			scatterDuration:
				gui.transitionConfig?.scatterDuration ??
				DEFAULT_TRANSITION_CONFIG.scatterDuration,
			blackoutDuration:
				gui.transitionConfig?.blackoutDuration ??
				DEFAULT_TRANSITION_CONFIG.blackoutDuration,
			gatherDuration:
				gui.transitionConfig?.gatherDuration ??
				DEFAULT_TRANSITION_CONFIG.gatherDuration,
			noiseSeed: Date.now() + transitionCountRef.current,
			oldThemeId,
			newThemeId: nextTheme.id,
		};
		const finalDisplayInstances = buildSystem.getFinalDisplayInstances();

		const system = new ThemeTransitionSystem(
			curAssets.originalSegments,
			transitionConfig,
			finalDisplayInstances,
		);

		// Set up dispose callback: dispose old textures after blackout + 1 frame
		system.onDispose(() => {
			const prev = currentAssetsRef.current;
			if (prev) {
				console.log(`Disposing old theme textures: ${prev.theme.id}`);
				for (const tex of prev.allTextures) {
					tex.dispose();
				}
			}
		});

		transitionSystemRef.current = system;
		setTransitionPhase("scatter-out");

		// Load next theme assets in parallel
		statusRef.current.loading = true;
		const assets = await loadThemeAssets(nextTheme, controller.signal);

		if (controller.signal.aborted) return;

		if (assets) {
			// Provide new assets to transition system
			system.setNewAssets(assets.originalSegments);
			nextAssetsRef.current = assets;
			themeIndexRef.current = nextIndex;

			console.log(
				`Theme [${nextTheme.id}] loaded: ${assets.segments.length} segments`,
			);
		} else {
			// Load failed: transition system will fall back to old theme
			console.warn(`Theme [${nextTheme.id}] load failed, reverting`);
			system.setLoadFailed();
		}

		statusRef.current.loading = false;
	}).current;

	// GUI の値を ShuffleConfig 型に変換
	const config: ShuffleConfig = useMemo(
		() => ({
			maxGenerations: gui.maxGenerations ?? DEFAULT_CONFIG.maxGenerations,
			flashCount: gui.flashCount ?? DEFAULT_CONFIG.flashCount,
			flashOnDuration: gui.flashOnDuration ?? DEFAULT_CONFIG.flashOnDuration,
			flashOffDuration: gui.flashOffDuration ?? DEFAULT_CONFIG.flashOffDuration,
			swipeDuration: gui.swipeDuration ?? DEFAULT_CONFIG.swipeDuration,
			swipeDurationJitter:
				gui.swipeDurationJitter ?? DEFAULT_CONFIG.swipeDurationJitter,
			holdDuration: gui.holdDuration ?? DEFAULT_CONFIG.holdDuration,
			layerSpacing: gui.layerSpacing ?? DEFAULT_CONFIG.layerSpacing,
			collapseDuration: gui.collapseDuration ?? DEFAULT_CONFIG.collapseDuration,
			collapseStagger: gui.collapseStagger ?? DEFAULT_CONFIG.collapseStagger,
			holdAfterComplete:
				gui.holdAfterComplete ?? DEFAULT_CONFIG.holdAfterComplete,
			dimFadeInDuration: DEFAULT_CONFIG.dimFadeInDuration,
			dimFadeOutDuration: DEFAULT_CONFIG.dimFadeOutDuration,
			dimHoldTime: DEFAULT_CONFIG.dimHoldTime,
			dimLeadTime: DEFAULT_CONFIG.dimLeadTime,
			categoryStartLayer: DEFAULT_CONFIG.categoryStartLayer,
			sourceImageStartLayer: DEFAULT_CONFIG.sourceImageStartLayer,
			contentStartLayer:
				gui.contentStartLayer ?? DEFAULT_CONFIG.contentStartLayer,
		}),
		[
			gui.maxGenerations,
			gui.flashCount,
			gui.flashOnDuration,
			gui.flashOffDuration,
			gui.swipeDuration,
			gui.swipeDurationJitter,
			gui.holdDuration,
			gui.layerSpacing,
			gui.collapseDuration,
			gui.collapseStagger,
			gui.holdAfterComplete,
			gui.contentStartLayer,
		],
	);

	// Keep maxLayers in sync with GUI
	statusRef.current.maxLayers = config.maxGenerations;

	// Background dim factor: updated per-frame by ShuffleContent
	const bgDimRef = useRef(1.0);

	// テーマアセットがまだロードされていなければ何も描画しない
	if (!currentAssets) return null;

	return (
		<>
			{/* Background: hidden during transitions (TransitionRenderer handles it) */}
			{!transitionPhase && (
				<KimonoBackground
					texture={currentAssets.kimonoTexture}
					opacity={gui.bgOpacity}
					bgDimRef={bgDimRef}
				/>
			)}

			{/* Normal shuffle content — frozen during transitions */}
			{!transitionPhase && (
				<ShuffleContent
					key={currentAssets.theme.id}
					segments={currentAssets.segments}
					originalSegments={currentAssets.originalSegments}
					atlasTexture={currentAssets.atlasTexture}
					othersAtlasTexture={currentAssets.othersAtlasTexture}
					config={config}
					resetTrigger={gui.resetTrigger}
					debugControls={gui.debugControls}
					swipeEffect={gui.swipeEffect}
					bgDimRef={bgDimRef}
					onCycleComplete={onCycleComplete}
					statusRef={statusRef}
				/>
			)}

			{/* Transition renderer — active during theme transitions */}
			{transitionPhase && transitionSystemRef.current && (
				<TransitionOverlay
					transitionSystem={transitionSystemRef.current}
					currentAssets={currentAssets}
					nextAssetsRef={nextAssetsRef}
					swipeEffect={gui.swipeEffect}
					bgOpacity={gui.bgOpacity}
					onTransitionComplete={() => {
						const next = nextAssetsRef.current;
						if (next) {
							// Swap to new theme
							statusRef.current.themeId = next.theme.id;
							statusRef.current.themeName = next.theme.displayName;
							statusRef.current.themeIndex = themeIndexRef.current;
							statusRef.current.segmentCount = next.segments.length;
							setCurrentAssets(next);
						}
						// Clear transition state and dispose fragment geometries
						transitionSystemRef.current?.disposeFragments();
						nextAssetsRef.current = null;
						transitionSystemRef.current = null;
						shuffleFrozenRef.current = false;
						setTransitionPhase(null);
					}}
				/>
			)}
		</>
	);
}

/**
 * TransitionOverlay — Drives the ThemeTransitionSystem and renders the transition.
 *
 * Updates the system each frame and detects phase transitions.
 * When transition completes, calls onTransitionComplete to swap themes.
 */
function TransitionOverlay({
	transitionSystem,
	currentAssets,
	nextAssetsRef,
	swipeEffect,
	bgOpacity,
	onTransitionComplete,
}: {
	transitionSystem: ThemeTransitionSystem;
	currentAssets: ThemeAssets;
	nextAssetsRef: React.RefObject<ThemeAssets | null>;
	swipeEffect: SwipeEffectParams;
	bgOpacity: number;
	onTransitionComplete: () => void;
}) {
	const completedRef = useRef(false);
	const [newBgTexture, setNewBgTexture] = useState<Texture | null>(null);

	useFrame((_, delta) => {
		transitionSystem.update(delta);

		// Lazily pick up new background texture once assets load
		if (!newBgTexture && nextAssetsRef.current?.kimonoTexture) {
			setNewBgTexture(nextAssetsRef.current.kimonoTexture);
		}

		const phase = transitionSystem.getPhase();
		if (phase === "complete" && !completedRef.current) {
			completedRef.current = true;
			onTransitionComplete();
		}
	});

	const nextAssets = nextAssetsRef.current;

	return (
		<TransitionRenderer
			transitionSystem={transitionSystem}
			oldAtlasTexture={currentAssets.atlasTexture}
			oldOthersAtlasTexture={currentAssets.othersAtlasTexture ?? undefined}
			newAtlasTexture={nextAssets?.atlasTexture}
			newOthersAtlasTexture={nextAssets?.othersAtlasTexture ?? undefined}
			oldOriginalSegments={currentAssets.originalSegments}
			oldMergedSegments={currentAssets.segments}
			newOriginalSegments={nextAssets?.originalSegments ?? []}
			newMergedSegments={nextAssets?.segments ?? []}
			swipeEffect={swipeEffect}
			oldBgTexture={currentAssets.kimonoTexture}
			newBgTexture={newBgTexture}
			bgOpacity={bgOpacity}
		/>
	);
}

// ─── Status Panel (HTML outside Canvas) ─────────────────────────────────────

const INITIAL_STATUS: SceneStatus = {
	themeId: "",
	themeName: "",
	themeIndex: 0,
	themeCount: AVAILABLE_THEMES.length,
	phase: "loading",
	currentLayer: 0,
	maxLayers: DEFAULT_CONFIG.maxGenerations,
	phaseTime: 0,
	segmentCount: 0,
	loading: true,
	activeSwaps: [],
	slotMapping: [],
	usingOthers: false,
	othersSegIndices: new Set(),
	transitionPhase: null,
	textureCount: 0,
};

const PHASE_LABELS: Record<string, string> = {
	flash: "Flash",
	swipe: "Swipe",
	hold: "Hold",
	preCollapse: "Pre-Collapse",
	collapsing: "Collapsing",
	holding: "Holding",
	idle: "Idle",
	loading: "Loading...",
};

/**
 * HTML status panel that reads from a mutable ref via rAF (no React re-renders).
 * Displays current theme, phase, layer progress, and segment count.
 */
function StatusPanel({
	statusRef,
}: {
	statusRef: React.RefObject<SceneStatus>;
}) {
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		let rafId: number;

		function tick() {
			const el = containerRef.current;
			if (!el) {
				rafId = requestAnimationFrame(tick);
				return;
			}
			const s = statusRef.current;
			const themeLabel = s.themeName ? `${s.themeName} (${s.themeId})` : "---";
			const seqLabel =
				s.themeCount > 0 ? `${s.themeIndex + 1} / ${s.themeCount}` : "---";
			const phaseLabel = s.loading
				? "Loading..."
				: (PHASE_LABELS[s.phase] ?? s.phase);
			const layerLabel = s.loading
				? "---"
				: `${s.currentLayer} / ${s.maxLayers}`;
			const timeLabel = s.loading ? "---" : s.phaseTime.toFixed(2);

			// Atlas source label
			const atlasLabel = s.usingOthers ? "others" : "base";

			// Active swaps: show slot pairs
			const swapsLabel =
				s.activeSwaps.length > 0
					? s.activeSwaps.map(([a, b]) => `[${a}↔${b}]`).join(" ")
					: "---";

			// Slot mapping: only show entries where slot !== segId.
			// Color-code by atlas: others segments in orange, base in blue.
			const changedSlots = s.slotMapping
				.map((segId, slot) => {
					if (slot === segId) return null;
					const isOthers = s.usingOthers && s.othersSegIndices.has(segId);
					const color = isOthers ? "#e8a" : "#8ae";
					return `<span style="color:${color}">${slot}→${segId}${isOthers ? "*" : ""}</span>`;
				})
				.filter(Boolean);
			const mappingLabel =
				changedSlots.length > 0 ? changedSlots.join("&nbsp; ") : "---";

			// Transition phase label
			const transLabel = s.transitionPhase
				? `<span style="color:#f80">${s.transitionPhase}</span>`
				: `<span style="color:#888">---</span>`;

			el.innerHTML =
				`<div style="margin-bottom:12px;font-size:14px;color:#888;letter-spacing:0.05em">SCENE STATUS</div>` +
				`<div style="margin-bottom:6px"><span style="color:#888">Theme:</span> <span style="color:#fff">${themeLabel}</span></div>` +
				`<div style="margin-bottom:6px"><span style="color:#888">Sequence:</span> <span style="color:#fff">${seqLabel}</span></div>` +
				`<div style="margin-bottom:6px"><span style="color:#888">Phase:</span> <span style="color:#fff">${phaseLabel}</span></div>` +
				`<div style="margin-bottom:6px"><span style="color:#888">Layer:</span> <span style="color:#fff">${layerLabel}</span></div>` +
				`<div style="margin-bottom:6px"><span style="color:#888">Phase Time:</span> <span style="color:#fff">${timeLabel}s</span></div>` +
				`<div style="margin-bottom:6px"><span style="color:#888">Transition:</span> ${transLabel}</div>` +
				`<div style="margin-bottom:6px"><span style="color:#888">Textures:</span> <span style="color:#fff">${s.textureCount}</span></div>` +
				`<div style="margin-bottom:10px"><span style="color:#888">Segments:</span> <span style="color:#fff">${s.segmentCount}</span></div>` +
				`<div style="margin-bottom:12px;font-size:14px;color:#888;letter-spacing:0.05em">ACTIVE LAYER</div>` +
				`<div style="margin-bottom:6px"><span style="color:#888">Atlas:</span> <span style="color:${s.usingOthers ? "#e8a" : "#8ae"}">${atlasLabel}</span></div>` +
				`<div style="margin-bottom:6px"><span style="color:#888">Swaps (slot):</span> <span style="color:#e8a">${swapsLabel}</span></div>` +
				`<div style="margin-bottom:6px;word-break:break-all"><span style="color:#888">Slot→Seg:</span> <span style="font-size:11px">${mappingLabel}</span></div>`;

			rafId = requestAnimationFrame(tick);
		}

		rafId = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(rafId);
	}, [statusRef]);

	return (
		<div
			ref={containerRef}
			style={{
				position: "absolute",
				top: 16,
				left: 528,
				padding: "16px",
				fontFamily: "monospace",
				fontSize: "13px",
				color: "#ccc",
				lineHeight: 1.6,
				userSelect: "none",
				pointerEvents: "none",
			}}
		/>
	);
}

// ─── App ────────────────────────────────────────────────────────────────────

function App() {
	const [guiVisible, setGuiVisible] = useState(false);
	const statusRef = useRef<SceneStatus>({ ...INITIAL_STATUS });

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "g" && !e.metaKey && !e.ctrlKey && !e.altKey) {
				setGuiVisible((prev) => !prev);
			}
		};
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
				position: "relative",
			}}
		>
			<Leva hidden={!guiVisible} />
			<div
				style={{
					position: "absolute",
					top: 0,
					left: 0,
					width: 512,
					height: 512,
				}}
			>
				<Canvas
					orthographic
					camera={{
						position: [0, Y_CENTER_OFFSET, 50],
						zoom: 10,
						near: 0.1,
						far: 200,
					}}
				>
					<color attach="background" args={["black"]} />
					<OrbitControls />
					<Scene statusRef={statusRef} />
				</Canvas>
			</div>
			<StatusPanel statusRef={statusRef} />
		</div>
	);
}
