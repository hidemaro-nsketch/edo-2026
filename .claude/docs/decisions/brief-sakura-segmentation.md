# Project Brief: sakura-segmentation

## Current State

- **Architecture**: TanStack Start + React Three Fiber (Three.js) + custom GLSL shaders
- **Relevant code**: `src/routes/index.tsx` (253 lines) — 5-layer Voronoi visualization
- **Patterns**: Single-file component, inline GLSL shaders, R3F `useFrame` for animation
- **Key behavior**: 150 Voronoi seeds per layer, sweep animation for cell visibility, cell deformation on appearance, HSV procedural coloring, orbit camera controls

## Goal

Replace procedural Voronoi cell colors with AI-segmented sakura image textures. Each cell displays one segment (e.g., "sakura A's flower"), with category-based filtering (show only flowers, only leaves, etc.) and animated transitions between different sakura images.

## Scope

### Include
- Data specification for segmentation assets (texture images + metadata)
- Texture loading and management system for 10-30 sakura images × 3-5 segments each
- Shader modifications to render textures within Voronoi cells instead of solid colors
- Category-based segment filtering (flower/leaf/trunk visibility toggles)
- Animated transitions between sakura images (reuse existing sweep animation)
- Per-cell segment assignment and mapping logic

### Exclude
- AI segmentation processing itself (done externally)
- Video export functionality
- Linear integration
- Camera/orbit control changes

## Constraints

- Must work in browser (WebGL / Three.js)
- 10-30 sakura images, each with 3-5 segments (50-150 total segments)
- Texture atlas or efficient loading strategy needed for GPU memory
- Existing sweep/deformation animation should be preserved and repurposed

## Success Criteria

- Voronoi cells display segmented sakura image textures instead of solid colors
- Users can toggle visibility by segment category (flower, leaf, trunk, etc.)
- Sweep animation transitions between different sakura sources (A→B)
- Performance remains smooth in browser (60fps target)
- Clear data specification that guides the segmentation asset preparation
