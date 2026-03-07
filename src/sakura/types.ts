export type AtlasPageInfo = {
	id: number;
	file: string;
	width: number;
	height: number;
};

export type CategoryInfo = {
	id: number;
	name: string;
	bit: number;
};

export type SegmentInfo = {
	id: number;
	sourceImageId: string;
	categoryName: string;
	categoryId: number;
	categoryMask: number;
	atlasPage: number;
	/** [u0, v0, du, dv] — normalized UV rect within the atlas page */
	uvRect: [number, number, number, number];
	/** [x, y, width, height] in pixels within the atlas */
	pixelRect: [number, number, number, number];
	/** [width, height] of the trimmed segment in pixels */
	trimmedSize: [number, number];
	/** [width, height] of the original source image */
	originalSize: [number, number];
	/** [x, y] normalized pivot point (0-1) */
	pivot: [number, number];
	/** [x, y, width, height] bounding box in the original source image */
	bboxInSource: [number, number, number, number];
};

export type SegmentManifest = {
	version: number;
	atlas: {
		pages: AtlasPageInfo[];
		colorSpace: string;
		premultipliedAlpha: boolean;
		paddingPx: number;
	};
	categories: CategoryInfo[];
	segments: SegmentInfo[];
};
