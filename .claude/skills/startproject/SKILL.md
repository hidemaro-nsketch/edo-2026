---
name: startproject
description: |
  Start a new project/feature with multi-agent collaboration (Opus 4.6 + Agent Teams).
  Phase 1: Codebase understanding (Claude 1M context).
  Phase 2: Parallel research & design (Agent Teams: Researcher + Architect).
  Phase 3: Plan synthesis & user approval.
  Implementation is handled separately by /team-implement.
metadata:
  short-description: Project kickoff with Agent Teams (Plan phase)
---

# Start Project

**Opus 4.6 の 1M コンテキストと Agent Teams を活用したプロジェクト開始スキル。**

## Overview

このスキルは計画フェーズ（Phase 1-3）を担当する。実装は `/team-implement`、レビューは `/team-review` で行う。

```
/startproject <feature>     ← このスキル（計画）
    ↓ 承認後
/team-implement             ← 並列実装
    ↓ 完了後
/team-review                ← 並列レビュー
```

## Workflow

```
Step 0: CLASSIFY (Claude Lead)
  タスクサイズを自動判定 (XS/S/M/L) → ワークフローを適応
    ↓
Phase 1: UNDERSTAND (Claude Lead — 1M context)
  1-1. コードベースを直接読む
  1-2. Linear タスクをリンク（取得 or 新規作成）
  1-3. ユーザーと対話して要件を理解
  1-4. [MUST] 要件決定をログに記録
  1-5. プロジェクト概要書を作成
  1-6. [MUST] 概要書をファイル保存 + ログに PRE エントリ追記
    ↓
Phase 2: RESEARCH & DESIGN (tier-dependent)
  XS/S: スキップ
  M: Codex サブエージェントのみ（設計相談）
  L: Agent Teams (Researcher ←→ Architect)
    ↓
Phase 3: PLAN & APPROVE (Claude Lead + User)
  3-1. 調査と設計を統合
  3-2. 実装計画を作成
  3-3. CLAUDE.md を更新
  3-4. [MUST] Linear に計画完了コメントを投稿 + ログに POST エントリ追記
  3-5. ユーザーに計画を提示して承認を求める
```

### 記録ステップの適用範囲（MUST）

**以下の記録・投稿は全 tier で必須。スキップ不可。**

| 記録アクション | 発生箇所 | S | M | L |
|---------------|---------|:--:|:--:|:--:|
| 要件決定をログに記録 | Phase 1 (1-4) | MUST | MUST | MUST |
| 概要書をファイル保存 | Phase 1 (1-6) | MUST | MUST | MUST |
| `log-{feature}.md` PRE エントリ | Phase 1 (1-6) | MUST | MUST | MUST |
| Linear に計画完了コメント | Phase 3 (3-4) | MUST | MUST | MUST |
| `log-{feature}.md` POST エントリ | Phase 3 (3-4) | MUST | MUST | MUST |

> **Linear タスクIDが無い場合**: ユーザーに確認する。「Linear タスクIDが見つかりません。Linear への投稿をスキップしますか？それともタスクIDを指定しますか？」と質問し、指示に従う。**暗黙的なスキップは禁止。**

---

## Step 0: CLASSIFY (Claude Lead)

**タスクサイズを判定し、ワークフローを適応させる。**

> 参照: `.claude/rules/adaptive-execution.md`

### Classification

要件をヒアリングした後（または事前に明らかな場合）、以下を判定：

```
tier = max(file_tier, complexity_tier, risk_tier)
```

| Tier | Phase 2 | Gemini 調査 | Codex 設計 |
|------|---------|------------|-----------|
| **XS** | /startproject 自体不要 | 不要 | 不要 |
| **S** | スキップ | 不要 | 不要 |
| **M** | Codex サブエージェントのみ | 必要時のみ | サブエージェント |
| **L** | Agent Teams (フル) | 標準 | Agent Teams |

### Presentation

判定結果をユーザーに提示する：

```markdown
**Task Size: {tier} ({label})**
- Files: ~{N} ({range})
- Complexity: {description}
- Risk: {level}
- External research: {needed/not needed}
```

ユーザーは判定を上書きできる。

