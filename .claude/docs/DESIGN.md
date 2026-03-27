# Design Document

## Overview

Voronoi visualization with AI-segmented sakura image textures. Each Voronoi cell displays a segmented part (flower, leaf, trunk) from sakura photographs, with category-based filtering and animated transitions between sakura sources.

## Architecture

### System Diagram

```
[Offline Pipeline]
  sakura_*.png + segmentation masks
    → atlas packer (Python script)
    → public/sakura/atlas/sakura_atlas_*.ktx2
    → public/sakura/segments.manifest.json

[Runtime - Browser]
  manifest.json → SegmentManager (CPU)
    → DataTexture: uSegmentUVTex (256x1 RGBA32F)
    → DataTexture: uSegmentMetaTex (256x1 RGBA32F)

  atlas_*.ktx2 → TextureLoader
    → sampler2DArray: uAtlasArray

  SegmentManager + AnimationController (CPU, per frame)
    → DataTexture: uCellStateTex (150x5 RGBA32F)
    → DataTexture: uCellXformTex (150x5 RGBA32F)

  Fragment Shader:
    existing Voronoi nearest-neighbor → cellIdx
    → texelFetch(uCellStateTex) → currSeg, nextSeg, t
    → sampleSegment(segId, localUV) from atlas
    → mix(curr, next, t) × sweepAlpha × catVis
```

### Key Design Decisions

1. **Paged Atlas (sampler2DArray)**: 50-150 segments packed into 2048x2048 atlas pages. Avoids WebGL texture unit limits. ~42-63 MB GPU memory.

2. **Data Textures for Mapping**: Cell-segment assignments and segment metadata encoded as small data textures (not uniform arrays). Supports dynamic reassignment per frame.

3. **Bitmask Category Filtering**: Each category (flower=1, leaf=2, trunk=4) gets a bit. Single `uint` uniform `uVisibleCategoryMask` controls visibility. Efficient shader-side check.

4. **Decoupled Sweep + Transition**: Existing sweep animation controls visibility timing. Segment transitions (A→B) are independent, triggered when sweep front enters a cell.

### Data Specification

See: `.claude/docs/research/sakura-segmentation-architecture.md`

#### Required Input Files

For each sakura image:
1. **Source image** (PNG, RGBA) — original photograph
2. **Segment masks** (PNG, binary per category) — flower, leaf, trunk masks
3. **Metadata** — bounding box of each segment in source coordinates

#### Output Format (from atlas packer)

- `public/sakura/atlas/sakura_atlas_N.ktx2` — compressed texture atlas pages
- `public/sakura/segments.manifest.json` — manifest with UV rects, categories, metadata

#### Simplified Development Format (Phase 1)

For initial development, use uncompressed PNG atlas + JSON manifest:
- `public/sakura/atlas/sakura_atlas_0.png` (2048x2048 RGBA)
- `public/sakura/segments.manifest.json`

KTX2 compression can be added as optimization later.

### GPU Resource Budget

| Texture | Size | Format | Memory |
|---------|------|--------|--------|
| uAtlasArray | 2048² × 2-3 layers | RGBA8 | 32-48 MB |
| uSegmentUVTex | 256×1 | RGBA32F | 4 KB |
| uSegmentMetaTex | 256×1 | RGBA32F | 4 KB |
| uCellStateTex | 150×5 | RGBA32F | 12 KB |
| uCellXformTex | 150×5 | RGBA32F | 12 KB |

## Implementation Plan

### Task 1: Data Specification & Manifest Schema
- Define final JSON manifest schema
- Create TypeScript types for manifest
- Create sample/mock manifest for development

### Task 2: Atlas Packer Script (Python)
- Read trimmed segment PNGs + metadata
- Pack into 2048x2048 atlas pages (bin packing)
- Output atlas PNG + manifest JSON
- (KTX2 compression deferred)

### Task 3: Texture Loading System (TypeScript/R3F)
- Load manifest JSON
- Load atlas textures (PNG initially, KTX2 later)
- Create SegmentManager class to hold parsed data
- Build data textures (uSegmentUVTex, uSegmentMetaTex)

