# Sakura Segmentation Texture Voronoi Architecture

> Codex consultation result (2026-02-18)

## 1. Data Specification

Use an offline build step that outputs:

- `public/sakura/atlas/sakura_atlas_0.ktx2` (and `_1`, `_2` if needed)
- `public/sakura/segments.manifest.json`
- Optional debug source: `public/sakura/segments_raw/*.png` (trimmed RGBA)

### Recommended texture settings

- Format: `KTX2` (UASTC for quality, ETC1S for smaller size), `sRGB`, alpha included.
- Atlas page size: `2048x2048` (safe on mobile), fallback up to `4096` on desktop if needed.
- Segment max side: `256-384` px (trunk can be `512` if needed).
- Padding: `8 px` + edge dilation to avoid mip bleeding.
- Alpha: premultiplied before packing.

### Memory guidance

- `2048^2 RGBA8` = 16 MB/page (about 21 MB with mipmaps).
- 2 pages ~= 42 MB with mipmaps; 3 pages ~= 63 MB.
- Keep feature under ~64 MB total for broad device safety.

### Manifest JSON schema

```json
{
  "version": 1,
  "atlas": {
    "pages": [
      { "id": 0, "file": "sakura_atlas_0.ktx2", "width": 2048, "height": 2048 },
      { "id": 1, "file": "sakura_atlas_1.ktx2", "width": 2048, "height": 2048 }
    ],
    "colorSpace": "srgb",
    "premultipliedAlpha": true,
    "paddingPx": 8
  },
  "categories": [
    { "id": 0, "name": "flower", "bit": 1 },
    { "id": 1, "name": "leaf", "bit": 2 },
    { "id": 2, "name": "trunk", "bit": 4 }
  ],
  "segments": [
    {
      "id": 37,
      "sourceImageId": "sakura_08",
      "categoryId": 1,
      "categoryMask": 2,
      "atlasPage": 0,
      "uvRect": [0.3125, 0.1406, 0.0820, 0.1172],
      "pixelRect": [640, 288, 168, 240],
      "trimmedSize": [168, 240],
      "originalSize": [512, 512],
      "pivot": [0.50, 0.56],
      "bboxInSource": [122, 80, 168, 240]
    }
  ]
}
```

## 2. Texture Strategy (50-150 segments)

Use a **paged atlas** (not individual textures).

### Best architecture

- Preferred (WebGL2): one `sampler2DArray` atlas (each page = one layer).
- Fallback: `sampler2D uAtlas0..uAtlas3` with page switch in shader.

### Atlas UV lookup via data textures

- `uSegmentUVTex` (`RGBA32F`, size `256x1`): `[u0, v0, du, dv]`
- `uSegmentMetaTex` (`RGBA32F`, size `256x1`): `[page, categoryMask, aspect, flags]`

This avoids large uniform arrays and supports dynamic content.

## 3. Shader Architecture

Keep existing Voronoi + sweep logic. Add cell texture color stage after nearest-seed is found.

### Lookup helpers

```glsl
// GLSL 300 es
uniform sampler2D uCellStateTex;   // width=150, height=5
uniform sampler2D uCellXformTex;   // width=150, height=5
uniform sampler2D uSegmentUVTex;   // width=256, height=1
uniform sampler2D uSegmentMetaTex; // width=256, height=1
uniform sampler2DArray uAtlasArray;
uniform uint uVisibleCategoryMask;

vec4 getSegUV(float segId) {
  return texelFetch(uSegmentUVTex, ivec2(int(segId), 0), 0);
}

vec4 getSegMeta(float segId) {
  return texelFetch(uSegmentMetaTex, ivec2(int(segId), 0), 0);
}

float categoryVisible(float categoryMask) {
  uint mask = uint(categoryMask + 0.5);
  return ((mask & uVisibleCategoryMask) != uint(0)) ? 1.0 : 0.0;
}

vec4 sampleSegment(float segId, vec2 localUV) {
  vec4 uvRect = getSegUV(segId);      // u0,v0,du,dv
  vec4 meta = getSegMeta(segId);      // page,catMask,aspect,flags
  vec2 uv = uvRect.xy + localUV * uvRect.zw;
  vec4 c = texture(uAtlasArray, vec3(uv, meta.x));
  return c;
}
```

### Per-cell UV transform (world -> segment local)

```glsl
vec2 rel = (p - seedPos) / cellRadius;      // around nearest seed
vec4 xf = texelFetch(uCellXformTex, ivec2(cellIdx, layerIdx), 0); // rot,scale,offX,offY
float cs = cos(xf.x), sn = sin(xf.x);
mat2 R = mat2(cs, -sn, sn, cs);
vec2 localUV = (R * rel) * xf.y * 0.5 + vec2(0.5) + xf.zw;
```

### Blend current/next segment and preserve sweep

```glsl
vec4 st = texelFetch(uCellStateTex, ivec2(cellIdx, layerIdx), 0); // curr,next,t,flags
vec4 a = sampleSegment(st.x, localUV);
vec4 b = sampleSegment(st.y, localUV);
vec4 seg = mix(a, b, st.z);

float catVis = categoryVisible(getSegMeta(st.y).y);
float finalAlpha = seg.a * sweepAlpha * catVis; // sweepAlpha from existing system
vec3 finalRgb = seg.rgb; // premultiplied pipeline preferred
```

## 4. Cell-Segment Mapping

### Runtime structure (CPU)

- `cellState[layer][seed] = {currSeg, nextSeg, t, flags}`
- `cellXform[layer][seed] = {rot, scale, offsetX, offsetY}`

### GPU encoding via data textures

- `uCellStateTex` (`150x5`, `RGBA32F`)
  - `R`: current segment id
  - `G`: next segment id
  - `B`: transition t [0..1]
  - `A`: flags/reserved
- `uCellXformTex` (`150x5`, `RGBA32F`)
  - `R`: rotation radians
  - `G`: scale
  - `B`,`A`: UV offset

### Transition trigger with sweep

When sweep front enters a cell:
1. Choose `nextSeg` from active category pool
2. Set `t=0`
3. Animate `t -> 1` over 0.2-0.6s
4. On completion set `currSeg=nextSeg`, `t=1`

This keeps reveal logic and segment swap decoupled.

## 5. Category Filtering

Use bitmask filtering end-to-end:

- Segment has `categoryMask` in manifest.
- Global uniform: `uVisibleCategoryMask` (e.g. flower|leaf = 3).
- Shader multiplies by `catVis` so hidden categories fade out with current sweep.

### Interaction with existing visibility

```glsl
float visible = sweepAlpha * globalLayerOpacity * catVis;
outColor = vec4(seg.rgb, seg.a * visible);
```

### Animated filter toggles

- On UI change, update `uVisibleCategoryMask`.
- Optionally drive per-category fade uniforms (0..1 over 200ms) for softer transitions.
- For hard remap behavior, reassign cells whose category becomes hidden and run `curr->next` transition.

## Summary of GPU Resources

| Texture | Size | Format | Purpose |
|---------|------|--------|---------|
| `uAtlasArray` | 2048x2048 x 2-3 layers | KTX2 (RGBA) | Segment images |
| `uSegmentUVTex` | 256x1 | RGBA32F | Atlas UV rects per segment |
| `uSegmentMetaTex` | 256x1 | RGBA32F | Category, page, aspect per segment |
| `uCellStateTex` | 150x5 | RGBA32F | Current/next segment, transition t |
| `uCellXformTex` | 150x5 | RGBA32F | Rotation, scale, offset per cell |

Total GPU memory estimate: ~42-63 MB (atlas) + negligible (data textures).
