# Simplify Review: Layered Shuffle Feature

Date: 2026-02-26

## Summary

Overall code quality is good. The layered-shuffle logic is well-separated from rendering.
6 findings identified, mostly Small effort / Low risk.

---

## Findings

### 1. Duplicated `KIMONO_SIZE` constant across 3 files

- **Files**: `src/routes/index.tsx:22`, `src/render/LayerMesh.tsx:19`, `src/render/ConnectionLines.tsx:10`
- **Current**: `const KIMONO_SIZE = 5.2;` defined independently in each file
- **Proposed**: Extract to a shared constants file (e.g. `src/constants.ts`) and import everywhere
- **Effort**: Small
- **Risk**: Low

### 2. Duplicated world-position calculation logic

- **Files**: `src/render/LayerMesh.tsx:94-99` (in `buildLayerInstances`) and `src/render/ConnectionLines.tsx:29-34` (`getSlotWorldPos`)
- **Current**: Both compute `(cx - 0.5) * KIMONO_SIZE` / `-(cy - 0.5) * KIMONO_SIZE` from bboxInSource
- **Proposed**: Reuse `getSlotWorldPos` from ConnectionLines (or move to shared util) inside `buildLayerInstances`
- **Effort**: Small
- **Risk**: Low

### 3. Long `useFrame` callback in `useLayeredShuffle` (~100 lines)

- **File**: `src/routes/index.tsx:136-237`
- **Current**: Single useFrame callback handles 4 phases (holding, collapsing, frozen, shuffling) with inline logic
- **Proposed**: Extract each phase handler into a named function (`handleHolding`, `handleCollapsing`, `handleFrozen`, `handleShuffling`) called from the useFrame callback. This improves readability without changing behavior.
- **Effort**: Medium
- **Risk**: Low (pure extraction, refs and state setters passed as params or via closure)

### 4. Duplicated reset logic (refs reset pattern)

- **File**: `src/routes/index.tsx:148-153` and `src/routes/index.tsx:166-170`
- **Current**: Two places reset the same set of refs (`genStartTimeRef`, `nextSwitchTimeRef`, `holdStartRef`) to -1
- **Proposed**: Extract a `resetTimingRefs()` helper function
- **Effort**: Small
- **Risk**: Low

### 5. `getAllLinks` in LayerStack has duplicated type annotation

- **File**: `src/layered-shuffle/layer-stack.ts:249-262`
- **Current**: The return type is fully spelled out in both the method signature and the local `links` variable declaration
- **Proposed**: Extract a named type alias (e.g. `LinkData`) and reference it in both places
- **Effort**: Small
- **Risk**: Low

### 6. `useDebugGui` manually spreads all properties

- **File**: `src/routes/index.tsx:80-94`
- **Current**: Each property from `opacity`, `generation`, `layers`, `collapse` objects is manually listed in the return
- **Proposed**: Use object spread: `return { ...opacity, ...generation, ...layers, ...collapse, resetTrigger }`
- **Effort**: Small
- **Risk**: Low

---

## Not Flagged (Acceptable)

- **LayerStack class methods**: All under 20 lines, well-named, single responsibility
- **CameraRig**: Clean, focused, good use of module-level constants to avoid allocation
- **ConnectionLines**: Concise, clear early returns
- **types.ts**: Well-documented, clean type definitions
- **Magic numbers**: `0.1`, `0.3` in shader are standard alpha thresholds (shader domain); `0.5` centering offset is self-explanatory in context

---

## Priority Recommendation

1. **Finding 1 + 2** (duplicated constant + position calc) -- address together, highest value
2. **Finding 3** (long useFrame) -- improves maintainability of the most complex function
3. **Finding 4, 5, 6** -- small cleanups, do when convenient
