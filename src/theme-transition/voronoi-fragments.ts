/**
 * voronoi-fragments.ts — Voronoi-based background fragmentation
 *
 * Generates random Voronoi cells within the KIMONO_SIZE square and
 * creates Three.js BufferGeometry for each cell with correct UV mapping
 * to the background texture.
 *
 * Each transition produces a different tessellation via the seed parameter.
 */

import { Delaunay } from "d3-delaunay";
import { BufferAttribute, BufferGeometry } from "three";
import { KIMONO_SIZE } from "../sakura/constants";

/** Describes a single Voronoi fragment for animation */
export type VoronoiFragment = {
	/** Fragment index */
	index: number;
	/** Centroid in world coordinates [x, y] */
	centroid: [number, number];
	/** Polygon vertices in world coordinates (closed: last = first) */
	polygon: Array<[number, number]>;
	/** Three.js geometry with UV-mapped triangles */
	geometry: BufferGeometry;
};

// ─── Seeded RNG (same Mulberry32 as transition-system) ──────────────────────

function seededRandom(seed: number): () => number {
	let s = seed | 0;
	return () => {
		s = (s + 0x6d2b79f5) | 0;
		let t = Math.imul(s ^ (s >>> 15), 1 | s);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// ─── Generate Voronoi fragments ─────────────────────────────────────────────

/**
 * Generate Voronoi fragments that tile the KIMONO_SIZE square.
 *
 * @param count Number of seed points (= number of fragments)
 * @param seed  Random seed for reproducible but unique tessellation
 * @returns Array of VoronoiFragment with geometry and centroid
 */
export function generateVoronoiFragments(
	count: number,
	seed: number,
): VoronoiFragment[] {
	const rng = seededRandom(seed);
	const half = KIMONO_SIZE / 2;

	// Generate random seed points within the square
	const points: Array<[number, number]> = [];
	for (let i = 0; i < count; i++) {
		const x = -half + rng() * KIMONO_SIZE;
		const y = -half + rng() * KIMONO_SIZE;
		points.push([x, y]);
	}

	// Compute Delaunay triangulation and Voronoi diagram
	const delaunay = Delaunay.from(points);
	const voronoi = delaunay.voronoi([
		-half, -half,
		half, half,
	]);

	const fragments: VoronoiFragment[] = [];

	for (let i = 0; i < count; i++) {
		const cellPolygon = voronoi.cellPolygon(i);
		if (!cellPolygon || cellPolygon.length < 3) continue;

		// cellPolygon is closed (last point = first point)
		const polygon: Array<[number, number]> = cellPolygon.map(
			(p) => [p[0], p[1]] as [number, number],
		);

		// Compute centroid
		const cx = points[i][0];
		const cy = points[i][1];

		// Create triangulated geometry with UV mapping
		const geometry = createFragmentGeometry(polygon, cx, cy);

		fragments.push({
			index: i,
			centroid: [cx, cy],
			polygon,
			geometry,
		});
	}

	return fragments;
}

/**
 * Create a BufferGeometry for a convex polygon using fan triangulation.
 * UV coordinates map world position to [0,1] range over KIMONO_SIZE.
 */
function createFragmentGeometry(
	polygon: Array<[number, number]>,
	centroidX: number,
	centroidY: number,
): BufferGeometry {
	const half = KIMONO_SIZE / 2;

	// Fan triangulation from centroid
	// polygon is closed, so polygon.length - 1 = number of unique vertices
	const vertexCount = polygon.length - 1;
	const triangleCount = vertexCount;
	const positions = new Float32Array(triangleCount * 3 * 3); // 3 vertices × 3 components
	const uvs = new Float32Array(triangleCount * 3 * 2); // 3 vertices × 2 components

	for (let t = 0; t < triangleCount; t++) {
		const v0x = centroidX;
		const v0y = centroidY;
		const v1x = polygon[t][0];
		const v1y = polygon[t][1];
		const v2x = polygon[t + 1][0];
		const v2y = polygon[t + 1][1];

		const baseIdx = t * 9; // 3 vertices × 3 components
		// Vertex 0: centroid
		positions[baseIdx] = v0x;
		positions[baseIdx + 1] = v0y;
		positions[baseIdx + 2] = 0;
		// Vertex 1
		positions[baseIdx + 3] = v1x;
		positions[baseIdx + 4] = v1y;
		positions[baseIdx + 5] = 0;
		// Vertex 2
		positions[baseIdx + 6] = v2x;
		positions[baseIdx + 7] = v2y;
		positions[baseIdx + 8] = 0;

		// UV: map world [-half, half] to [0, 1]
		// Note: Y is flipped for Three.js texture coordinates
		const uvIdx = t * 6;
		uvs[uvIdx] = (v0x + half) / KIMONO_SIZE;
		uvs[uvIdx + 1] = (v0y + half) / KIMONO_SIZE;
		uvs[uvIdx + 2] = (v1x + half) / KIMONO_SIZE;
		uvs[uvIdx + 3] = (v1y + half) / KIMONO_SIZE;
		uvs[uvIdx + 4] = (v2x + half) / KIMONO_SIZE;
		uvs[uvIdx + 5] = (v2y + half) / KIMONO_SIZE;
	}

	const geo = new BufferGeometry();
	geo.setAttribute("position", new BufferAttribute(positions, 3));
	geo.setAttribute("uv", new BufferAttribute(uvs, 2));

	return geo;
}

/** Dispose all fragment geometries */
export function disposeFragments(fragments: VoronoiFragment[]): void {
	for (const f of fragments) {
		f.geometry.dispose();
	}
}
