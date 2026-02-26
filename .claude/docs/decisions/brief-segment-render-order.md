## Project Brief: Per-Layer renderOrder for Segment Meshes

### Current State
- Architecture: 3 instanced meshes (base/active/settled) render all layers 0-10
- renderOrder: base=10, active=11, settled=12 (flat, no per-layer distinction)
- Transparent materials with depthWrite: false, custom blending (premultiplied alpha)
- KimonoBackground at renderOrder=-100 (working correctly)
- BuildSystem tracks layers 0-10 with layerSpacing=1.0 for Z offset

### Problem
- Since depthWrite is false, Z-depth cannot sort transparent objects
- All settled segments share one renderOrder regardless of layer
- Upper layers may not render correctly on top of lower layers

### Goal
Split instanced meshes by layer so each layer gets a distinct renderOrder, ensuring upper layers render on top of lower layers.

### Design (Codex-recommended)
- Create per-layer instanced meshes instead of 3 global meshes
- renderOrder formula: `layer * 10 + statePriority` (base=0, active=1, settled=2)
- Max 33 draw calls (11 layers × 3 states) — acceptable for WebGL
- ConnectionLines renderOrder adjusted to avoid collision

### Scope
- Include: SegmentMeshes.tsx mesh management refactor
- Include: ConnectionLines.tsx renderOrder adjustment if needed
- Exclude: BuildSystem logic changes (data layer unchanged)
- Exclude: KimonoBackground (already working)

### Constraints
- Maintain existing animation behavior (flight, settle, collapse)
- Keep instanced rendering for performance
- Preserve premultiplied alpha blending

### Success Criteria
- Upper layer segments render on top of lower layer segments
- Animation (build + collapse) works as before
- No visual regression for KimonoBackground
