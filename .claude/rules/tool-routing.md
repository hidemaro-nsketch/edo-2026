# Tool Routing Rules

**Defines which tools and operations are delegated to which agent.**

This file complements agent-specific rules (`codex-delegation.md`, `gemini-delegation.md`)
by providing cross-cutting routing decisions.

## Adaptive Execution Override

> 参照: `.claude/rules/adaptive-execution.md`

ルーティングルールはタスクサイズに応じて適応される：

- **XS/S タスク**: Codex/Gemini への委託は不要。Claude が直接対応する。ただし git/docker/ruff/uv 等のコマンド実行ルーティング（下記テーブル）は全 tier で適用。
- **M タスク**: 必要な場合のみ Codex サブエージェントで設計相談。Gemini は未知のライブラリ・外部 API がある場合のみ。
- **L タスク**: フルルーティング（全ルール適用）。

## Routing Table

| Operation | Delegate To | Method |
|-----------|-------------|--------|
| git operations | **Gemini subagent** | Bash (`git` commands) |
| GitHub (MCP) | **Gemini subagent** | Gemini plans, Claude GitHub MCP executes |
| Linear (MCP) | **Gemini subagent** | Gemini plans, Claude Linear MCP executes |
| Dependency management | **Gemini subagent** | `uv` commands + Google Search |
| Changelog / release notes | **Gemini subagent** | `git log` analysis + formatting |
| Docker operations | **Gemini subagent** | `docker` / `docker-compose` commands |
| Lint / format execution | **Gemini subagent** | `ruff check` / `ruff format` |
| Environment setup / diagnostics | **Gemini subagent** | `uv sync`, version checks, etc. |
| Shell script generation | **Gemini subagent** | Script creation + execution |
| File organization | **Gemini subagent** | Bulk rename, directory restructure |
| Codebase analysis | **Gemini subagent** | `gemini-explore` or `general-purpose` |
| Design decisions | Codex | Subagent or Agent Teams |
| External research | Gemini | Subagent or Agent Teams |
| Multimodal | Gemini | Subagent |

## Codebase Analysis via Gemini

Codebase analysis should be routed through a Gemini subagent (preferably `gemini-explore`).

### Scope

- Repository-wide architecture analysis
- Cross-module dependency understanding
- Pattern discovery across the codebase
- Data flow and impact analysis
- Code structure overview

### How to Route

```
Task tool parameters:
- subagent_type: "gemini-explore"  (preferred)
- run_in_background: true
- prompt: |
    Analyze the codebase: {description}

    Use Gemini CLI with --include-directories to analyze:
    gemini -p "{analysis question}" --include-directories . 2>/dev/null

    Follow up with local tools (Grep/Read/Glob) for targeted inspection.

    Save full output to: .claude/docs/research/{topic}.md
    Return CONCISE summary.
```

### Triggers

| User Input | Action |
|------------|--------|
| 「コードベースを理解して」「アーキテクチャ分析して」 | Route to Gemini subagent |
| 「コード全体を見て」「横断的に分析して」 | Route to Gemini subagent |
| 「依存関係を調べて」「影響範囲を分析して」 | Route to Gemini subagent |

### Exceptions (Claude handles directly)

- Reading a specific single file (Read tool)
- Searching for a specific symbol/function (Grep/Glob tools)
- Quick reference during implementation (targeted file reads)

## Git Operations via Gemini

ALL git operations should be routed through a Gemini subagent.

### Scope

- `git commit`, `git push`, `git pull`, `git merge`, `git rebase`
- `git branch`, `git checkout`, `git switch`
- `git log`, `git diff`, `git status`

> **ブランチ情報・コミット情報の取得**: GitHub MCP ツールを優先して使用する（下記「GitHub Operations」参照）。`git` CLI はローカル操作（commit, checkout 等）に使用する。

### How to Route

```
Task tool parameters:
- subagent_type: "general-purpose"
- prompt: |
    Perform the following git operation via Gemini CLI.

    Task: {description of git task}

    Use Gemini to plan and execute:
    gemini -p "Plan the git workflow for: {task description}" 2>/dev/null

    Then execute the git commands based on Gemini's recommendation.
    Report results back concisely.
```

### Exceptions (Claude handles directly)

- Reading `.gitignore` or git config files (file read, not git operation)
- `git status` when only checking current state for context (informational only)

## GitHub Operations via Gemini (MCP)

GitHub MCP ツールを使ってリポジトリ情報を取得する。
Gemini が計画し、Claude が GitHub MCP ツールで実行する。

### Scope

