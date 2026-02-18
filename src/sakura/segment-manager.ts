import {
	DataTexture,
	FloatType,
	RGBAFormat,
	NearestFilter,
	DataArrayTexture,
	SRGBColorSpace,
	TextureLoader,
	type Texture,
} from "three";
import type { SegmentManifest, SegmentInfo } from "./types";

const MAX_SEGMENTS = 256;

export class SegmentManager {
	readonly manifest: SegmentManifest;
	/** RGBA32F, 256x1 — [u0, v0, du, dv] per segment */
	readonly segmentUVTex: DataTexture;
	/** Atlas pages loaded as textures */
	readonly atlasTextures: Texture[] = [];

	constructor(manifest: SegmentManifest) {
		this.manifest = manifest;

		const uvData = new Float32Array(MAX_SEGMENTS * 4);

		for (const seg of manifest.segments) {
			const offset = seg.id * 4;
			uvData[offset] = seg.uvRect[0];
			uvData[offset + 1] = seg.uvRect[1];
			uvData[offset + 2] = seg.uvRect[2];
			uvData[offset + 3] = seg.uvRect[3];
		}

		this.segmentUVTex = createDataTexture(uvData, MAX_SEGMENTS, 1);
	}

	getSegmentCount(): number {
		return this.manifest.segments.length;
	}

	getSegment(id: number): SegmentInfo | undefined {
		return this.manifest.segments.find((s) => s.id === id);
	}

	dispose(): void {
		this.segmentUVTex.dispose();
		for (const tex of this.atlasTextures) {
			tex.dispose();
		}
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

/**
 * Load atlas textures from the manifest.
 * For development, loads PNG files. For production, would load KTX2.
 */
export async function loadAtlasTextures(
	manifest: SegmentManifest,
	basePath: string,
): Promise<Texture[]> {
	const loader = new TextureLoader();
	const textures: Texture[] = [];

	for (const page of manifest.atlas.pages) {
		const url = `${basePath}/${page.file}`;
		const tex = await loader.loadAsync(url);
		tex.colorSpace = SRGBColorSpace;
		tex.flipY = false;
		textures.push(tex);
	}

	return textures;
}

/**
 * Create a DataArrayTexture from loaded atlas page textures.
 * This is the preferred GPU-efficient approach for WebGL2.
 */
export function createAtlasArrayTexture(
	atlasTextures: Texture[],
	width: number,
	height: number,
): DataArrayTexture {
	const depth = atlasTextures.length;
	const size = width * height * 4;
	const combined = new Uint8Array(size * depth);

	for (let i = 0; i < depth; i++) {
		const source = atlasTextures[i].image as HTMLImageElement | ImageBitmap;
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext("2d");
		if (!ctx) {
			throw new Error("Failed to get 2D context for atlas extraction");
		}
		ctx.drawImage(source, 0, 0, width, height);
		const imageData = ctx.getImageData(0, 0, width, height);
		combined.set(imageData.data, i * size);
	}

	const arrayTex = new DataArrayTexture(combined, width, height, depth);
	arrayTex.colorSpace = SRGBColorSpace;
	arrayTex.needsUpdate = true;
	return arrayTex;
}
