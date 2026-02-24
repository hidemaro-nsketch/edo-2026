# Project Brief: kimono-bg-segment-switch

## 着物背景表示 + 桜セグメント in-place 切り替え

### Current State

- **Architecture**: React Three Fiber + Three.js InstancedMesh
- **Rendering**: 17 sakura segments across 5 depth layers with sweep animation
- **Data**: segments.manifest.json (17 segments from "花陽ひいなかた-2") + 2048x2048 atlas PNG
- **Shaders**: GPU-driven sweep clock, cross-fade between segment IDs, perspective compensation
- **Relevant code**:
  - `src/routes/index.tsx` — Main scene, shaders, instanced geometry, layers
  - `src/sakura/segment-manager.ts` — Atlas texture loading
  - `src/sakura/types.ts` — Manifest type definitions
  - `src/sakura/cell-state-manager.ts` — CPU cell state (unused currently)
  - `public/sakura/segments.manifest.json` — Segment metadata
  - `public/sakura/atlas/sakura_atlas_0.png` — Texture atlas

### Goal

Display the original kimono image as a background, with sakura segments overlaid at their original positions. Each segment randomly and individually switches to a different segment's texture with a smooth cross-fade, creating a meditative in-place transformation effect.

### Scope

**Include:**
- Background kimono image display (textured plane)
- Sakura segments at fixed positions (from bboxInSource)
- Random per-segment switching with cross-fade transition
- Configurable timing parameters (switch interval, fade duration)
- Background image specification document
- OrbitControls (rotate/zoom)

**Exclude:**
- Multi-layer parallax (remove 5-layer system)
- Sweep animation (remove wave-based movement)
- Perspective compensation (single layer, not needed)
- KimonoFrame wireframe (replaced by actual kimono image)

### Constraints

- Keep InstancedMesh for GPU efficiency (17 instances is small but good practice)
- Background image provided by user; spec document needed
- Existing manifest format unchanged
- Atlas texture unchanged

### Success Criteria

- Original kimono image visible as background
- 17 sakura segments displayed at correct positions over the kimono
- Segments switch individually with smooth cross-fade
- Timing parameters easily adjustable (constants or uniforms)
- No movement/sweep animation
- OrbitControls functional