- ブランチ情報の取得（一覧、詳細、保護状態）
- コミット履歴の取得（ハッシュ、メッセージ、差分）
- PR 情報の取得・作成・更新
- Issue 情報の取得・作成
- リポジトリ情報の取得

### Use Cases

| 場面 | GitHub MCP の役割 |
|------|-------------------|
| `/team-implement` 完了時 | コミット履歴を GitHub MCP で取得 → Linear コメントに追加 |
| `/deploy` 時 | ブランチ情報・コミットリンクを GitHub MCP で取得 → Linear コメントに追加 |
| PR 作成 | GitHub MCP で PR を作成 |

### How to Route

```
Task tool parameters:
- subagent_type: "general-purpose"
- prompt: |
    Retrieve GitHub information using MCP tools.

    Task: {description}

    Step 1: Consult Gemini for approach
    gemini -p "What GitHub information do I need for: {task}" 2>/dev/null

    Step 2: Use GitHub MCP tools to retrieve the information.
    - Branch info, commit history, PR details, etc.

    Step 3: Return structured data for use in Linear comments.
```

### Triggers

| User Input | Action |
|------------|--------|
| 「コミット情報を取得して」 | GitHub MCP で取得 |
| 「ブランチ情報を見せて」 | GitHub MCP で取得 |
| 「PRを作って」 | GitHub MCP で作成 |

---

## Linear Operations via Gemini

Linear operations (via MCP tools) should be planned by Gemini, then executed using
Claude's MCP tools within a subagent.

### Scope

- Issue creation, update, assignment
- Project/cycle management
- Label and status changes
- Querying issues and filtering

### How to Route

```
Task tool parameters:
- subagent_type: "general-purpose"
- prompt: |
    Perform the following Linear operation.

    Task: {description of Linear task}

    Step 1: Consult Gemini for approach
    gemini -p "Plan the Linear workflow for: {task description}.
    Consider issue structure, labels, assignments, and project organization." 2>/dev/null

    Step 2: Execute using the available Linear MCP tools based on Gemini's plan.

    Step 3: Report results back concisely in Japanese.
```

### Note on MCP Constraint

MCP tools (including Linear) are only accessible within Claude Code's tool system.
Gemini CLI cannot directly call MCP tools. The pattern is:
1. **Gemini plans** the operation (what to create, how to structure)
2. **Claude subagent executes** using MCP tools

## Trigger Detection

### Git Triggers

| User Input | Action |
|------------|--------|
| 「コミットして」「pushして」 | Route to Gemini subagent |
| 「PRを作って」「ブランチを切って」 | Route to Gemini subagent |
| 「git log見せて」「差分を見せて」 | Route to Gemini subagent |
| `git *` (any git command) | Route to Gemini subagent |

### Linear Triggers

| User Input | Action |
|------------|--------|
| 「Linearにissue作って」 | Route to Gemini subagent |
| 「チケットを更新して」 | Route to Gemini subagent |
| 「タスクのステータスを変えて」 | Route to Gemini subagent |
| Linear/issue/ticket mention | Route to Gemini subagent |

## Dependency Management via Gemini

Package updates, vulnerability checks, and dependency auditing.

### Scope

- `uv add` / `uv remove` / `uv sync`
- Checking latest versions of packages (Google Search grounding)
- `pip-audit` / vulnerability scanning
- Updating `pyproject.toml` dependency versions

### How to Route

```
Task tool parameters:
- subagent_type: "general-purpose"
- prompt: |
    Perform dependency management via Gemini CLI.

    Task: {description}

    Step 1: Check latest versions / vulnerabilities via Gemini
    gemini -p "Check the latest stable versions and known issues for: {packages}" 2>/dev/null

    Step 2: Execute uv commands as needed.
    Step 3: Report results back concisely.
```

### Triggers

| User Input | Action |
|------------|--------|
| 「パッケージを更新して」「依存を追加して」 | Route to Gemini subagent |
| 「脆弱性チェックして」「audit して」 | Route to Gemini subagent |
| `uv add *` / `uv sync` | Route to Gemini subagent |

## Changelog / Release Notes via Gemini

Generate changelogs and release notes from git history.

### Scope

- Generating changelogs from `git log`
- Formatting release notes (Markdown)
- Summarizing changes between tags/releases

### How to Route

```
Task tool parameters:
- subagent_type: "general-purpose"
- prompt: |
    Generate changelog / release notes.

    Task: {description}

    Step 1: Run git log to gather commit history
    git log --oneline {range}

    Step 2: Use Gemini to summarize and categorize
    gemini -p "Categorize these commits into Features, Fixes, and Other.
    Format as a Markdown changelog: {git log output}" 2>/dev/null

    Step 3: Return the formatted changelog.
```

