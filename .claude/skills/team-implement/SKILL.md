---
name: team-implement
description: |
  Parallel implementation using Agent Teams. Spawns teammates per module/layer,
  each owning separate files to avoid conflicts. Uses shared task list with
  dependencies for autonomous coordination. Run after /startproject plan approval.
metadata:
  short-description: Parallel implementation with Agent Teams
---

# Team Implement

**Agent Teams による並列実装。`/startproject` で承認された計画に基づいて実行する。**

## Prerequisites

- `/startproject` が完了し、計画がユーザーに承認されていること
- `.claude/docs/DESIGN.md` にアーキテクチャが記録されていること
- タスクリストが作成されていること
- `/startproject` Phase 1 で取得した **Linear タスクID** が引き継がれていること

## Adaptive Execution

> 参照: `.claude/rules/adaptive-execution.md`

タスクサイズに応じてワークフローを適応させる：

| Tier | 実装方式 | チーム構成 |
|------|---------|-----------|
| **XS** | Claude 直接実装 | チームなし |
| **S** | Claude 直接実装 | チームなし |
| **M** | Claude 直接 or 1-2 Teammate | 小規模チーム（任意） |
| **L** | フル Agent Teams | モジュール別 Teammate + Tester |

**XS/S の場合**: Step 0（設計記録 + Linear投稿）→ Step 1（ブランチ作成 + ログ記録）→ Claude が直接実装 → Step 5（検証 + サマリー保存 + Linear投稿）。Step 2-4 をスキップ。
**M の場合**: Step 0（設計記録 + Linear投稿）→ Step 1 → Step 2 で判断（Claude 直接 or 小チーム）→ Step 5（検証 + サマリー保存 + Linear投稿）。
**L の場合**: フルワークフロー（Step 0-5 すべて実行。各ステップの記録・投稿を含む）。

### 記録ステップの適用範囲（MUST）

**以下の記録・投稿は全 tier で必須。スキップ不可。**

| 記録アクション | 発生箇所 | XS | S | M | L |
|---------------|---------|:--:|:--:|:--:|:--:|
| DESIGN.md 記録（design-tracker） | Step 0 | MUST | MUST | MUST | MUST |
| Linear に設計記録コメント | Step 0 | MUST | MUST | MUST | MUST |
| `log-{feature}.md` PRE エントリ | Step 0 | MUST | MUST | MUST | MUST |
| ブランチ情報をログに記録 | Step 1 | — | MUST | MUST | MUST |
| 介入判断をログに記録 | Step 4 | — | — | 該当時 | 該当時 |
| `implementation-{feature}.md` 保存 | Step 5 | MUST | MUST | MUST | MUST |
| `log-{feature}.md` POST エントリ | Step 5 | MUST | MUST | MUST | MUST |
| Linear に実装完了コメント | Step 5 | MUST | MUST | MUST | MUST |

> **Linear タスクIDが無い場合**: ユーザーに確認する。「Linear タスクIDが見つかりません。Linear への投稿をスキップしますか？それともタスクIDを指定しますか？」と質問し、指示に従う。**暗黙的なスキップは禁止。**

## Workflow (Full — Tier L)

```
Step 0: Record Design Decisions
  0-1. /design-tracker で設計決定を DESIGN.md に記録
  0-2. [MUST] Linear に設計記録コメントを投稿
  0-3. [MUST] log-{feature}.md に PRE エントリ追記
    ↓
Step 1: Create Feature Branch
  1-1. feature/{name} ブランチを作成
  1-2. [MUST] ブランチ情報を log-{feature}.md に記録
    ↓
Step 2: Analyze Plan & Design Team (M/L only)
  計画からタスク依存関係を分析し、チーム構成を決定
    ↓
Step 3: Spawn Agent Team (L only)
  モジュール/レイヤー単位でTeammateを起動
    ↓
Step 4: Monitor & Coordinate (L only)
  4-1. Lead がモニタリング、統合、品質管理
  4-2. [MUST] 介入判断があれば log-{feature}.md に記録
    ↓
Step 5: Integration & Verification
  5-1. 全タスク完了後、統合テスト実行
  5-2. [MUST] implementation-{feature}.md にサマリー保存
  5-3. [MUST] log-{feature}.md に POST エントリ追記
  5-4. [MUST] Linear に実装完了コメントを投稿
```