---

## Phase 1: UNDERSTAND (Claude Lead)

**Claude が 1M コンテキストで直接コードベースを読み、ユーザーと対話する。**

> Opus 4.6 は 1M トークンのコンテキストを持つ。Gemini にコードベース分析を委託する必要はなくなった。

### Step 1: Read Codebase

Explore agent またはGlob/Grep/Read を使い、コードベースを直接読む：

- ディレクトリ構造
- 主要モジュールと責務
- 既存のパターン・規約
- 関連する既存コード
- テスト構造

```
Explore agent / Glob / Grep / Read を使い、以下を把握:
- プロジェクト構造
- 関連する既存コードとパターン
- 技術スタック・依存関係
- テスト構造
```

### Step 2: Linear Task Linking

ユーザーに Linear タスクの指定を求める（日本語で）：

- 「対象の Linear タスク（ID または URL）を教えてください」
- ユーザーがタスクIDを指定 → Linear MCP ツールでタスク詳細を取得
- ユーザーが「新規作成」と回答 → Linear MCP ツールで新規 issue を作成

取得/作成した Linear タスクIDは、以降のフェーズを通じて保持する。

> **Routing**: Linear 操作は `.claude/rules/tool-routing.md` に従い、Gemini サブエージェント経由で計画、Claude MCP で実行する。

### Step 3: Requirements Gathering

ユーザーに質問して要件を明確化（日本語で）：

1. **目的**: 何を達成したいですか？
2. **スコープ**: 含めるもの・除外するものは？
3. **技術的要件**: 特定のライブラリ、制約は？
4. **成功基準**: 完了の判断基準は？
5. **最終デザイン**: どのような形にしたいですか？

### Step 3-2: [MUST] 要件決定をログに記録

**このサブステップは全 tier で必須。スキップ不可。**

要件定義で確定した意思決定をローカルログに記録する：

`.claude/docs/decisions/log-{feature}.md` に DECISION エントリを追記:

```markdown
### [startproject] DECISION — {date}

- **担当者**: ユーザー + Claude Lead
- **概要**: {requirement_decision}
- **理由**: {user_reasoning}
- **ステータス**: 承認済み
```

要件ごとに1エントリ追記する。スコープの包含・除外、技術的制約、成功基準など、合意した主要な要件をすべて記録する。

### Step 4: Create Project Brief

コードベース理解 + 要件を「プロジェクト概要書」にまとめる：

```markdown
## Project Brief: {feature}

### Current State
- Architecture: {existing architecture summary}
- Relevant code: {key files and modules}
- Patterns: {existing patterns to follow}

### Goal
{User's desired outcome in 1-2 sentences}

### Scope
- Include: {list}
- Exclude: {list}

### Constraints
- {technical constraints}
- {library requirements}

### Success Criteria
- {measurable criteria}
```

This brief is passed to Phase 2 teammates as shared context.

### Step 4-2: [MUST] 概要書をファイル保存 + ログに PRE エントリ追記

**このサブステップは全 tier で必須。スキップ不可。**

プロジェクト概要書をファイルに保存する：

1. `.claude/docs/decisions/brief-{feature}.md` にプロジェクト概要書の全内容を保存
2. `.claude/docs/decisions/log-{feature}.md` に PRE エントリを追記:

```markdown
### [startproject] PRE — {date}

- **担当者**: Claude Lead
- **概要**: プロジェクト概要書を作成（{feature}）
- **成果物**: `.claude/docs/decisions/brief-{feature}.md`
```

> ディレクトリ `.claude/docs/decisions/` が存在しない場合は作成する。

---

## Phase 2: RESEARCH & DESIGN (Tier-Dependent)

**タスクサイズに応じて調査・設計の方法を適応させる。**

> 参照: `.claude/rules/adaptive-execution.md`

### Tier S: Skip Phase 2

Phase 2 をスキップし、Phase 3 に直接進む。Claude Lead が Phase 1 の知識で計画を作成する。

### Tier M: Codex Subagent Only

Agent Teams は使用しない。Codex サブエージェントに設計相談する：