### Triggers

| User Input | Action |
|------------|--------|
| 「changelog作って」「リリースノート生成して」 | Route to Gemini subagent |
| 「変更履歴をまとめて」 | Route to Gemini subagent |

## Docker Operations via Gemini

Container build, run, and management.

### Scope

- `docker build`, `docker run`, `docker compose up/down`
- Dockerfile analysis and optimization
- Container log inspection

### How to Route

```
Task tool parameters:
- subagent_type: "general-purpose"
- prompt: |
    Perform Docker operation via Gemini CLI.

    Task: {description}

    Use Gemini for planning if needed:
    gemini -p "{question about Docker best practices}" 2>/dev/null

    Then execute docker commands directly.
    Report results back concisely.
```

### Triggers

| User Input | Action |
|------------|--------|
| 「コンテナを起動して」「docker build して」 | Route to Gemini subagent |
| 「docker-compose up して」 | Route to Gemini subagent |

## Lint / Format Execution via Gemini

Code quality checks and auto-formatting.

### Scope

- `ruff check .` / `ruff check --fix .`
- `ruff format .` / `ruff format --check .`
- Reporting lint results

### How to Route

```
Task tool parameters:
- subagent_type: "general-purpose"
- prompt: |
    Run lint/format checks.

    Task: {description}

    Execute:
    uv run ruff check . 2>&1
    uv run ruff format --check . 2>&1

    If --fix is requested:
    uv run ruff check --fix . 2>&1
    uv run ruff format . 2>&1

    Report results back concisely (errors found, files fixed, etc.).
```

### Triggers

| User Input | Action |
|------------|--------|
| 「lintして」「フォーマットして」 | Route to Gemini subagent |
| 「ruff かけて」「コード整形して」 | Route to Gemini subagent |

## Environment Setup / Diagnostics via Gemini

Development environment initialization and health checks.

### Scope

- `uv sync`, `uv venv`, virtual environment setup
- Tool version checks (`python --version`, `uv --version`, etc.)
- Environment diagnostics and troubleshooting

### How to Route

```
Task tool parameters:
- subagent_type: "general-purpose"
- prompt: |
    Perform environment setup / diagnostics.

    Task: {description}

    Execute the necessary commands (uv sync, version checks, etc.).
    If issues are found, consult Gemini for solutions:
    gemini -p "{question about environment issue}" 2>/dev/null

    Report environment status concisely.
```

### Triggers

| User Input | Action |
|------------|--------|
| 「環境セットアップして」「uv sync して」 | Route to Gemini subagent |
| 「環境を確認して」「バージョン確認して」 | Route to Gemini subagent |

## Shell Script Generation via Gemini

Creating and executing shell scripts.

### Scope

- Bash script creation for automation tasks
- One-off shell commands (complex piping, loops, etc.)
- Cron job setup

### How to Route

```
Task tool parameters:
- subagent_type: "general-purpose"
- prompt: |
    Generate and/or execute a shell script.

    Task: {description}

    Use Gemini to generate the script:
    gemini -p "Write a bash script that: {requirement}" 2>/dev/null

    Review the output, save if needed, and execute.
    Report results back concisely.
```

### Triggers

| User Input | Action |
|------------|--------|
| 「スクリプト書いて」「シェルスクリプト作って」 | Route to Gemini subagent |
| 「自動化して」「バッチ処理作って」 | Route to Gemini subagent |

## File Organization via Gemini

Bulk file operations and directory restructuring.

### Scope

- Bulk file rename (pattern-based)
- Directory restructuring / cleanup
- File moving and organizing by convention

### How to Route

```
Task tool parameters:
- subagent_type: "general-purpose"
- prompt: |
    Perform file organization task.

    Task: {description}

    Plan the operations first (list what will be moved/renamed).
    Execute using bash commands (mv, mkdir, etc.).
    Report what was changed concisely.
```

### Exceptions (Claude handles directly)

- Editing file contents (Claude's Edit/Write tools)
- Creating new source code files (Claude's domain)

### Triggers

| User Input | Action |
|------------|--------|
| 「ファイルを整理して」「リネームして」 | Route to Gemini subagent |
| 「ディレクトリ構成を変えて」 | Route to Gemini subagent |

---

## Adding New Routes

To add a new tool routing rule:

1. Add entry to the **Routing Table** above
2. Define **Scope** (what operations are covered)
3. Define **How to Route** (subagent prompt template)
4. Define **Trigger Detection** (user input patterns)
5. Note any **Exceptions** (when Claude handles directly)
