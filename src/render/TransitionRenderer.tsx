/**
 * TransitionRenderer.tsx — Renders theme transition animations
 *
 * Uses SegmentMeshRenderer to draw segments during scatter-out and gather-in.
 *
 * Background is split into Voronoi fragments (random polygonal cells) that
 * each fly off / arrive independently with staggered timing. Each transition
 * generates a unique tessellation so no two transitions look the same.
 *
 * During scatter-out: old theme segments + background fragments fly out
 * During gather-in: new theme segments + background fragments fly in
 * During blackout: renders nothing (screen is black)
 */

import { useFrame } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	type BufferGeometry,
	Mesh,
	MeshBasicMaterial,
	type Texture,
} from "three";
import type { BlackFillRenderInstance, SegmentRenderInstance } from "../layered-shuffle/types";
import type { SegmentInfo } from "../sakura/types";
import type { ThemeTransitionSystem } from "../theme-transition/transition-system";
import type { VoronoiFragment } from "../theme-transition/voronoi-fragments";
import {
	type FrameRenderData,
	SegmentMeshRenderer,
	type SwipeEffectParams,
} from "./SegmentMeshRenderer";

type TransitionRendererProps = {
	transitionSystem: ThemeTransitionSystem;
	oldAtlasTexture: Texture;
	oldOthersAtlasTexture?: Texture;
	newAtlasTexture?: Texture;
	newOthersAtlasTexture?: Texture;
	oldOriginalSegments: SegmentInfo[];
	oldMergedSegments: SegmentInfo[];
	newOriginalSegments: SegmentInfo[];
	newMergedSegments: SegmentInfo[];
	swipeEffect?: SwipeEffectParams;
	oldBgTexture?: Texture | null;
	newBgTexture?: Texture | null;
	bgOpacity?: number;
	frozenBlackFills?: BlackFillRenderInstance[];
};

// ─── Voronoi Background Fragment Meshes ─────────────────────────────────────

type FragmentMeshEntry = {
	mesh: Mesh;
	material: MeshBasicMaterial;
	geometry: BufferGeometry; // owned by VoronoiFragment, not disposed here
};

function createFragmentMeshes(
	fragments: VoronoiFragment[],
	texture: Texture,
): FragmentMeshEntry[] {
	return fragments.map((frag) => {
		const mat = new MeshBasicMaterial({
			map: texture,
			transparent: true,
			depthTest: false,
			depthWrite: false,
		});
		const mesh = new Mesh(frag.geometry, mat);
		mesh.frustumCulled = false;
		mesh.renderOrder = -100; // behind segments
		mesh.position.z = -0.1;
		return { mesh, material: mat, geometry: frag.geometry };
	});
}

function VoronoiBackgroundMeshes({
	transitionSystem,
	oldBgTexture,
	newBgTexture,
	bgOpacity,
}: {
	transitionSystem: ThemeTransitionSystem;
	oldBgTexture: Texture | null;
	newBgTexture: Texture | null;
	bgOpacity: number;
}) {
	const fragments = transitionSystem.getFragments();

	// Create meshes synchronously so they're available on first render
	const oldMeshes = useMemo(() => {
		return oldBgTexture ? createFragmentMeshes(fragments, oldBgTexture) : [];
	}, [oldBgTexture, fragments]);

	const newMeshes = useMemo(() => {
		return newBgTexture ? createFragmentMeshes(fragments, newBgTexture) : [];
	}, [newBgTexture, fragments]);

	// Dispose materials on cleanup
	useEffect(() => {
		return () => {
			for (const e of oldMeshes) e.material.dispose();
			for (const e of newMeshes) e.material.dispose();
		};
	}, [oldMeshes, newMeshes]);

	useFrame(() => {
		const phase = transitionSystem.getPhase();
		const state = transitionSystem.getBackgroundState();
		const renderStates = state.fragmentRenderStates;

		const activeMeshes = phase === "gather-in" ? newMeshes : oldMeshes;
		const inactiveMeshes = phase === "gather-in" ? oldMeshes : newMeshes;

		// Update active fragment meshes
		for (let i = 0; i < activeMeshes.length; i++) {
			const entry = activeMeshes[i];
			const rs = renderStates[i];
			if (!rs) {
				entry.mesh.visible = false;
				continue;
			}

			entry.mesh.visible = rs.opacity > 0.001;
			entry.mesh.position.x = rs.translateOffset[0];
			entry.mesh.position.y = rs.translateOffset[1];
			entry.material.opacity = rs.opacity * bgOpacity;
		}

		// Hide inactive set
		for (const entry of inactiveMeshes) {
			entry.mesh.visible = false;
		}
	});

	return (
		<>
			{oldMeshes.map((entry, i) => (
				<primitive key={`old-frag-${i}`} object={entry.mesh} />
			))}
			{newMeshes.map((entry, i) => (
				<primitive key={`new-frag-${i}`} object={entry.mesh} />
			))}
		</>
	);
}