### Task 4: Cell-Segment Mapping & State Management
- CellStateManager: tracks currSeg/nextSeg/t per cell per layer
- CellXformManager: rotation, scale, offset per cell
- Build and update uCellStateTex, uCellXformTex each frame
- Initial random assignment of segments to cells

### Task 5: Shader Rewrite — Texture Sampling
- Upgrade to GLSL 300 es (for texelFetch, sampler2DArray)
- Add atlas sampling after Voronoi nearest-neighbor
- Per-cell UV transform (world → local → atlas)
- Preserve existing sweep/deformation animation

### Task 6: Segment Transition Animation
- Detect sweep front entering cell (CPU side)
- Trigger currSeg→nextSeg transition
- Animate t from 0→1, blend in shader
- Pool-based nextSeg selection

### Task 7: Category Filtering UI & Logic
- Bitmask uniform uVisibleCategoryMask
- UI toggles for flower/leaf/trunk visibility
- Optional smooth fade per category
- Reassign hidden-category cells on filter change

### Task 8: Integration & Polish
- Connect all systems
- Performance profiling
- Edge cases (empty categories, all hidden, etc.)
- Camera/interaction adjustments if needed

## TODO

- [ ] Decide on segment image resolution (256px vs 384px)
- [ ] Determine exact category list beyond flower/leaf/trunk
- [ ] Test sampler2DArray support on target browsers

## Open Questions

- Should segments maintain their original spatial relationship from the photo, or be freely repositioned within cells?
- What should happen when all segments of a category are hidden — show empty cells or redistribute?
- Should there be a UI for controlling sweep speed / transition timing?

## Layered Shuffle Architecture (2026-02-26)

### Concept

Shuffle generations stack as Z-layers, creating a 3D "history" of shuffles.
Layer 0 = original image. Layers 1-10 = shuffle generation results.
Lines connect shuffled segments between adjacent layers.

### Architecture Decisions (Codex Consultation)

1. **Per-layer instanced meshes**: 11 separate meshes (33 instances each), not one giant 363-instance mesh. Simpler lifecycle, per-layer opacity via uniforms.
2. **Immutable snapshot model**: Each layer stores `slotToTex` (which texture each slot shows), `changedSlots` (diff vs previous), `linksFromPrev` (connection data).
3. **Single dynamic LineSegments**: One preallocated buffer for all connection lines, updated on generation events only.
4. **Camera preset blending**: Top-down for gen 1-5, oblique for 6-10, `t = clamp((gen-5)/5, 0, 1)` with smoothstep.
5. **Hybrid collapse**: Shader opacity fade per layer → deactivate after fade.

### File Structure

```
src/
  layered-shuffle/
    layer-stack.ts           # Generation state machine, shuffle logic, diffs
    types.ts                 # LayerState, ShuffleConfig types
  render/
    LayerMesh.tsx            # Per-layer instanced renderer
    ConnectionLines.tsx      # Dynamic LineSegments
    CameraRig.tsx            # Preset blending camera
  routes/
    index.tsx                # Orchestration (rewritten)
```

### Sequence

```
INIT → [SHUFFLE gen1 → FREEZE] → ... → [SHUFFLE gen10 → FREEZE]
     → CAMERA_REVEAL (oblique at gen 6+)
     → COLLAPSE (layers 10→1 fade out sequentially)
     → LOOP (restart from INIT)
```

### Flash Reintroduction (2026-03-18)

- Reintroduce only the lightweight bbox flash effect, not the older flight/buildStagger pipeline.
- Each layer now follows `flash -> swipe -> hold -> commit`, where flash renders bbox outlines only for `settle` legs on that layer.
- `preCollapse` also reuses bbox outlines, flashing all settled segments before collapse while keeping the current camera reveal timing.
- The current swipe-based state machine and per-layer instanced rendering remain unchanged to minimize regression risk.
- Flash timing is controlled through `ShuffleConfig` and Leva (`flashCount`, `flashOnDuration`, `flashOffDuration`).

## Changelog

- 2026-03-18: Reintroduced lightweight bbox flash before swipe and during pre-collapse without restoring the legacy flight pipeline.
- 2026-02-26: Layered shuffle architecture (Codex consultation). Per-layer instancing, connection lines, camera rig.
- 2026-02-18: Initial architecture design (Codex consultation). Paged atlas + data textures + bitmask filtering.