---

## Step 0: Record Design Decisions

**実装開始前に `/design-tracker` を実行し、設計決定を DESIGN.md に記録・確認する。**

これにより、`/startproject` で決定された設計方針が永続化され、実装中・実装後に意思決定の根拠を追跡できる。

### 0-1. DESIGN.md に記録

1. `/design-tracker` スキルを実行する
2. `.claude/docs/DESIGN.md` を読み、以下を確認・追記:
   - `/startproject` Phase 2 (Architect) で決定されたアーキテクチャ
   - ライブラリ選定とその理由
   - 主要な設計判断（パターン、データフロー、モジュール構成）
   - 未記録の意思決定があれば追記
3. 実装前スナップショットとして Changelog にエントリを追加

```markdown
## Changelog
- {date}: Pre-implementation snapshot for {feature}
  - Architecture: {summary}
  - Key decisions: {list}
```

> この記録は実装完了後のレビュー（`/team-review`）でも参照される。

### 0-2. [MUST] Linear に設計記録コメントを投稿

**このサブステップは全 tier で必須。スキップ不可。**

`/design-tracker` 完了後、設計決定を Linear タスクにコメントとして投稿する（日本語）：

```
Linear MCP ツールで、/startproject から引き継いだ Linear タスクIDに以下をコメント:

## 設計記録: {feature}

### アーキテクチャ
- {architecture_decision_1}
- {architecture_decision_2}

### 技術選定
| ライブラリ | 用途 | 選定理由 |
|-----------|------|---------|
| {library_1} | {role_1} | {rationale_1} |

### 主要な設計判断
| 判断 | 理由 | 代替案 | 日付 |
|------|------|--------|------|
| {decision_1} | {rationale_1} | {alternatives_1} | {date} |

### 参照ドキュメント
- `.claude/docs/DESIGN.md`
```

> **Routing**: `.claude/rules/tool-routing.md` に従い、Gemini サブエージェント経由で計画、Claude MCP で実行する。

> **Linear タスクIDが無い場合**: ユーザーに「Linear タスクIDが見つかりません。IDを指定しますか？スキップしますか？」と確認する。暗黙的にスキップしてはならない。

### 0-3. [MUST] ローカルログに PRE エントリを追記

**このサブステップは全 tier で必須。スキップ不可。**

`.claude/docs/decisions/log-{feature}.md` に PRE エントリを追記:

```markdown
### [team-implement] PRE — {date}

- **担当者**: Claude Lead
- **概要**: 実装フェーズ開始、設計決定を記録
- **成果物**: `.claude/docs/DESIGN.md`（design-tracker により更新）
```

---

## Step 1: Create Feature Branch

**作業開始前に feature ブランチを作成する。**

### 1-1. ブランチ作成

```
現在のブランチを記録（deploy 時に戻る先）:
  git branch --show-current → 保持しておく

feature ブランチを作成・チェックアウト:
  git checkout -b feature/{feature-name}
```

> **Routing**: git 操作は `.claude/rules/tool-routing.md` に従い、Gemini サブエージェント経由で実行する。

ブランチ名の `{feature-name}` は `/startproject` で指定された機能名をケバブケースに変換して使用する（例: `feature/user-authentication`）。

### 1-2. [MUST] ブランチ情報をログに記録

**このサブステップは S/M/L tier で必須。スキップ不可。**

`.claude/docs/decisions/log-{feature}.md` に DECISION エントリを追記:

```markdown
### [team-implement] DECISION — {date}

- **担当者**: Claude Lead（Gemini サブエージェント経由）
- **概要**: フィーチャーブランチ `feature/{feature-name}` を `{base-branch}` から作成
- **理由**: 標準フィーチャーブランチワークフロー
- **ステータス**: 承認済み
- **成果物**: ブランチ `feature/{feature-name}`
```

---

