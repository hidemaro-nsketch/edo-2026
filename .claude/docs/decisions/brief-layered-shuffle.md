# Project Brief: Layered Shuffle

## Current State
- Architecture: Single-layer instanced rendering with 33 segments on a flat plane (Z=0)
- Cycle: SHUFFLING → HOPPING → HOLDING (loop)
- Key files: `src/routes/index.tsx` (all logic), `src/sakura/` (types, segment-manager)
- Rendering: InstancedBufferGeometry with custom ShaderMaterial, single draw call

## Goal
Transform the shuffle system from a flat single-layer animation into a 3D layered structure where each shuffle generation stacks as a new Z-layer, with connecting lines showing segment movement history between layers.

## Scope
### Include
- 11 layers total (0=original, 1-10=shuffle generations)
- Z-axis stacking per generation (+1 per layer)
- Connection lines between layers (only for shuffled segments, showing origin→destination)
- Camera sequence: top-down for gen 1-5, transition to oblique for gen 6-10
- Collapse animation: layers disappear top-down after gen 10, leaving only layer 0
- Full loop: restart after collapse
- Remove HOPPING phase entirely
- shuffleDuration default = 2s

### Exclude
- Changes to atlas/manifest format
- Changes to segment-manager.ts or types.ts
- New external dependencies

## Constraints
- Three.js r181 + @react-three/fiber v9
- Must maintain instanced rendering approach for performance (33 segments × 11 layers = 363 instances max)
- No new npm dependencies needed (Three.js Line primitives are sufficient)

## Success Criteria
- 10 generations of shuffling create visible stacked layers
- Connection lines clearly show which segments moved between adjacent layers
- Camera transitions smoothly from top-down to oblique at generation 6
- Collapse animation removes layers sequentially, leaving original
- Seamless loop restart
