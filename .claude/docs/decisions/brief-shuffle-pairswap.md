# Project Brief: Shuffle Pair-Swap Refactor

## Current State
- Architecture: `LayerStack` pure state machine drives shuffle logic, `useLayeredShuffle` hook integrates with React/Three.js
- Relevant code: `src/layered-shuffle/layer-stack.ts`, `src/layered-shuffle/types.ts`, `src/routes/index.tsx` (handleShuffling, useLayeredShuffle)
- Patterns: Phase-based state machine (frozen → shuffling → frozen → collapsing → holding)

### Current Shuffle Behavior
- Random slot selection + random segment ID assignment (not a swap)
- Fixed shuffle rate across all generations
- No concept of paired exchange

## Goal
Transform the shuffle logic from random assignment to pair-swap: two segments exchange positions. Shuffle intensity increases progressively across layers (few swaps early, many swaps later).

## Scope
- Include:
  - Modify `handleShuffling` to perform pair-swaps instead of random assignment
  - Add progressive shuffle intensity (swap count increases with generation)
  - Ensure ConnectionLines reflect both directions of each swap
- Exclude:
  - No changes to collapse animation
  - No changes to camera behavior
  - No changes to rendering (LayerMesh shader)
  - No new UI controls (use existing config)

## Constraints
- Must maintain the existing phase state machine (frozen/shuffling/collapsing/holding)
- Must keep the "parapara" real-time swap animation during shuffling phase
- Pure logic in `LayerStack`, React integration in hook

## Success Criteria
- Segments swap in pairs (A↔B exchange positions)
- Early layers have few swaps, later layers have many
- Visual connection lines show both swap directions
- Existing collapse/hold/reset behavior unchanged
