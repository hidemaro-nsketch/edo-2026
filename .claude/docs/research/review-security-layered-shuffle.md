# Security Review: Layered Shuffle Feature

**Date**: 2026-02-26
**Reviewer**: Claude Opus 4.6 (Security Reviewer)
**Status**: PASS (No critical/high issues found)

## Files Reviewed

- `src/routes/index.tsx`
- `src/layered-shuffle/types.ts`
- `src/layered-shuffle/layer-stack.ts`
- `src/render/LayerMesh.tsx`
- `src/render/ConnectionLines.tsx`
- `src/render/CameraRig.tsx`

## Summary

This is a purely client-side WebGL rendering feature with no user input, no API calls to external services, no authentication, and no sensitive data handling. The attack surface is minimal.

## Findings

### 1. Unvalidated JSON Response from Manifest Fetch

- **Severity**: Low
- **File**: `src/routes/index.tsx`, line 31
- **Description**: The manifest JSON response is cast with `as SegmentManifest` without runtime validation. If the manifest file were tampered with (e.g., via a compromised CDN or MITM on non-HTTPS), malformed data could cause unexpected behavior.
- **Code**: `return (await res.json()) as SegmentManifest;`
- **Risk**: Minimal in practice -- the manifest is a static file served from the same origin (`/sakura/segments.manifest.json`). TypeScript `as` cast provides no runtime safety.
- **Recommended Fix**: Consider adding a lightweight runtime schema check (e.g., zod) if the manifest source becomes dynamic or user-supplied. For static same-origin assets, current approach is acceptable.

### 2. Potential Array Out-of-Bounds Access

- **Severity**: Low
- **File**: `src/render/LayerMesh.tsx`, line 107
- **Description**: `segments[slotToSegId[i]]` accesses `segments` using an index from `slotToSegId`. If `slotToSegId` contains an out-of-range value (due to a bug or corrupted state), this would cause `undefined` access and potential runtime error.
- **Code**: `const texSeg = segments[slotToSegId[i]];`
- **Risk**: Low -- the indices are generated internally by `LayerStack` which bounds-checks in `applyShuffle` (line 89). However, no bounds check exists on the rendering side.
- **Recommended Fix**: Add a bounds check: `const segId = slotToSegId[i]; if (segId < 0 || segId >= segments.length) continue;`

### 3. Potential Array Out-of-Bounds in ConnectionLines

- **Severity**: Low
- **File**: `src/render/ConnectionLines.tsx`, line 64
- **Description**: `getSlotWorldPos(segments, link.slotIndex)` does not validate that `link.slotIndex` is within bounds of `segments`.
- **Risk**: Same as above -- internally generated data, but no defensive check.
- **Recommended Fix**: Add bounds guard in `getSlotWorldPos`.

### 4. Console Logging of Asset Load Status

- **Severity**: Low (Informational)
- **File**: `src/routes/index.tsx`, lines 368, 386
- **Description**: `console.warn` on load failures and `console.log` on success expose internal asset paths and segment counts. No sensitive data is leaked, but this is information disclosure in production.
- **Recommended Fix**: Consider using a conditional logger that is silent in production builds, or remove console statements for production.

### 5. Nitro Nightly Dependency

- **Severity**: Low
- **File**: `package.json`, line 26
- **Description**: `"nitro": "npm:nitro-nightly@latest"` uses a nightly build pinned to `latest`. Nightly builds may contain regressions, breaking changes, or (in worst case) supply chain issues.
- **Recommended Fix**: Pin to a specific nightly version or switch to stable release when available.

### 6. Broad Version Ranges in Dependencies

- **Severity**: Low
- **File**: `package.json`, lines 14-47
- **Description**: All dependencies use caret (`^`) ranges. While standard for JS projects, this allows automatic minor/patch upgrades that could introduce vulnerabilities.
- **Risk**: Mitigated by lockfile (`package-lock.json` or equivalent).
- **Recommended Fix**: Ensure lockfile is committed. Consider using exact versions for production-critical dependencies.

## Not Applicable

The following security concerns from `.claude/rules/security.md` are **not applicable** to this feature:

- **Hardcoded secrets/credentials**: None found. No API keys, passwords, or tokens.
- **XSS**: No user input is rendered as HTML. All rendering is via WebGL/Three.js shaders.
- **Command injection**: No server-side execution, no shell commands.
- **SQL injection**: No database queries.
- **Sensitive data in logs**: No PII or secrets logged.
- **Unsafe DOM manipulation**: No `dangerouslySetInnerHTML` or direct DOM access. All rendering via React/Three.js.

## Conclusion

The layered shuffle feature has a very small attack surface. All findings are **Low** severity and relate to defensive programming practices rather than exploitable vulnerabilities. No critical or high-severity issues were found.
