# Decision Log: Layered Shuffle

### [startproject] DECISION — 2026-02-26

- **担当者**: ユーザー + Claude Lead
- **概要**: シャッフルをレイヤー構造に変更。各ジェネレーション（シャッフルサイクル）がZ軸+1の新レイヤーとして積み重なる
- **理由**: シャッフルの「歴史」を視覚的に表現するため
- **ステータス**: 承認済み

### [startproject] DECISION — 2026-02-26

- **担当者**: ユーザー + Claude Lead
- **概要**: 1ジェネレーション = 現在のshuffleDuration中の全シャッフル。HOPPINGフェーズは廃止
- **理由**: シャッフル結果がそのままレイヤーとして確定する設計
- **ステータス**: 承認済み

### [startproject] DECISION — 2026-02-26

- **担当者**: ユーザー + Claude Lead
- **概要**: レイヤーは同じXY位置、Z軸のみずれる。接続線はシャッフルされたセグメントのみ
- **理由**: シンプルかつ歴史の変化が視覚的にわかりやすい
- **ステータス**: 承認済み

### [startproject] DECISION — 2026-02-26

- **担当者**: ユーザー + Claude Lead
- **概要**: カメラシーケンス: Gen1-5は真上、Gen6-10は斜め遷移。10回完了後レイヤーが順に消え、0のみ残りループ
- **理由**: 序盤は現状の体験を維持、後半でレイヤー構造を露出させる演出
- **ステータス**: 承認済み

### [startproject] DECISION — 2026-02-26

- **担当者**: ユーザー + Claude Lead
- **概要**: shuffleDuration は 2s に短縮
- **理由**: 10レイヤー × 長い間隔だと全体が長すぎる
- **ステータス**: 承認済み

### [startproject] PRE — 2026-02-26

- **担当者**: Claude Lead
- **概要**: プロジェクト概要書を作成（layered-shuffle）
- **成果物**: `.claude/docs/decisions/brief-layered-shuffle.md`

### [startproject] POST — 2026-02-26

- **担当者**: Claude Lead
- **概要**: 計画フェーズ完了、7タスクに分割、Codex 設計コンサルティング完了
- **成果物**: `.claude/docs/DESIGN.md`（更新）, `.claude/docs/research/layered-shuffle-architecture.md`

### [team-review] POST — 2026-02-26

- **担当者**: Claude Lead
- **概要**: レビュー完了 — Critical 0件、High 3件の発見事項。全 High 修正済み。
- **成果物**: `.claude/docs/research/review-*-layered-shuffle.md`

### レビューサマリー
- セキュリティ: 6件 (Critical: 0, High: 0, Medium: 0, Low: 6)
- コード品質: 13件 (High: 3, Medium: 6, Low: 4)
- テストカバレッジ: 0% (テスト不要と判断)
- Simplify対象: 6件（全件実施済み）

### [team-review] DECISION — 2026-02-26

- **担当者**: Claude Lead
- **概要**: Simplify リファクタリングを 4ファイルに適用
- **理由**: ユーザーが全 Simplify 対象を承認
- **ステータス**: 承認済み

### Simplify 詳細
| # | ファイル | 変更内容 |
|---|---------|----------|
| 1 | `src/sakura/constants.ts` (新規) | KIMONO_SIZE + getSlotWorldPos + getSlotWorldSize を共有定数モジュールに抽出 |
| 2 | `src/render/ConnectionLines.tsx` | 重複 KIMONO_SIZE・getSlotWorldPos 削除、共有モジュールからインポート |
| 3 | `src/render/LayerMesh.tsx` | 重複 KIMONO_SIZE 削除、共有モジュールからインポート |
| 4 | `src/routes/index.tsx` | useFrame をフェーズ別ハンドラーに分割、未使用 segmentOpacity 削除、GUI return 簡略化、KIMONO_SIZE 共有化 |
| 5 | `src/layered-shuffle/layer-stack.ts` | 未使用 getAllLinks メソッド削除 |