// ─── Main TransitionRenderer ────────────────────────────────────────────────

export function TransitionRenderer({
	transitionSystem,
	oldAtlasTexture,
	oldOthersAtlasTexture,
	newAtlasTexture,
	newOthersAtlasTexture,
	oldOriginalSegments,
	oldMergedSegments,
	newOriginalSegments,
	newMergedSegments,
	swipeEffect,
	oldBgTexture,
	newBgTexture,
	bgOpacity = 1,
	frozenBlackFills,
}: TransitionRendererProps) {
	const [phase, setPhase] = useState(transitionSystem.getPhase());

	const atlasTexture =
		phase === "gather-in" && newAtlasTexture
			? newAtlasTexture
			: oldAtlasTexture;

	const othersAtlasTexture =
		phase === "gather-in" && newOthersAtlasTexture
			? newOthersAtlasTexture
			: oldOthersAtlasTexture;

	const bfCount = frozenBlackFills?.length ?? 0;
	const maxSegments = Math.max(
		oldOriginalSegments.length,
		newOriginalSegments.length,
		// Ensure base mesh buffer can hold all frozen black fills
		Math.ceil(bfCount / 2),
		1,
	);

	const emptyBlackFills = useMemo(() => new Map<number, BlackFillRenderInstance[]>(), []);
	const frozenBlackFillMap = useMemo(() => {
		if (!frozenBlackFills || frozenBlackFills.length === 0) return emptyBlackFills;
		const map = new Map<number, BlackFillRenderInstance[]>();
		map.set(0, frozenBlackFills);
		return map;
	}, [frozenBlackFills, emptyBlackFills]);
	const emptySettled = useMemo(
		() => new Map<number, SegmentRenderInstance[]>(),
		[],
	);
	const emptyBlackFillArray = useMemo(() => [] as never[], []);

	const renderDataRef = useRef<FrameRenderData>({
		activeInstances: [],
		activeSegments: oldOriginalSegments,
		baseInstances: [],
		baseSegments: oldOriginalSegments,
		settledByLayer: emptySettled,
		activeBlackFills: emptyBlackFillArray,
		committedBlackFills: emptyBlackFills,
		currentLayer: 0,
		getSegmentsForLayer: () => oldMergedSegments,
		dimFactor: 1.0,
	});

	useFrame(() => {
		const currentPhase = transitionSystem.getPhase();
		setPhase((prev) => (prev !== currentPhase ? currentPhase : prev));
	});

	const getRenderData = useCallback((): FrameRenderData => {
		const instances = transitionSystem.getInstances();
		const phase = transitionSystem.getPhase();
		const usingNewTheme = phase === "gather-in" || phase === "complete";
		const baseSegments = usingNewTheme
			? newOriginalSegments.length > 0
				? newOriginalSegments
				: oldOriginalSegments
			: oldOriginalSegments;
		const othersSegments = usingNewTheme
			? newMergedSegments.length > 0
				? newMergedSegments
				: baseSegments
			: oldMergedSegments.length > 0
				? oldMergedSegments
				: oldOriginalSegments;
		const data = renderDataRef.current;

		data.activeInstances = instances;
		data.activeSegments = baseSegments;
		data.baseInstances = [];
		data.baseSegments = baseSegments;
		data.settledByLayer = emptySettled;
		data.activeBlackFills = emptyBlackFillArray;
		data.committedBlackFills =
			phase === "scatter-out" ? frozenBlackFillMap : emptyBlackFills;
		data.currentLayer = 0;
		data.getSegmentsForLayer = () => othersSegments;
		data.dimFactor = 1.0;

		return data;
	}, [
		transitionSystem,
		emptySettled,
		emptyBlackFillArray,
		emptyBlackFills,
		frozenBlackFillMap,
		oldOriginalSegments,
		oldMergedSegments,
		newOriginalSegments,
		newMergedSegments,
	]);

	const showSegments =
		transitionSystem.getPhase() !== "blackout" &&
		transitionSystem.getPhase() !== "complete";

	return (
		<>
			<VoronoiBackgroundMeshes
				transitionSystem={transitionSystem}
				oldBgTexture={oldBgTexture ?? null}
				newBgTexture={newBgTexture ?? null}
				bgOpacity={bgOpacity}
			/>

			{showSegments && (
				<SegmentMeshRenderer
					maxSegments={maxSegments}
					layerCount={0}
					atlasTexture={atlasTexture}
					othersAtlasTexture={othersAtlasTexture}
					getRenderData={getRenderData}
					swipeEffect={swipeEffect}
				/>
			)}
		</>
	);
}