## Step 2: Analyze Plan & Design Team

**タスクリストから並列化可能なワークストリームを特定する。**

### Team Design Principles

1. **ファイル所有権の分離**: 各Teammateが異なるファイルセットを所有
2. **依存関係の尊重**: 依存タスクは同一Teammateか、依存順で実行
3. **適切な粒度**: Teammate あたり 5-6 タスクが目安

### Common Team Patterns

**Pattern A: Module-Based (推奨)**
```
Teammate 1: Module A (models, core logic)
Teammate 2: Module B (API, endpoints)
Teammate 3: Tests (unit + integration)
```

**Pattern B: Layer-Based**
```
Teammate 1: Data layer (models, DB)
Teammate 2: Business logic (services)
Teammate 3: Interface layer (API/CLI)
```

**Pattern C: Feature-Based**
```
Teammate 1: Feature X (all layers)
Teammate 2: Feature Y (all layers)
Teammate 3: Shared infrastructure
```

### Anti-patterns

- 2つの Teammate が同じファイルを編集 → 上書きリスク
- Teammate あたりのタスクが多すぎる → 長時間放置リスク
- 依存関係が複雑すぎる → 調整コストが利益を上回る

---

## Step 3: Spawn Agent Team

**計画に基づいてチームを起動する。**

```
Create an agent team for implementing: {feature}

Each teammate receives:
- Project Brief from CLAUDE.md
- Architecture from .claude/docs/DESIGN.md
- Library constraints from .claude/docs/libraries/
- Their specific task assignments

Spawn teammates:

1. **Implementer-{module}** for each module/workstream
   Prompt: "You are implementing {module} for project: {feature}.

   Read these files for context:
   - CLAUDE.md (project context)
   - .claude/docs/DESIGN.md (architecture)
   - .claude/docs/libraries/ (library constraints)

   Your assigned tasks:
   {task list for this teammate}

   Your file ownership:
   {list of files this teammate owns}

   Rules:
   - ONLY edit files in your ownership set
   - Follow existing codebase patterns
   - Write type hints on all functions
   - Run ruff check after each file change
   - Communicate with other teammates if you need interface changes

   When done with each task, mark it completed in the task list."

2. **Tester** (optional but recommended)
   Prompt: "You are the Tester for project: {feature}.

   Read:
   - CLAUDE.md, .claude/docs/DESIGN.md
   - Existing test patterns in tests/

   Your tasks:
   - Write tests for each module as implementers complete them
   - Follow TDD where possible (write test stubs first)
   - Run uv run pytest after each test file
   - Report failing tests to the relevant implementer

   Test coverage target: 80%+"

Use delegate mode (Shift+Tab) to prevent Lead from implementing directly.
Wait for all teammates to complete their tasks.
```

---

## Step 4: Monitor & Coordinate

**Lead は実装せず、モニタリングと統合に専念する。**

### Monitoring Checklist

- [ ] タスクリストの進捗を確認（Ctrl+T）
- [ ] 各 Teammate の出力を確認（Shift+Up/Down）
- [ ] ファイル競合がないか確認
- [ ] 行き詰まっている Teammate がいないか確認

### Intervention Triggers

| 状況 | 対応 |
|------|------|
| Teammate が長時間タスクを進めない | メッセージで確認、必要なら再指示 |
| ファイル競合が発生 | 所有権を再配分 |
| テストが失敗し続ける | 関連する Implementer にメッセージ |
| 想定外の技術的問題 | Codex に相談（サブエージェント経由） |

### Quality Gates (via Hooks)

`TeammateIdle` hook と `TaskCompleted` hook が自動で品質チェック：

- lint チェック（ruff）
- テスト実行（pytest）
- 型チェック（ty）

### 4-2. [MUST] 介入判断をログに記録

**Lead がモニタリング中に介入判断を行った場合、必ずローカルログに記録する。該当する介入がなければこのサブステップは不要。**

`.claude/docs/decisions/log-{feature}.md` に DECISION エントリを追記:

```markdown
### [team-implement] DECISION — {date}

- **担当者**: Claude Lead
- **概要**: {intervention_description}
- **理由**: {intervention_rationale}
- **ステータス**: 承認済み
```

