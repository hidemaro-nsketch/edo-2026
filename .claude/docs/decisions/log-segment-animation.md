# Decision Log: Segment Animation & Object-Fit Contain

### [startproject] DECISION — 2026-02-26

- **担当者**: ユーザー + Claude Lead
- **概要**: セグメント移動アニメーションと object-fit contain を実装
- **理由**: シャッフル時に視覚的な移動表現を実現し、サイズ差のあるスロット間でもアスペクト比を維持したい
- **ステータス**: 承認済み

#### 確定した要件

1. **Object-fit contain**: segment A が segment B の bounding box に移動する場合、segment B のサイズに収まるようアスペクト比維持でスケーリング
2. **移動アニメーション**: shuffling phase の各スワップ発生時に、セグメントが前の位置から新しい位置に滑らかに移動（~0.3秒）
3. **線の連動アニメーション**: ConnectionLines がセグメント移動に追従して伸び、移動完了後は最終位置で固定
4. **タイミング**: 移動アニメーションは shuffling phase 中に発生し、freeze 後は静止

### [startproject] PRE — 2026-02-26

- **担当者**: Claude Lead
- **概要**: プロジェクト概要書を作成（segment-animation）
- **成果物**: `.claude/docs/decisions/brief-segment-animation.md`

### [startproject] POST — 2026-02-26

- **担当者**: Claude Lead
- **概要**: 計画フェーズ完了、5タスクに分割、Codex設計相談済み（CPU-side interpolation推奨）
- **成果物**: `.claude/docs/decisions/brief-segment-animation.md`, `.claude/docs/decisions/log-segment-animation.md`

### [startproject] DECISION — 2026-02-26 (設計変更)

- **担当者**: ユーザー + Claude Lead
- **概要**: セグメント移動モデルを根本的に変更
- **理由**: セグメントが3D空間をConnectionLineに沿って移動し、各レイヤーに定着するモデル
- **ステータス**: 承認済み

#### 確定した新モデル

1. **Layer 0 は全セグメントの原点**: 全セグメントが元の位置に常に存在（不変）
2. **セグメントの複製と移動**: スワップ時、セグメントのコピーが layer N-1 の位置から layer N の新位置へ 3D空間（XY + Z方向）を移動
3. **通過と定着**: 各セグメントは自分がスワップに関わるレイヤーで「定着」。それまでは元の位置を維持して各レイヤーを通過
4. **順次構築**: layer 0 → 1 → 2 → ... と順次構築。各レイヤー完成後に次へ
5. **最終レイヤー**: 一度もスワップに関わらなかったセグメントは最終レイヤーに元の位置のまま定着

### [team-implement] PRE — 2026-02-26

- **担当者**: Claude Lead
- **概要**: 実装フェーズ開始、M tier — Claude 直接実装
- **成果物**: 5タスク実装予定

---

## Feature: Layer別アニメーション制御 + 黒塗りエフェクト

### [startproject] DECISION — 2026-02-26

- **担当者**: ユーザー + Claude Lead
- **概要**: Layer 1-4 では飛行アニメーションを無効化し、swap結果を即座に反映する。swapは全レイヤーで発生。
- **理由**: 序盤のレイヤーではアニメーション不要、layer 5以降で動きを見せたい
- **ステータス**: 承認済み

### [startproject] DECISION — 2026-02-26

- **担当者**: ユーザー + Claude Lead
- **概要**: セグメントが移動した場合、移動元レイヤーの元slot位置に bboxInSource サイズの完全不透明黒矩形を描画する
- **理由**: 「セグメントが抜けた痕跡」を視覚的に表現するため
- **ステータス**: 承認済み

### [startproject] DECISION — 2026-02-26

- **担当者**: ユーザー + Claude Lead
- **概要**: 黒塗りは一度描画されたら以降のレイヤーでも持続する。collapse 時は逆再生で消える。Layer 1-4 でも即座に黒塗りが発生する。
- **理由**: 全レイヤーで一貫した累積的痕跡効果
- **ステータス**: 承認済み

### [startproject] PRE — 2026-02-26

- **担当者**: Claude Lead
- **概要**: プロジェクト概要書を作成（Layer別アニメーション制御 + 黒塗りエフェクト）
- **成果物**: `.claude/docs/decisions/brief-segment-animation.md`（更新）

### [startproject] POST — 2026-02-26

- **担当者**: Claude Lead
- **概要**: 計画フェーズ完了、5タスクに分割、Codex設計相談済み（instant commit + 別メッシュ黒塗り推奨）
- **成果物**: `.claude/docs/decisions/brief-segment-animation.md`, `.claude/docs/decisions/log-segment-animation.md`
- **Linear**: スキップ（ユーザー承認済み）
