/**
 * SakuraFixedScene.tsx — 桜テーマ固定ループシーン
 *
 * 桜テーマのみを永続的にループ表示する Three.js シーンコンポーネント。
 * アニメーション完了時にテーマ切り替えなしで自動リスタートする。
 *
 * 使用方法: R3F <Canvas> 内に配置する。
 */

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Texture } from "three";
import { BuildSystem } from "../layered-shuffle/build-system";
import { compilePlan } from "../layered-shuffle/compiled-plan";
import {
	DEFAULT_CONFIG,
	type ShuffleConfig,
	THEME_CATEGORY_NAMES,
} from "../layered-shuffle/types";
import { getThemeCategoryName, KimonoBackground } from "../routes/index";
import type { SegmentInfo } from "../sakura/types";
import { THEME_SEQUENCE } from "../themes/theme-config";
import { loadThemeAssets, type ThemeAssets } from "../themes/theme-loader";
import { CameraRig } from "./CameraRig";
import { ConnectionLines } from "./ConnectionLines";
import { SegmentMeshes } from "./SegmentMeshes";
import type { SwipeEffectParams } from "./SegmentMeshRenderer";

const DEFAULT_SWIPE_EFFECT: SwipeEffectParams = {
	noiseFreq: 15.0,
	noiseAmp: 0.08,
	noiseSpeed: 8.0,
	dimFactor: 0.6,
};

const PLAN_SEED = 42;

/**
 * 桜テーマのみを永続ループ表示するシーン。
 * R3F <Canvas> 内に配置して使用する。
 */
export function SakuraFixedScene() {
	const [assets, setAssets] = useState<ThemeAssets | null>(null);

	useEffect(() => {
		const controller = new AbortController();
		const sakuraTheme = THEME_SEQUENCE.find((t) => t.id === "sakura");
		if (!sakuraTheme) return;

		loadThemeAssets(sakuraTheme, controller.signal).then((a) => {
			if (!controller.signal.aborted && a) {
				setAssets(a);
			}
		});

		return () => {
			controller.abort();
		};
	}, []);

	if (!assets) return null;

	return (
		<SakuraShuffleContent
			segments={assets.segments}
			originalSegments={assets.originalSegments}
			atlasTexture={assets.atlasTexture}
			othersAtlasTexture={assets.othersAtlasTexture}
			kimonoTexture={assets.kimonoTexture}
		/>
	);
}

function SakuraShuffleContent({
	segments,
	originalSegments,
	atlasTexture,
	othersAtlasTexture,
	kimonoTexture,
}: {
	segments: SegmentInfo[];
	originalSegments: SegmentInfo[];
	atlasTexture: Texture;
	othersAtlasTexture: Texture | null;
	kimonoTexture: Texture | null;
}) {
	const config: ShuffleConfig = useMemo(() => {
		const categoryName =
			THEME_CATEGORY_NAMES["sakura" as keyof typeof THEME_CATEGORY_NAMES];
		const categoryBaseLayers = DEFAULT_CONFIG.categoryBaseLayers;
		const categoryOthersLayers = DEFAULT_CONFIG.categoryOthersLayers;
		const categoryMaxLayer = Object.fromEntries(
			Object.keys({ ...categoryBaseLayers, ...categoryOthersLayers }).map(
				(key) => [
					key,
					(categoryBaseLayers[key] ?? 0) +
						(categoryOthersLayers[key] ?? 0),
				],
			),
		);
		const categoryContentStartLayer = Object.fromEntries(
			Object.keys({ ...categoryBaseLayers, ...categoryOthersLayers }).map(
				(key) => [
					key,
					(categoryOthersLayers[key] ?? 0) > 0
						? (categoryBaseLayers[key] ?? 0) + 1
						: (categoryBaseLayers[key] ?? 0) +
							(categoryOthersLayers[key] ?? 0) +
							1,
				],
			),
		);
		const contentStartLayer = categoryName
			? (categoryContentStartLayer[categoryName] ??
				DEFAULT_CONFIG.contentStartLayer)
			: DEFAULT_CONFIG.contentStartLayer;

		return {
			...DEFAULT_CONFIG,
			maxGenerations: Math.max(...Object.values(categoryMaxLayer), 1),
			contentStartLayer,
			categoryMaxLayer,
			categoryContentStartLayer,
		};
	}, []);

	const nextPlanSeedRef = useRef(PLAN_SEED);

	const createNextPlan = () => {
		const plan = compilePlan(segments, config, nextPlanSeedRef.current);
		nextPlanSeedRef.current += 1;
		const themeCategoryName = getThemeCategoryName("sakura");
		const themeMaxLayer = themeCategoryName
			? config.categoryMaxLayer[themeCategoryName]
			: undefined;
		if (themeMaxLayer != null) {
			plan.maxLayer = themeMaxLayer;
		}
		return plan;
	};

	const systemRef = useRef<BuildSystem | null>(null);
	if (!systemRef.current) {
		const plan = createNextPlan();
		systemRef.current = new BuildSystem(
			plan,
			config,
			originalSegments,
			segments,
		);
	}

	const system = systemRef.current;
	const currentLayerRef = useRef(1);
	const bgDimRef = useRef(1.0);
	const cycleCompleteCalledRef = useRef(false);
	const prevPhaseRef = useRef<string>("");

	useFrame((_, delta) => {
		const phase = system.state.phase;
		const isTerminalPhase = phase === "complete" || phase === "idle";

		if (
			(prevPhaseRef.current === "idle" ||
				prevPhaseRef.current === "complete") &&
			!isTerminalPhase
		) {
			cycleCompleteCalledRef.current = false;
		}
		prevPhaseRef.current = phase;

		if (isTerminalPhase && !cycleCompleteCalledRef.current) {
			cycleCompleteCalledRef.current = true;
			const plan = createNextPlan();
			system.reset(plan);
			currentLayerRef.current = 1;
			return;
		}

		// Background dim
		const stayDim =
			phase === "swipe" ||
			phase === "dimming" ||
			(phase === "hold" && system.state.phaseTime < config.dimHoldTime);
		const dimTarget = stayDim ? DEFAULT_SWIPE_EFFECT.dimFactor : 1.0;
		const isDimming = dimTarget < bgDimRef.current;
		const dimDuration = isDimming
			? config.dimFadeInDuration
			: config.dimFadeOutDuration;
		const dimSpeed = 4.6 / Math.max(0.01, dimDuration);
		bgDimRef.current +=
			(dimTarget - bgDimRef.current) * Math.min(1, delta * dimSpeed);

		const effectiveMaxLayer = system.plan.maxLayer;
		currentLayerRef.current = Math.min(
			system.state.currentLayer,
			effectiveMaxLayer - 1,
		);
	});

	return (
		<>
			<KimonoBackground
				texture={kimonoTexture}
				opacity={1.0}
				bgDimRef={bgDimRef}
			/>
			<CameraRig
				currentGen={1}
				currentGenRef={currentLayerRef}
				maxGenerations={system.plan.maxLayer}
				layerSpacing={config.layerSpacing}
			/>
			<SegmentMeshes
				segments={segments}
				originalSegments={originalSegments}
				atlasTexture={atlasTexture}
				othersAtlasTexture={othersAtlasTexture}
				buildSystem={system}
				swipeEffect={DEFAULT_SWIPE_EFFECT}
			/>
			<ConnectionLines buildSystem={system} />
		</>
	);
}
