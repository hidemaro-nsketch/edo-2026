# Project Brief: instant-swipe

## Instant Layer Swipe Transition Animation

### Current State

- **Architecture**: BuildSystem state machine (flight → hold → commit per layer)
- **Instant layers**: `currentLayer < animationStartLayer` → flight/hold skipped, instant commit
- **Rendering**: GPU instanced meshes with custom GLSL shaders
- **Key files**:
  - `src/layered-shuffle/types.ts` — Type definitions, BuildPhase
  - `src/layered-shuffle/build-system.ts` — State machine, instance generation
  - `src/render/SegmentMeshes.tsx` — Instanced rendering + GLSL shaders

### Goal

Add a horizontal swipe/wipe transition animation for instant layers so that
swapped segments visually transition (old wipes out, new wipes in) instead of
appearing instantly.

### Scope

- **Include**:
  - New `"swipe"` phase in BuildSystem state machine
  - Dual instance emission (old + new segment) during swipe
  - GLSL shader modification for horizontal wipe clipping
  - New per-instance attribute `aWipeRole` and uniform `uSwipeProgress`
- **Exclude**:
  - Changes to non-instant (flight) layers
  - Changes to collapse animation
  - New config parameters (reuses `flightDuration`)

### Constraints

- Minimal changes to existing rendering pipeline
- Must work with existing instanced buffer architecture
- Swipe uses local quad UV (0..1), not atlas UV

### Success Criteria

- Instant layers show horizontal left→right wipe transition for swap pairs
- Pass-through segments appear without wipe
- Each instant layer animates sequentially
- No visual regression in flight layers or collapse
