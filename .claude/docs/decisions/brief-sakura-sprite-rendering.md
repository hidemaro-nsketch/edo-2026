# Project Brief: sakura-sprite-rendering

## Current State
- Architecture: React Three Fiber + custom GLSL shader on fullscreen planes
- Rendering: 5 layers × 150 Voronoi seeds = 750 cells, each sampling from atlas texture
- Animation: Sweep (circular appear/disappear), movement perturbation during transitions
- Data: 30 segments in `public/sakura/segments.manifest.json`, 1 atlas page (2048x2048)
- Key files: `src/routes/index.tsx` (shader + scene), `src/sakura/` (managers)

## Goal
Replace Voronoi cell-based rendering with sprite-based rendering that shows each sakura segment in its original shape (alpha boundary from atlas), while preserving the sweep animation behavior.

## Scope
- Include:
  - Replace Voronoi shader with InstancedMesh per layer
  - Custom vertex/fragment shader for instanced quads
  - Preserve sweep animation (circular appear/disappear pattern)
  - Preserve movement perturbation during transitions
  - Atlas alpha defines segment shape (no Voronoi clipping)
  - Maintain 5-layer depth structure with perspective compensation
- Exclude:
  - Category filtering (already removed)
  - New data formats or atlas changes
  - UI changes

## Constraints
- WebGL2 target (browser)
- Must maintain smooth 60fps with 750 textured quads
- Reuse existing manifest format and atlas textures
- Keep existing SegmentManager for atlas loading

## Success Criteria
- Sakura segments render in their original cutout shape (not clipped to Voronoi cells)
- Sweep animation works as before (circular pattern of appear/disappear)
- Movement perturbation preserved
- No performance regression
- TypeScript compiles without errors

## Architecture Decision (Codex)
**InstancedMesh per layer + custom shader** recommended:
- 5 draw calls total (1 per layer)
- Per-instance attributes: position, UV rect, size/aspect, animation phase
- Sweep + perturbation computed in vertex/fragment shader
- Alpha from atlas texture for shape
