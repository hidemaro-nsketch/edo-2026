### [startproject] DECISION — 2026-02-26

- **担当者**: ユーザー + Claude Lead
- **概要**: レイヤー0-10のセグメントにレイヤーごとのrenderOrderを設定する
- **理由**: depthWrite: falseのため、Z-depthによる透明オブジェクトのソートが機能しない。上位レイヤーが下位レイヤーの上に正しく描画されるようrenderOrderで制御する必要がある
- **ステータス**: 承認済み

### [startproject] DECISION — 2026-02-26

- **担当者**: Codex (設計相談)
- **概要**: レイヤーごとにインスタンスメッシュを分割し、renderOrder = layer * 10 + statePriority で制御する
- **理由**: renderOrderはオブジェクト単位であり、同一メッシュ内のインスタンスに異なるrenderOrderを設定できないため、メッシュ分割が必要
- **ステータス**: 承認済み

### [startproject] PRE — 2026-02-26

- **担当者**: Claude Lead
- **概要**: プロジェクト概要書を作成（segment-render-order）
- **成果物**: `.claude/docs/decisions/brief-segment-render-order.md`

### [startproject] POST — 2026-02-26

- **担当者**: Claude Lead
- **概要**: 計画フェーズ完了、3タスクに分割（BuildSystem API追加、SegmentMeshes再構築、ConnectionLines調整）
- **成果物**: `.claude/docs/decisions/brief-segment-render-order.md`, `.claude/docs/decisions/log-segment-render-order.md`

### [team-review] POST — 2026-02-26

- **担当者**: Claude Lead
- **概要**: レビュー完了（Security + Quality） — Critical 0件、High 3件、Medium 4件
- **修正済み**:
  - H1: `getSettledByLayer()` に dirty flag キャッシュ導入（毎フレーム Map 生成を回避）
  - M1: renderOrder 計算をマジックナンバーから定数 + `layerRenderOrder()` 関数に抽出
  - M2: ConnectionLines の renderOrder を名前付き定数に
  - M3: `MAX_LAYERS` ハードコードを `buildSystem.config.maxGenerations` から動的取得に変更
  - S4: Three.js リソースの dispose クリーンアップを追加
