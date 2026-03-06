### [startproject] DECISION — 2026-02-27

- **担当者**: ユーザー + Claude Lead
- **概要**: Non-instant layer (7-10) でも flash アニメーションを追加する
- **理由**: swap が起こるセグメントを視覚的にハイライトしてから flight に入りたい
- **ステータス**: 承認済み

### [startproject] DECISION — 2026-02-27

- **担当者**: ユーザー + Claude Lead
- **概要**: Non-instant layer (7-10) では全セグメントをシャッフル（完全ランダム置換）する
- **理由**: Instant layer は部分的 swap で段階的に変化を見せ、non-instant layer は劇的に全体が入れ替わる演出にしたい
- **ステータス**: 承認済み

### [startproject] PRE — 2026-02-27

- **担当者**: Claude Lead
- **概要**: プロジェクト概要書を作成（flash-and-full-shuffle）
- **成果物**: `.claude/docs/decisions/brief-flash-and-full-shuffle.md`

### [team-review] POST — 2026-02-27

- **担当者**: Claude Lead
- **概要**: レビュー完了 — Critical 0件、High 0件、Medium 2件
- **方式**: S tier — Claude Lead 直接レビュー

### レビューサマリー
- セキュリティ: 0件（該当なし）
- コード品質: 2件 (Medium: 2)
  - `getConnectionLines` の preCollapse フォールスルーの明示性
  - `commitLayer` の settled 重複インスタンスの可能性
- テストカバレッジ: N/A（フロントエンドアニメーション、ユニットテストなし）
- Simplify対象: 0件

### [deploy] POST — 2026-02-27

- **担当者**: Claude Lead
- **概要**: main ブランチに直接 push
- **成果物**: コミット `da2da38` on origin/main

### デプロイ詳細
- ブランチ: `main` → origin
- コミット: `da2da38`
- Linear: ユーザー指示によりスキップ
