# Project Brief: Segment Animation & Object-Fit Contain

## Current State
- Instanced rendering with per-instance aPosition, aSize, aUvRect
- All layers (1-10) have flight animation (0.6s per layer)
- Segments fly from prev layer to current layer with easeOutCubic
- No "black fill" effect when segments vacate a position
- Collapse reverses all flight animations

## Goal (Current Feature)
1. Layer 1-4: swaps still occur but flight animation is instant (no interpolation)
2. Layer 5-10: flight animation as before
3. When a segment moves from slot_i to slot_j, the source layer gets a black opaque rectangle at slot_i (bboxInSource size)
4. Black fills accumulate across layers and persist
5. Collapse reverses black fills too

## Scope
- Include: instant commit for layers 1-4, black fill rectangles, collapse integration
- Exclude: changes to swap logic, camera rig, connection lines behavior

## Constraints
- Black fills are full opacity, pure black, bboxInSource sized
- Black fills appear on the source layer (layerA), not destination (layerB)
- Layer 1-4 still go through flight/hold/commit phases but with zero-duration flight (instant placement)

## Key Files
- `src/layered-shuffle/types.ts` — ShuffleConfig (add animationStartLayer)
- `src/layered-shuffle/build-system.ts` — flight skip logic, black fill data generation
- `src/layered-shuffle/compiled-plan.ts` — vacated slot tracking per layer
- `src/render/SegmentMeshes.tsx` — black fill mesh rendering

## Success Criteria
- Layer 1-4 segments appear instantly (no flight animation)
- Black rectangles appear at vacated positions on the source layer
- Black fills persist across subsequent layers
- Collapse animation reverses black fills correctly
- Layer 5-10 animation unchanged
