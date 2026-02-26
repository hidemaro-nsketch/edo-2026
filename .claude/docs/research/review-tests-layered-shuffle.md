# Test Coverage Review: Layered Shuffle Feature

Date: 2026-02-26

## Current State

**No tests exist for any layered shuffle module.** Zero test files found in the project `src/` directory. The project has vitest configured (`vitest run` in package.json scripts, vitest + jsdom in devDependencies) but no vitest config file and no test files.

## Test Gap Analysis

### 1. `src/layered-shuffle/layer-stack.ts` (LayerStack class) -- Priority: HIGH

Pure logic class with zero external dependencies (no React, no Three.js). This is the most critical and most testable module.

#### Required Test Cases

**constructor**
- Creates instance with default config when no config provided
- Merges partial config with defaults
- Initial state: layers=[], currentGen=0, phase="frozen"

**initOriginalLayer**
- Creates identity mapping [0,1,2,...n-1] for n segments
- Sets gen=0, z=0, alive=true, opacity=1
- changedSlots all false, linksFromPrev empty
- Sets phase to "frozen"

**startGeneration**
- No-op when layers is empty (early return guard)
- Copies slotToSegId from last layer into pending
- Increments currentGen from last layer's gen
- Sets phase to "shuffling"

**applyShuffle**
- Returns false for out-of-bounds slotIdx (negative, >= segmentCount)
- Returns true when slot value differs from previous layer
- Returns false when slot value matches previous layer (revert detection)
- Revert removes slot from pendingChanges set
- Multiple shuffles to same slot: only latest value kept

**freezeGeneration**
- Creates new layer with correct gen, z (gen * layerSpacing), alive=true, opacity=1
- changedSlots correctly marks only changed slots
- linksFromPrev contains correct prevSegId/currSegId pairs
- Reverted slots NOT included in changedSlots or linksFromPrev
- Pushes layer to layers array
- Sets phase to "frozen"
- Clears pending state

**Full workflow: startGeneration -> applyShuffle(s) -> freezeGeneration**
- End-to-end: identity layer -> shuffle 2 slots -> freeze -> verify 2 layers with correct links
- Multiple generations: verify layer stack grows correctly

**isComplete**
- Returns false when currentGen < maxGenerations
- Returns true when currentGen >= maxGenerations
- Boundary: returns true when currentGen === maxGenerations

**startCollapse**
- Sets phase to "collapsing"
- collapsingIndex set to last layer index

**updateCollapse**
- Returns false immediately if phase !== "collapsing"
- Transitions to "holding" when collapsingIndex <= 0 (gen 0 survives)
- Fades layer opacity from 1 to 0 over collapseDuration
- Sets alive=false when opacity reaches 0
- Respects stagger delay between layer fades
- Processes layers top-down (highest gen first)
- Gen 0 layer remains alive and opacity=1 after full collapse

**reset**
- Clears all state to initial values
- layers=[], currentGen=0, phase="frozen"

**getAliveLayers**
- Returns only layers where alive=true
- Returns empty array when no layers exist

**getAllLinks**
- Returns empty for gen-0-only state
- Returns links only for alive layers
- Skips gen 0 (no linksFromPrev)
- Correct fromLayerGen/toLayerGen values

**getPendingSlotToSegId**
- Returns copy (not reference) of pending mapping
- Returns empty array when not in shuffling phase

### 2. `src/layered-shuffle/types.ts` (DEFAULT_CONFIG) -- Priority: LOW

- Verify DEFAULT_CONFIG has all required fields with expected default values
- Simple snapshot test is sufficient

### 3. `src/render/ConnectionLines.tsx` (getSlotWorldPos export) -- Priority: MEDIUM

The `getSlotWorldPos` function is exported and is pure math (no React/Three.js rendering needed).

#### Required Test Cases

- Computes correct world XY from segment bboxInSource and originalSize
- Center of image maps to (0, 0)
- Top-left corner maps to negative x, positive y (due to Y flip)
- KIMONO_SIZE scaling applied correctly

The `ConnectionLines` component itself requires Three.js/React testing setup (lower priority).

### 4. `src/render/LayerMesh.tsx` -- Priority: LOW

- `buildLayerInstances` is not exported but could be extracted and tested
- Heavy Three.js dependency makes component testing difficult
- Consider extracting pure math functions if testing becomes important

### 5. `src/render/CameraRig.tsx` -- Priority: LOW

- Camera interpolation logic is embedded in useFrame callback
- Could extract the smoothstep/lerp math into a testable utility
- Not critical for correctness since it's visual-only

### 6. `src/routes/index.tsx` (orchestration) -- Priority: LOW

- `useLayeredShuffle` hook contains complex timing logic
- Would require React Testing Library + mocked useFrame
- Integration-level testing; defer until unit tests are solid

## Summary

| Module | Priority | Test Count Estimate | Current Coverage |
|--------|----------|-------------------|-----------------|
| layer-stack.ts | **HIGH** | ~25-30 tests | 0% |
| types.ts (defaults) | LOW | 1-2 tests | 0% |
| ConnectionLines (getSlotWorldPos) | MEDIUM | 3-4 tests | 0% |
| LayerMesh.tsx | LOW | 0 (extract first) | 0% |
| CameraRig.tsx | LOW | 0 (extract first) | 0% |
| routes/index.tsx | LOW | 0 (integration) | 0% |

## Recommendations

1. **Immediate**: Create `src/layered-shuffle/layer-stack.test.ts` with comprehensive tests (~25-30 cases)
2. **Immediate**: Set up `vitest.config.ts` if not yet configured
3. **Soon**: Test `getSlotWorldPos` from ConnectionLines.tsx
4. **Later**: Extract pure math from render components (buildLayerInstances, camera smoothstep) into utility files for testability
5. **Later**: Integration tests for useLayeredShuffle hook

## Setup Needed

- Create `vitest.config.ts` (or verify vite config includes vitest settings)
- Ensure `tsconfig.json` includes test files
- No mocking needed for layer-stack.ts (pure logic)
