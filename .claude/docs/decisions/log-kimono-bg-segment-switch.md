# Decision Log: kimono-bg-segment-switch

## Feature: 着物背景表示 + 桜セグメントin-place切り替え

---

### [startproject] DECISION — 2026-02-24

- **担当者**: ユーザー + Claude Lead
- **概要**: 元の着物画像を背景として表示し、その上で桜セグメントを元の位置に固定表示する
- **理由**: 着物のコンテキストの中で桜モチーフの切り替えを見せたい
- **ステータス**: 承認済み

### [startproject] DECISION — 2026-02-24

- **担当者**: ユーザー + Claude Lead
- **概要**: 桜セグメントはランダムに1個ずつ別のセグメントテクスチャに切り替わる（形が変わる）
- **理由**: 一斉切り替えではなく、自然な変化を演出する
- **ステータス**: 承認済み

### [startproject] DECISION — 2026-02-24

- **担当者**: ユーザー + Claude Lead
- **概要**: レイヤー構造を5層からシンプルに変更（着物背景 + 桜セグメント1層）
- **理由**: 新しい表現では多層パララックスは不要
- **ステータス**: 承認済み

### [startproject] DECISION — 2026-02-24

- **担当者**: ユーザー + Claude Lead
- **概要**: OrbitControls（回転・ズーム）は維持する
- **理由**: ユーザーが着物を自由に眺められるようにする
- **ステータス**: 承認済み

### [startproject] DECISION — 2026-02-24

- **担当者**: ユーザー + Claude Lead
- **概要**: 現状のスイープアニメーション（波状移動表現）は完全に削除する
- **理由**: 新しいin-place切り替え表現に置き換え
- **ステータス**: 承認済み

### [startproject] DECISION — 2026-02-24

- **担当者**: ユーザー + Claude Lead
- **概要**: 切り替えのタイミングと表現（クロスフェード等）は調整可能にする
- **理由**: 演出の微調整を容易にするため
- **ステータス**: 承認済み

### [startproject] DECISION — 2026-02-24

- **担当者**: ユーザー + Claude Lead
- **概要**: 背景着物画像はユーザーが別途用意する。必要なスペックをドキュメントに記載する
- **理由**: 画像の品質をユーザーがコントロールしたい
- **ステータス**: 承認済み

### [startproject] PRE — 2026-02-24

- **担当者**: Claude Lead
- **概要**: プロジェクト概要書を作成（kimono-bg-segment-switch）
- **成果物**: `.claude/docs/decisions/brief-kimono-bg-segment-switch.md`, `.claude/docs/kimono-background-image-spec.md`

### [startproject] POST — 2026-02-24

- **担当者**: Claude Lead
- **概要**: 計画フェーズ完了、6タスクに分割、Linear スキップ（ユーザー指示）
- **成果物**: `.claude/docs/decisions/brief-kimono-bg-segment-switch.md`, `.claude/docs/kimono-background-image-spec.md`
