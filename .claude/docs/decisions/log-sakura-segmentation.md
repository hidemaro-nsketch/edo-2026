# Decision Log: sakura-segmentation

### [startproject] DECISION — 2026-02-18

- **担当者**: ユーザー + Claude Lead
- **概要**: データフォーマットは未決定。設計フェーズで最適な仕様を提案する
- **理由**: セグメンテーション処理が進行中で柔軟性を確保したい
- **ステータス**: 承認済み

### [startproject] DECISION — 2026-02-18

- **担当者**: ユーザー + Claude Lead
- **概要**: 桜画像10-30枚、各3-5セグメント程度の中規模データを想定
- **理由**: 映像作品として十分なバリエーションを確保しつつ管理可能な規模
- **ステータス**: 承認済み

### [startproject] DECISION — 2026-02-18

- **担当者**: ユーザー + Claude Lead
- **概要**: 1 Voronoiセル = 1セグメント（例：桜Aの花）の対応関係
- **理由**: セグメント単位で表示/非表示を制御し、カテゴリ別フィルタリングを実現する
- **ステータス**: 承認済み

### [startproject] DECISION — 2026-02-18

- **担当者**: ユーザー + Claude Lead
- **概要**: 出力はWebブラウザでのインタラクティブ表示（現状の形態を継続）
- **理由**: ブラウザ上でリアルタイムに操作・確認できる形態が制作ワークフローに適合
- **ステータス**: 承認済み

### [startproject] DECISION — 2026-02-18

- **担当者**: ユーザー + Claude Lead
- **概要**: 現在のVoronoiセルの移動アニメーション = 桜A→桜Bへの切り替わり表現として活用
- **理由**: 既存のsweepアニメーションを活かしつつ、テクスチャ差し替えで桜間の遷移を表現
- **ステータス**: 承認済み

### [startproject] DECISION — 2026-02-18

- **担当者**: ユーザー + Claude Lead
- **概要**: Linear連携は今回不要
- **理由**: ユーザーの明示的な指示
- **ステータス**: 承認済み

### [startproject] PRE — 2026-02-18

- **担当者**: Claude Lead
- **概要**: プロジェクト概要書を作成（sakura-segmentation）
- **成果物**: `.claude/docs/decisions/brief-sakura-segmentation.md`

### [startproject] DECISION — 2026-02-18

- **担当者**: Codex (Architect)
- **概要**: テクスチャ戦略としてページドアトラス（sampler2DArray）を採用。データテクスチャ経由でセル-セグメントマッピングを実装。ビットマスクによるカテゴリフィルタリング。
- **理由**: 50-150セグメントを個別テクスチャで扱うとWebGLテクスチャユニット制限に抵触。アトラス+データテクスチャがGPUメモリ効率とシェーダー柔軟性の最適バランス。
- **ステータス**: 承認済み

### [startproject] POST — 2026-02-18

- **担当者**: Claude Lead
- **概要**: 計画フェーズ完了、8タスクに分割（Linear連携はユーザー指示によりスキップ）
- **成果物**: `.claude/docs/DESIGN.md`, `.claude/docs/research/sakura-segmentation-architecture.md`

### [team-implement] PRE — 2026-02-18

- **担当者**: Claude Lead
- **概要**: 実装フェーズ開始。単一ファイル中心のためClaude直接実装を採用（Agent Teamsはファイル競合リスクのためスキップ）
- **成果物**: `.claude/docs/DESIGN.md`（startproject で更新済み）

### [team-implement] DECISION — 2026-02-18

- **担当者**: Claude Lead
- **概要**: Linear連携はユーザー指示によりスキップ
- **理由**: /startproject 時にユーザーが「linear連携は不要」と明示
- **ステータス**: 承認済み

### [team-implement] POST — 2026-02-18

- **担当者**: Claude Lead
- **概要**: 実装完了、6/7タスク完了（アトラスパッカーは実画像待ちで保留）、ビルド全通過
- **成果物**: `.claude/docs/decisions/implementation-sakura-segmentation.md`

### [startproject] DECISION — 2026-02-18

- **担当者**: ユーザー + Claude Lead
- **概要**: Voronoiセル分割を廃止し、セグメント画像を元の形（アルファ境界）のまま表示する方式に変更
- **理由**: 桜の切り抜き形状をそのまま活かしたい。Voronoiの矩形クリッピングは不要
- **ステータス**: 承認済み

### [startproject] DECISION — 2026-02-18

- **担当者**: ユーザー + Claude Lead
- **概要**: 現在のsweepアニメーション（出現・消失・移動）は新方式でも維持する
- **理由**: Voronoiは廃止するが、動きの表現は作品の重要な要素として残す
- **ステータス**: 承認済み

### [startproject] DECISION — 2026-02-18

- **担当者**: Codex (Architect)
- **概要**: InstancedMesh per layer + カスタムシェーダー方式を採用。レイヤーあたり1 draw call（計5回）で150インスタンスを描画。
- **理由**: 750クワッドを個別Meshで描くとdraw call過多、全画面シェーダーループはfragment-bound、Point spritesはサイズ・回転制限あり。InstancedMeshが性能・柔軟性・品質の最適バランス。
- **ステータス**: 承認済み

### [startproject] DECISION — 2026-02-18

- **担当者**: ユーザー + Claude Lead
- **概要**: Linear連携は今回スキップ
- **理由**: ユーザーの明示的な指示
- **ステータス**: 承認済み

### [startproject] PRE — 2026-02-18

- **担当者**: Claude Lead
- **概要**: プロジェクト概要書を作成（sakura-sprite-rendering）
- **成果物**: `.claude/docs/decisions/brief-sakura-sprite-rendering.md`

### [startproject] POST — 2026-02-18

- **担当者**: Claude Lead
- **概要**: 計画フェーズ完了、4タスクに分割（Linear連携はユーザー指示によりスキップ）
- **成果物**: `.claude/docs/decisions/brief-sakura-sprite-rendering.md`
