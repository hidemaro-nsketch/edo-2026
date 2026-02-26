## Project Brief: flash-and-full-shuffle

### Current State
- Architecture: Layered shuffle state machine (`BuildSystem`) with `CompiledPlan`
- Relevant code:
  - `src/layered-shuffle/build-system.ts` — runtime state machine
  - `src/layered-shuffle/compiled-plan.ts` — plan compilation, swap pair generation
  - `src/layered-shuffle/types.ts` — data types and config
- Patterns: Phase-based state machine, per-pair staggered timelines
- Instant layers (1-6): flash → swipe → hold → commit (only for swap pairs)
- Non-instant layers (7-10): flight → hold → commit

### Goal
1. Add flash (bbox strobe) animation before flight on non-instant layers
2. Use full-segment shuffle (complete random permutation) on non-instant layers

### Scope
- Include:
  - `compiled-plan.ts`: Add full permutation generation for non-instant layers
  - `build-system.ts`: Add flash phase before flight for non-instant layers
  - `types.ts`: Add `animationStartLayer` to swap generation logic awareness
- Exclude:
  - Shader changes (flash rendering already works)
  - Camera/collapse changes
  - Instant layer behavior changes

### Constraints
- Must maintain compatibility with existing instant layer behavior
- Full permutation should decompose into swap pairs for data structure compatibility
- Flash → flight transition needs new code path (currently flash → hold)

### Success Criteria
- Non-instant layers show flash animation before flight
- Non-instant layers shuffle all segments (not just partial pairs)
- Instant layers behave exactly as before
- Animation loops correctly without glitches
