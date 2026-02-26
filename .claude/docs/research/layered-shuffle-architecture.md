# Layered Shuffle Architecture (Codex Consultation)

Date: 2026-02-26
Source: Codex (gpt-5.3-codex)

## 1. Geometry Strategy: Separate Per-Layer Instanced Meshes

**Recommendation**: 11 separate instanced meshes (one per layer, 33 instances each), sharing base geometry, shader, and textures.

**Rationale**:
- Simpler state ownership per generation
- Cleaner collapse/remove logic (just stop rendering that mesh)
- Easy per-layer opacity/Z animation via uniforms
- 11 draw calls is trivial for modern GPUs
- One giant 363-instance mesh makes layer lifecycle and transitions harder

## 2. Layer Stack Data Model

Model generations as immutable snapshots with explicit diffs:

```ts
type LayerState = {
  gen: number;              // 0..10
  z: number;
  alive: boolean;
  opacity: number;          // animatable
  slotToTex: Uint16Array;   // len=33, slot i -> textureId
  texToSlot: Uint16Array;   // inverse map for fast link building
  changedSlots: Uint8Array; // 0/1, len=33 vs previous layer
  linksFromPrev: Array<{ fromSlot: number; toSlot: number }>;
};
```

- Fixed pool of 11 layers (ring buffer)
- On each generation: clone previous `slotToTex`, apply shuffle permutation, compute `changedSlots`, build `linksFromPrev`, freeze snapshot

## 3. Connection Lines: Single Dynamic LineSegments

**Recommendation**: One `THREE.LineSegments` geometry with preallocated buffer.

- Preallocate: `positions = Float32Array(MAX_LINKS * 2 * 3)`
- Update only on generation create/collapse events, not every frame
- For thick lines: switch to instanced cylinders or `Line2` mesh lines (WebGL `lineWidth` is unreliable across browsers)

## 4. Camera Transition: Preset Blending State Machine

Two presets with smooth interpolation:
- Top-down preset for gen 1-5
- Oblique preset for gen 6-10
- Blend factor: `t = clamp((genProgress - 5) / 5, 0, 1)`
- Position: `lerp(topPos, obliquePos, t)`
- Rotation: `slerp(topQuat, obliqueQuat, t)`
- Use smoothstep + damping for natural feel

## 5. Collapse Animation: Hybrid Shader Fade + JS Deactivation

- Animate per-layer `opacity` uniform (+ optional Z offset) for visual collapse
- After fade completes, mark `alive=false` and stop rendering
- Avoid instant JS removal (looks abrupt)
- Avoid per-frame geometry rebuilding

## 6. Performance Assessment

363 quads + ~300 lines is very safe on desktop/mobile, provided:
- Preallocate typed arrays (no runtime allocations)
- Update attributes only on generation events
- Use texture atlas or `sampler2DArray` (already using atlas)
- Handle transparency carefully (`depthWrite=false`, controlled render order)

## Suggested Code Structure

```
src/
  simulation/
    layerStack.ts          # Generation, shuffle, diffs, collapse state machine
  render/
    LayerMesh.tsx           # One layer renderer (instancing + shader uniforms)
    ConnectionLines.tsx     # Single dynamic LineSegments
    CameraRig.tsx           # Preset blending camera controller
  scene/
    LayeredShuffleScene.tsx  # Orchestration / timeline loop
```
