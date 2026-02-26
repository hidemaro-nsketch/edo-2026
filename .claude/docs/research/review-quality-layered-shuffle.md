# Quality Review: Layered Shuffle Feature

Date: 2026-02-26

## Summary

Overall code quality is **good**. The codebase demonstrates clean separation of concerns
(pure logic in `layer-stack.ts`, rendering in separate components), proper TypeScript types,
named constants, and early return patterns. Below are the specific findings.

---

## Findings

### HIGH Severity

#### H1: `useLayeredShuffle` hook is too long and has multiple responsibilities
- **File**: `src/routes/index.tsx`, lines 110-269
- **Issue**: The `useLayeredShuffle` hook is ~160 lines and handles reset logic, phase dispatching (holding/collapsing/frozen/shuffling), random slot selection, shuffle timing, AND render layer construction. This violates single responsibility.
- **Current code**: The entire `useLayeredShuffle` function spanning lines 110-269
- **Suggested improvement**: Extract phase-specific logic into separate functions:
  - `handleResetPhase(...)`
  - `handleHoldingPhase(...)`
  - `handleCollapsingPhase(...)`
  - `handleFrozenPhase(...)`
  - `handleShufflingPhase(...)`
  - Or better: move the frame-loop dispatch into `LayerStack` itself as a `tick(now, delta)` method.

#### H2: `LayerStack` mutates `LayerState` objects directly (immutability violation)
- **File**: `src/layered-shuffle/layer-stack.ts`, lines 191-197
- **Current code**:
  ```ts
  layer.opacity = 1 - progress;
  // ...
  layer.alive = false;
  layer.opacity = 0;
  ```
- **Issue**: `LayerState` objects stored in `this.layers` are mutated in place. The coding principles mandate creating new objects instead of mutating existing ones. This also causes subtle React rendering bugs since reference identity does not change.
- **Suggested improvement**: Replace mutated layers with new objects:
  ```ts
  this.layers[this.collapsingIndex] = { ...layer, opacity: 1 - progress };
  ```

#### H3: Duplicated `KIMONO_SIZE` constant across three files
- **File**: `src/routes/index.tsx` (line 22), `src/render/LayerMesh.tsx` (line 19), `src/render/ConnectionLines.tsx` (line 10)
- **Current code**: `const KIMONO_SIZE = 5.2;` in each file
- **Suggested improvement**: Define once in a shared constants file (e.g., `src/constants.ts`) and import everywhere.

---

### MEDIUM Severity

#### M1: `useFrame` callback in `useLayeredShuffle` has deep nesting
- **File**: `src/routes/index.tsx`, lines 136-237
- **Issue**: The `useFrame` callback is ~100 lines with multiple `if (phase === ...)` blocks, each containing further nested conditions. While each block uses early return, the overall function is too large for a single callback.
- **Suggested improvement**: Break into helper functions dispatched by phase (see H1).

#### M2: Magic numbers in shader code
- **File**: `src/render/LayerMesh.tsx`, lines 66-68
- **Current code**:
  ```glsl
  if (color.a < 0.1) discard;
  float edgeAlpha = smoothstep(0.1, 0.3, color.a);
  ```
- **Issue**: `0.1` and `0.3` are magic numbers for alpha threshold and smoothstep range.
- **Suggested improvement**: Define as `#define` constants or uniforms:
  ```glsl
  #define ALPHA_DISCARD_THRESHOLD 0.1
  #define EDGE_SMOOTH_MIN 0.1
  #define EDGE_SMOOTH_MAX 0.3
  ```

#### M3: Magic numbers in `CameraRig`
- **File**: `src/render/CameraRig.tsx`, lines 6-8
- **Current code**:
  ```ts
  const TOP_DOWN_POSITION = new Vector3(0, 0, 7);
  const OBLIQUE_POSITION = new Vector3(3, 2, 6);
  ```
