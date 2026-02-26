# Decision Log: Shuffle Pair-Swap Refactor

### [startproject] DECISION — 2026-02-26

- **担当者**: ユーザー + Claude Lead
- **概要**: シャッフルロジックをペアスワップ方式に変更
- **理由**: セグメントが実際に位置を交換する表現を実現したい
- **ステータス**: 承認済み

#### 確定した要件

1. **ペアスワップ方式**: segmentA と segmentB が位置を交換（A→Bpos, B→Apos）
2. **段階的シャッフル量**: 初期レイヤーは少ないスワップ、後半レイヤーほどスワップ量が増加
   - Layer 1: 1-2ペア → Layer 10: 15-16ペア（ほぼ全体シャッフル）
3. **パラパラアニメーション維持**: shuffling phase でリアルタイムにスワップ発生を維持
4. **ConnectionLines**: スワップの両方向（A→Bpos, B→Apos）を表示

### [startproject] PRE — 2026-02-26

- **担当者**: Claude Lead
- **概要**: プロジェクト概要書を作成（shuffle-pairswap）
- **成果物**: `.claude/docs/decisions/brief-shuffle-pairswap.md`

### [startproject] POST — 2026-02-26

- **担当者**: Claude Lead
- **概要**: 計画フェーズ完了、4タスクに分割、Codex設計相談済み
- **成果物**: `.claude/docs/decisions/brief-shuffle-pairswap.md`, `.claude/docs/decisions/log-shuffle-pairswap.md`

### [team-implement] PRE — 2026-02-26

- **担当者**: Claude Lead
- **概要**: 実装フェーズ開始、設計決定を記録（M tier — Claude 直接実装）
- **成果物**: `.claude/docs/DESIGN.md`（更新予定）