```
Task tool parameters:
- subagent_type: "general-purpose"
- prompt: |
    Consult Codex about architecture for: {feature}

    Project Brief:
    {project brief from Phase 1}

    codex exec --model gpt-5.3-codex --sandbox read-only --full-auto "
    {design question}
    " 2>/dev/null

    Update .claude/docs/DESIGN.md with key decisions.
    Return CONCISE summary.
```

Gemini 外部調査は、未知のライブラリや外部 API が関わる場合**のみ**サブエージェントで実行する。

### Tier L: Full Agent Teams

**Agent Teams で Researcher と Architect を並列起動し、双方向通信させる。**

> サブエージェントとの決定的な違い: Teammates は相互通信できる。
> Researcher の発見が Architect の設計を変え、Architect の要求が新たな調査を生む。

### Team Setup (Tier L Only)

```
Create an agent team for project planning: {feature}

Spawn two teammates:

1. **Researcher** — Gemini CLI を使って外部調査を行う
   Prompt: "You are the Researcher for project: {feature}.

   Your job: Use Gemini CLI to research external information needed for this project.

   Project Brief:
   {project brief from Phase 1}

   Tasks:
   1. Research libraries and tools: usage patterns, constraints, best practices
   2. Find latest documentation and API specifications
   3. Identify common pitfalls and anti-patterns
   4. Look for similar implementations and reference architectures

   How to research:
   gemini -p "{question}" 2>/dev/null

   Save all findings to .claude/docs/research/{feature}.md
   Save library docs to .claude/docs/libraries/{library}.md

   Communicate with Architect teammate:
   - Share findings that affect design decisions
   - Respond to Architect's research requests
   - Flag constraints that limit implementation options"

2. **Architect** — Codex CLI を使って設計検討を行う
   Prompt: "You are the Architect for project: {feature}.

   Your job: Use Codex CLI to design the architecture and implementation plan.

   Project Brief:
   {project brief from Phase 1}

   Tasks:
   1. Design architecture (modules, interfaces, data flow)
   2. Select patterns (considering existing codebase conventions)
   3. Break down into implementable tasks with dependencies
   4. Identify risks and mitigation strategies

   How to consult Codex:
   codex exec --model gpt-5.3-codex --sandbox read-only --full-auto "{question}" 2>/dev/null

   Update .claude/docs/DESIGN.md with architecture decisions.

   Communicate with Researcher teammate:
   - Request specific library/tool research
   - Share design constraints that need validation
   - Adjust design based on Researcher's findings"

Wait for both teammates to complete their tasks.
```

### Why Bidirectional Communication Matters

```
Example interaction flow:

Researcher: "httpx has a connection pool limit of 100 by default"
    → Architect: "Need to add connection pool config to design"
    → Architect: "Also research: does httpx support HTTP/2 multiplexing?"
    → Researcher: "Yes, via httpx[http2]. Requires h2 dependency."
    → Architect: "Updated design to use HTTP/2 for the API client module"
```

Without Agent Teams (old subagent approach), this would require:
1. Gemini subagent finishes → returns summary
2. Claude reads summary → creates new Codex subagent prompt
3. Codex subagent finishes → returns summary
4. If Codex needs more info → another Gemini subagent round

Agent Teams collapses this into a single parallel session with real-time interaction.

---

## Phase 3: PLAN & APPROVE (Claude Lead)

**Agent Teams の結果を統合し、実装計画を作成してユーザーに承認を求める。**

### Step 1: Synthesize Results

Read outputs from Phase 2:
- `.claude/docs/research/{feature}.md` — Researcher findings
- `.claude/docs/libraries/{library}.md` — Library documentation
- `.claude/docs/DESIGN.md` — Architecture decisions

### Step 2: Create Implementation Plan

Create task list using TodoWrite:

```python
{
    "content": "Implement {specific task}",
    "activeForm": "Implementing {specific task}",
    "status": "pending"
}
```

Task breakdown should follow `references/task-patterns.md`.

### Step 3: Update CLAUDE.md

Add project context to CLAUDE.md for cross-session persistence:

