---
feature: per-category-layers
linear_id: null
status: implemented
tier: S
branch: feature/per-category-layers
created: 2026-03-30
---

# Per-Category Layer Configuration

## Brief

カテゴリごとにlayer数(maxLayer)とbase/othersの切り替えポイント(contentStartLayer)を個別指定できるようにする。

## Implementation Plan

OpenCode CLIレビュー済み。以下の改善提案を反映した計画。

### Task 1: types.ts — Config型・デフォルト更新
- `categoryMaxLayer: Record<string, number>` 追加（未指定カテゴリは `maxGenerations` にフォールバック）
- `categoryContentStartLayer: Record<string, number>` 追加（未指定は `contentStartLayer` にフォールバック）
- `getEffectiveMaxLayer(config)` ヘルパー関数を追加（1箇所で定義、全系統で利用）
- `DEFAULT_CONFIG` 更新（空オブジェクト `{}` をデフォルトに）

### Task 2: compiled-plan.ts — swap生成のカテゴリ対応
- `generateSwapPairs()` でカテゴリごとの `maxLayer` 超過時にスキップ
- ループ上限を `getEffectiveMaxLayer(config)` で導出
- `CompiledPlan` に `maxLayer: number` フィールドを追加（runtime が config に依存しないように）

### Task 3: render-snapshot.ts — atlas判定のカテゴリ対応
- `shouldUseOthersAtlas(segId, layer, segments, config)` を新設
- settled / swipe / black fill / final display の全5経路で統一利用
- `segments[segId].categoryName` 直接参照（線形探索回避）

### Task 4: build-system.ts — レイヤー進行の更新
- `commitLayer()` の終了条件を `plan.maxLayer` 参照に変更
- `maxGenerations` 直接参照箇所を `plan.maxLayer` or `getEffectiveMaxLayer` に置換

### Task 5: SegmentMeshes.tsx / CameraRig.tsx — メッシュ・カメラ対応
- メッシュプール数を `getEffectiveMaxLayer` ベースに
- カメラ深度計算を `getEffectiveMaxLayer` ベースに

### Task 6: routes/index.tsx — GUI・ステータス更新
- `statusRef.maxLayers` を `getEffectiveMaxLayer` に
- カテゴリごとの `maxLayer` / `contentStartLayer` スライダー追加
- `usingOthers` の単一boolean前提を見直し

### Task 7: debug-layers.tsx — デバッグ表示対応
- レイヤーループを `getEffectiveMaxLayer` ベースに

## Design Decisions

- `maxGenerations` はフォールバックデフォルトとして残す
- 実ループ上限 = `Math.max(maxGenerations, ...Object.values(categoryMaxLayer))`
- `categoryContentStartLayer > categoryMaxLayer` → "never others"（仕様として明示）
- `CompiledPlan.maxLayer` で runtime が config を参照せずに済むようにする

## Implementation Summary

### Completed Tasks
- Task 1: types.ts — `categoryMaxLayer`, `categoryContentStartLayer` added to ShuffleConfig; `getEffectiveMaxLayer()` helper; `maxLayer` added to CompiledPlan; DEFAULT_CONFIG updated
- Task 2: compiled-plan.ts — `generateSwapPairs()` skips categories exceeding their maxLayer; loop bound uses `getEffectiveMaxLayer`; plan includes `maxLayer` field
- Task 3: render-snapshot.ts — `shouldUseOthersAtlas()` per-segment/per-category atlas selection; all 5 render paths updated (settled, swipe, flash, black fill, final display, collapse)
- Task 4: build-system.ts — `commitLayer()` uses `plan.maxLayer`; all `config.maxGenerations` direct refs replaced with `plan.maxLayer`; `buildBlackFillRenderInstancesForLayer` calls pass segments
- Task 5: SegmentMeshes.tsx — `layerCount` uses `getEffectiveMaxLayer`; CameraRig receives effective max layer from caller
- Task 6: routes/index.tsx — `statusRef.maxLayers` uses `getEffectiveMaxLayer`; config construction includes new fields; `usingOthers` status uses per-category check
- Task 7: debug-layers.tsx — loop uses `getEffectiveMaxLayer`; atlas selection uses `shouldUseOthersAtlas` per-segment

### Quality Check
- TypeScript compilation: PASS (no new errors in modified files)
- All 7 files modified as planned

### Changed Files
- src/layered-shuffle/types.ts
- src/layered-shuffle/compiled-plan.ts
- src/layered-shuffle/render-snapshot.ts
- src/layered-shuffle/build-system.ts
- src/render/SegmentMeshes.tsx
- src/routes/index.tsx
- src/routes/debug-layers.tsx

## Fix Tasks

- [x] M1: src/routes/index.tsx — useMemo 依存配列に gui.categoryMaxLayer, gui.categoryContentStartLayer を追加
- [x] M2: src/layered-shuffle/render-snapshot.ts — getAtlasSelectionForLayer デッドコード削除

## Decision Log

[startproject] PRE — 2026-03-30
担当: Claude Lead
概要: カテゴリごとのlayer数・contentStartLayer個別指定
成果物: 本タスクファイル

[opencode] DECISION — 2026-03-30
担当: OpenCode CLI
概要: 設計レビュー — maxGenerations影響範囲の拡大、atlas判定の全経路対応を指摘
理由: 計画の変更ファイルだけでは不足（SegmentMeshes, CameraRig, debug-layers も要更新）
ステータス: 反映済み

[team-implement] PRE — 2026-03-30
担当: Claude Lead
概要: 全7タスクの実装開始
成果物: 本セクション

[team-implement] POST — 2026-03-30
担当: Claude Lead
概要: 全タスク完了。TypeScript compilation PASS
成果物: Implementation Summary セクション

[team-review] POST — 2026-03-30
担当: Claude Lead (S tier single-pass)
概要: レビュー完了。Critical/High なし。Medium 2件: (1) useMemo 依存配列に categoryMaxLayer/categoryContentStartLayer 未追加, (2) getAtlasSelectionForLayer デッドコード残存。Low 1件: shouldUseOthersAtlas 返り値型の意味的不一致（変更不要）
成果物: 本エントリ
