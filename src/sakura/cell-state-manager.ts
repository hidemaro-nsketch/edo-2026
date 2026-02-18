import { DataTexture, FloatType, RGBAFormat, NearestFilter } from "three";

const NUM_SEEDS = 150;
const NUM_LAYERS = 5;
const TRANSITION_DURATION = 0.4; // seconds for segment A→B blend

export type CellState = {
	currSeg: number;
	nextSeg: number;
	t: number;
	flags: number;
};

export type CellXform = {
	rotation: number;
	scale: number;
	offsetX: number;
	offsetY: number;
};

/**
 * Manages per-cell segment assignments and transitions.
 * Updates GPU data textures each frame.
 */
export class CellStateManager {
	readonly states: CellState[][];
	readonly xforms: CellXform[][];
	/** RGBA32F, NUM_SEEDS x NUM_LAYERS — [currSeg, nextSeg, t, flags] */
	readonly cellStateTex: DataTexture;
	/** RGBA32F, NUM_SEEDS x NUM_LAYERS — [rot, scale, offX, offY] */
	readonly cellXformTex: DataTexture;

	private stateData: Float32Array;
	private xformData: Float32Array;
	private availableSegments: number[] = [];

	constructor(segmentIds: number[]) {
		this.availableSegments = [...segmentIds];

		this.states = Array.from({ length: NUM_LAYERS }, () =>
			Array.from({ length: NUM_SEEDS }, () => ({
				currSeg: 0,
				nextSeg: 0,
				t: 1.0,
				flags: 0,
			})),
		);

		this.xforms = Array.from({ length: NUM_LAYERS }, () =>
			Array.from({ length: NUM_SEEDS }, () => ({
				rotation: 0,
				scale: 1.0,
				offsetX: 0,
				offsetY: 0,
			})),
		);

		this.stateData = new Float32Array(NUM_SEEDS * NUM_LAYERS * 4);
		this.xformData = new Float32Array(NUM_SEEDS * NUM_LAYERS * 4);

		this.cellStateTex = createDataTexture(
			this.stateData,
			NUM_SEEDS,
			NUM_LAYERS,
		);
		this.cellXformTex = createDataTexture(
			this.xformData,
			NUM_SEEDS,
			NUM_LAYERS,
		);

		this.assignInitialSegments();
	}

	private assignInitialSegments(): void {
		const count = this.availableSegments.length;
		if (count === 0) return;

		for (let layer = 0; layer < NUM_LAYERS; layer++) {
			for (let seed = 0; seed < NUM_SEEDS; seed++) {
				const idx = (layer * NUM_SEEDS + seed) % count;
				const segId = this.availableSegments[idx];
				const state = this.states[layer][seed];
				state.currSeg = segId;
				state.nextSeg = segId;
				state.t = 1.0;

				const xform = this.xforms[layer][seed];
				xform.rotation = pseudoRandom(seed * 7.3 + layer * 13.1) * Math.PI * 2;
				xform.scale = 0.8 + pseudoRandom(seed * 3.7 + layer * 9.3) * 0.4;
				xform.offsetX = (pseudoRandom(seed * 5.1 + layer * 11.7) - 0.5) * 0.1;
				xform.offsetY = (pseudoRandom(seed * 8.9 + layer * 2.3) - 0.5) * 0.1;
			}
		}
	}

	/**
	 * Trigger a transition for a specific cell: current → random next segment.
	 */
	triggerTransition(layer: number, seed: number): void {
		if (this.availableSegments.length === 0) return;

		const state = this.states[layer][seed];
		if (state.t < 1.0) return; // already transitioning

		const nextIdx = Math.floor(
			pseudoRandom(seed * 17.3 + layer * 7.1 + performance.now() * 0.001) *
				this.availableSegments.length,
		);
		state.nextSeg = this.availableSegments[nextIdx];
		state.t = 0.0;
	}

	/**
	 * Called each frame. Advances transitions and uploads to GPU.
	 */
	update(deltaTime: number): void {
		for (let layer = 0; layer < NUM_LAYERS; layer++) {
			for (let seed = 0; seed < NUM_SEEDS; seed++) {
				const state = this.states[layer][seed];

				// Advance transition
				if (state.t < 1.0) {
					state.t = Math.min(1.0, state.t + deltaTime / TRANSITION_DURATION);
					if (state.t >= 1.0) {
						state.currSeg = state.nextSeg;
						state.t = 1.0;
					}
				}

				// Write to data array
				const offset = (layer * NUM_SEEDS + seed) * 4;
				this.stateData[offset] = state.currSeg;
				this.stateData[offset + 1] = state.nextSeg;
				this.stateData[offset + 2] = state.t;
				this.stateData[offset + 3] = state.flags;

				const xform = this.xforms[layer][seed];
				this.xformData[offset] = xform.rotation;
				this.xformData[offset + 1] = xform.scale;
				this.xformData[offset + 2] = xform.offsetX;
				this.xformData[offset + 3] = xform.offsetY;
			}
		}

		this.cellStateTex.needsUpdate = true;
		this.cellXformTex.needsUpdate = true;
	}

	dispose(): void {
		this.cellStateTex.dispose();
		this.cellXformTex.dispose();
	}
}

function createDataTexture(
	data: Float32Array,
	width: number,
	height: number,
): DataTexture {
	const tex = new DataTexture(data, width, height, RGBAFormat, FloatType);
	tex.minFilter = NearestFilter;
	tex.magFilter = NearestFilter;
	tex.needsUpdate = true;
	return tex;
}

function pseudoRandom(seed: number): number {
	let x = Math.sin(seed) * 43758.5453;
	x = x - Math.floor(x);
	return x;
}