```markdown
---

## Current Project: {feature}

### Context
- Goal: {1-2 sentences}
- Key files: {list}
- Dependencies: {list}

### Architecture
- {Key architecture decisions from Architect}

### Library Constraints
- {Key constraints from Researcher}

### Decisions
- {Decision 1}: {rationale}
- {Decision 2}: {rationale}
```

### Step 4: [MUST] Linear に計画完了コメントを投稿 + ログに POST エントリ追記

**このステップは全 tier で必須。スキップ不可。**

> **Linear タスクIDが無い場合**: ユーザーに「Linear タスクIDが見つかりません。IDを指定しますか？スキップしますか？」と確認する。暗黙的にスキップしてはならない。

計画確定後、設計方針を Linear タスクにコメントとして追加する（日本語）：

```
Linear MCP ツールで、Phase 1 で取得した Linear タスクIDに以下をコメント:

## 計画完了: {feature}

### 概要
{feature}の計画フェーズが完了しました。コードベース分析、要件定義、設計検討を経て、実装計画を策定しました。

### 要件定義の決定事項
- {requirement_decision_1}: {rationale_1}
- {requirement_decision_2}: {rationale_2}

### 設計方針
- アーキテクチャ: {architecture_decisions}
- 技術選定: {library_choices}
- パターン: {design_patterns}

### タスク分解
- {task_count}個のタスクに分割
- 推定ワークストリーム: {stream_count}本

### 成果物
- `.claude/docs/decisions/brief-{feature}.md`
- `.claude/docs/decisions/log-{feature}.md`
- `.claude/docs/DESIGN.md`（更新）
- `.claude/docs/research/{feature}.md`

### 次のステップ
- `/team-implement` で並列実装を開始
```

**[MUST]** 同時に `.claude/docs/decisions/log-{feature}.md` に POST エントリを追記（スキップ不可）:

```markdown
### [startproject] POST — {date}

- **担当者**: Claude Lead
- **概要**: 計画フェーズ完了、{task_count}タスクに分割、Linear にコメント投稿済み
- **成果物**: `.claude/docs/DESIGN.md`, `.claude/docs/research/{feature}.md`
```

> **Routing**: `.claude/rules/tool-routing.md` に従い、Gemini サブエージェント経由で計画、Claude MCP で実行する。

### Step 5: Present to User

Present the plan in Japanese:

```markdown
## プロジェクト計画: {feature}

### コードベース分析
{Key findings from Phase 1 — 3-5 bullet points}

### 調査結果 (Researcher)
{Key findings — 3-5 bullet points}
{Library constraints and recommendations}

### 設計方針 (Architect)
{Architecture overview}
{Key design decisions with rationale}

### タスクリスト ({N}個)
{Task list with dependencies}

### リスクと注意点
{From Architect's analysis}

### 次のステップ
1. この計画で進めてよろしいですか？
2. 承認後、`/team-implement` で並列実装を開始できます
3. 実装後、`/team-review` で並列レビューを行います

---
この計画で進めてよろしいですか？
```

---

## Output Files

| File | Author | Purpose |
|------|--------|---------|
| `.claude/docs/research/{feature}.md` | Researcher | External research findings |
| `.claude/docs/libraries/{lib}.md` | Researcher | Library documentation |
| `.claude/docs/DESIGN.md` | Architect | Architecture decisions |
| `CLAUDE.md` (updated) | Lead | Cross-session project context |
| `.claude/docs/decisions/brief-{feature}.md` | Lead | Project brief (persistent) |
| `.claude/docs/decisions/log-{feature}.md` | Lead | Canonical decision log |
| Task list (internal) | Lead | Implementation tracking |

---

## Tips

- **Step 0**: タスクサイズ (XS/S/M/L) を判定し、ワークフローを適応させる（`.claude/rules/adaptive-execution.md`）
- **Phase 1**: Claude は 1M コンテキストでコードベースを直接読める。Gemini への委託は不要
- **Phase 2**: L のみ Agent Teams、M は Codex サブエージェントのみ、S はスキップ
- **Phase 3**: 計画承認後、`/team-implement` で並列実装に進む
- **Ctrl+T**: タスクリストの表示切り替え
- **Shift+Up/Down**: チームメイト間の移動（Agent Teams 使用時）