- **Issue**: While named as constants, the vector components (3, 2, 6, 7) are magic numbers without explanation of why these specific values were chosen.
- **Suggested improvement**: Add brief comments explaining the rationale (e.g., `// 7 units back for ~5.2 unit kimono to fill viewport at fov 44`).

#### M4: `Scene` function is long with mixed concerns
- **File**: `src/routes/index.tsx`, lines 341-438
- **Issue**: `Scene` handles manifest loading, atlas texture loading, kimono texture loading, config memoization, and rendering. The `useEffect` alone is 50+ lines.
- **Suggested improvement**: Extract texture/manifest loading into a custom hook like `useSceneAssets()`.

#### M5: `getAllLinks` return type is verbose and duplicated
- **File**: `src/layered-shuffle/layer-stack.ts`, lines 249-262
- **Current code**: The same complex type literal is written twice (return type annotation and local variable).
- **Suggested improvement**: Define a named type:
  ```ts
  type LinkData = {
    fromPos: [number, number, number];
    toPos: [number, number, number];
    fromLayerGen: number;
    toLayerGen: number;
    slotIndex: number;
  };
  ```

#### M6: `getAllLinks` method appears unused
- **File**: `src/layered-shuffle/layer-stack.ts`, lines 248-285
- **Issue**: `getAllLinks()` returns placeholder `[0,0,0]` positions and is not called by any rendering code (`ConnectionLines` computes positions independently). Dead code should be removed.
- **Suggested improvement**: Remove `getAllLinks()` or integrate it with `ConnectionLines`.

---

### LOW Severity

#### L1: `shuffleVersion` state only used to trigger re-render
- **File**: `src/routes/index.tsx`, line 122
- **Current code**: `const [shuffleVersion, setShuffleVersion] = useState(0);`
- **Issue**: This counter exists solely to force re-renders. This is a known React pattern but `useReducer` with a simple increment is slightly more idiomatic for force-update patterns.
- **Suggested improvement**: Consider `const [, forceUpdate] = useReducer(x => x + 1, 0)` for clarity.

#### L2: `segmentOpacity` prop passed but not used
- **File**: `src/routes/index.tsx`, line 307
- **Issue**: `LayeredShuffleContent` accepts `segmentOpacity` in its props type (line 299) but the destructured parameters on line 302-307 don't include it, and it's never passed to child components.
- **Suggested improvement**: Either wire `segmentOpacity` to `LayerMesh` opacity or remove it from the props type.

#### L3: Module-level `lineMaterial` is a shared mutable singleton
- **File**: `src/render/ConnectionLines.tsx`, lines 14-19
- **Current code**:
  ```ts
  const lineMaterial = new LineBasicMaterial({
    color: LINE_COLOR,
    transparent: true,
    opacity: LINE_OPACITY,
    depthWrite: false,
  });
  ```
- **Issue**: Module-level Three.js material is shared across all instances. While fine for this use case, it cannot be disposed properly and won't work if different ConnectionLines need different materials.
- **Suggested improvement**: Acceptable for now, but add a comment noting it's intentionally shared.

#### L4: `buildLayerInstances` accesses array indices without bounds checking
- **File**: `src/render/LayerMesh.tsx`, line 107
- **Current code**: `const texSeg = segments[slotToSegId[i]];`
- **Issue**: If `slotToSegId[i]` is out of bounds, this silently produces `undefined`.
- **Suggested improvement**: Add a guard or assertion in development mode.

---

## Statistics

| Severity | Count |
|----------|-------|
| High     | 3     |
| Medium   | 6     |
| Low      | 4     |
| **Total**| **13**|

## Top Recommendations

1. **Extract `useLayeredShuffle` phase handlers** into separate functions or move tick logic into `LayerStack.tick()` (H1, M1)
2. **Fix immutability violation** in `LayerStack.updateCollapse` (H2)
3. **Deduplicate `KIMONO_SIZE`** into a shared constants module (H3)
4. **Remove or integrate `getAllLinks`** dead code (M6)
5. **Wire or remove `segmentOpacity`** prop (L2)