以下の場合に記録する：
- ファイル所有権の再配分
- Teammate への再指示
- 技術的問題の解決（特に Codex 相談を伴うもの）
- 実装中のスコープ変更

---

## Step 5: Integration & Verification

**全タスク完了後、統合検証を行う。**

### 5-1. 品質チェック実行

```bash
# All quality checks
uv run ruff check .
uv run ruff format --check .
uv run ty check src/
uv run pytest -v

# Or via poe
poe all
```

品質チェック通過後、ユーザーに Integration Report を提示する：

```markdown
## 実装完了: {feature}

### 完了タスク
- [x] {task 1}
- [x] {task 2}
...

### 品質チェック
- ruff: ✓ / ✗
- ty: ✓ / ✗
- pytest: ✓ ({N} tests passed)
- coverage: {N}%

### 次のステップ
`/team-review` で並列レビューを実行してください
```

### 5-2. [MUST] 実装サマリーをローカルに保存

**このサブステップは全 tier で必須。スキップ不可。**

1. `.claude/docs/decisions/implementation-{feature}.md` に保存:

```markdown
## Implementation Summary: {feature}

### Completed Tasks
- [x] {task 1}
- [x] {task 2}

### Quality Checks
- ruff: {pass/fail}
- ty: {pass/fail}
- pytest: {N} tests, {coverage}% coverage

### Commits
- {hash}: {message}

### Key Decisions During Implementation
- {decision 1}: {rationale}

### Changed Files
- {file list}

### Date
{date}
```

### 5-3. [MUST] ローカルログに POST エントリを追記

**このサブステップは全 tier で必須。スキップ不可。**

`.claude/docs/decisions/log-{feature}.md` に POST エントリを追記:

```markdown
### [team-implement] POST — {date}

- **担当者**: Claude Lead
- **概要**: 実装完了、{task_count}タスク完了、品質チェック全通過
- **成果物**: `.claude/docs/decisions/implementation-{feature}.md`
```

### 5-4. [MUST] Linear に実装完了コメントを投稿

**このサブステップは全 tier で必須。スキップ不可。**

> **Linear タスクIDが無い場合**: ユーザーに「Linear タスクIDが見つかりません。IDを指定しますか？スキップしますか？」と確認する。暗黙的にスキップしてはならない。

```
手順 1: GitHub MCP ツールでコミット情報・変更ファイルを取得
  - feature/{feature-name} ブランチのコミット履歴
  - 各コミットのハッシュ、メッセージ、URL
  - 変更ファイル一覧

手順 2: Linear MCP ツールで、/startproject から引き継いだ Linear タスクIDに以下をコメント:

## 実装完了: {feature}

### コミット履歴
- [{commit hash 1}]({commit URL 1}): {commit message 1}
- [{commit hash 2}]({commit URL 2}): {commit message 2}
...

### 完了タスク
- [x] {task 1}
- [x] {task 2}
...

### 品質チェック結果
- ruff: ✓ / ✗
- ty: ✓ / ✗
- pytest: {N} tests passed, coverage {N}%

### 変更ファイル
- {file list from GitHub MCP}

### 次のステップ
`/team-review` で並列レビュー予定
```

> **Routing**: `.claude/rules/tool-routing.md` に従い、GitHub MCP でコミット情報取得、Linear MCP でコメント投稿。

### Cleanup

```
Clean up the team
```

---

## Tips

- **Adaptive**: XS/S は Claude 直接実装、M は小チーム、L はフルチーム（`.claude/rules/adaptive-execution.md`）
- **Delegate mode**: Shift+Tab で Lead が実装を避ける（Tier L のみ）
- **タスク粒度**: Teammate あたり 5-6 タスクが最適
- **ファイル競合回避**: モジュール単位の所有権分離が最重要
- **Tester 分離**: Implementer とは別に Tester を立てるとTDD的に回る
- **コスト意識**: 各 Teammate は独立した Claude インスタンス（トークン消費大）→ 小タスクにはチーム不要
