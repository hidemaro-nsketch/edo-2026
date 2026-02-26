# Decision Log: instant-swipe

## Instant Layer Swipe Transition Animation

---

### [startproject] DECISION — 2026-02-27

- **担当者**: ユーザー + Claude Lead
- **概要**: instant レイヤーにスワイプ遷移アニメーションを追加
- **理由**: instant レイヤーでもセグメントの入れ替わりを視覚的に表現したい
- **ステータス**: 承認済み

### [startproject] DECISION — 2026-02-27

- **担当者**: ユーザー + Claude Lead
- **概要**: スワイプ方向は横方向（左→右）
- **理由**: シンプルで視覚的に分かりやすい
- **ステータス**: 承認済み

### [startproject] DECISION — 2026-02-27

- **担当者**: ユーザー + Claude Lead
- **概要**: スワイプ対象は swap pair のセグメントのみ（pass-through は対象外）
- **理由**: スワップに参加するセグメントの変化を示すのが目的
- **ステータス**: 承認済み

### [startproject] DECISION — 2026-02-27

- **担当者**: ユーザー + Claude Lead
- **概要**: スワイプアニメーション時間は既存の flightDuration を共用
- **理由**: 設定の簡素化、既存パラメータの再利用
- **ステータス**: 承認済み

### [startproject] DECISION — 2026-02-27

- **担当者**: ユーザー + Claude Lead
- **概要**: 複数の instant レイヤーは1つずつ順にスワイプアニメ→commit を繰り返す
- **理由**: 各レイヤーの変化を個別に視認できるようにする
- **ステータス**: 承認済み

### [startproject] PRE — 2026-02-27

- **担当者**: Claude Lead
- **概要**: プロジェクト概要書を作成（instant-swipe）
- **成果物**: `.claude/docs/decisions/brief-instant-swipe.md`
