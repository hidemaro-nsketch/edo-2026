---
name: deploy
description: |
  Push the feature branch to remote, create a PR, and switch back to the original branch.
  Run after /team-review completes. Handles git push, PR creation, and branch cleanup.
metadata:
  short-description: Push feature branch, create PR, and return to original branch
---

# Deploy

**feature ブランチを push し、PR を作成して、元のブランチに戻る。**

## Prerequisites

- `/team-implement` で feature ブランチが作成されていること
- `/team-review` が完了していること
- すべての品質チェックがパスしていること

## Workflow

```
Step 1: 品質チェック確認
  ↓
Step 2: feature ブランチを push
  ↓
Step 3: PR を作成（gh CLI 経由）
  ↓
Step 4: 元のブランチに戻る
  ↓
Step 5: デプロイ情報を記録・投稿
  5-1. [MUST] Linear タスクにデプロイ情報をコメント
  5-2. [MUST] ローカルログに POST エントリ追記
```

### 記録ステップの適用範囲（MUST）

**以下の記録・投稿は必須。スキップ不可。**

| 記録アクション | 発生箇所 |
|---------------|---------|
| Linear にデプロイ情報コメント | Step 5-1 |
| `log-{feature}.md` POST エントリ | Step 5-2 |

> **Linear タスクIDが無い場合**: ユーザーに確認する。「Linear タスクIDが見つかりません。IDを指定しますか？スキップしますか？」と質問し、指示に従う。**暗黙的なスキップは禁止。**

---

## Step 1: Pre-push Verification

push 前に最終確認を行う：

```bash
# Uncommitted changes がないか確認
git status

# 品質チェック
uv run ruff check .
uv run ruff format --check .
uv run pytest -v
```

未コミットの変更がある場合はユーザーに確認する。

## Step 2: Push Feature Branch

```bash
# 現在のブランチ名を確認
git branch --show-current
# → feature/{feature-name} であることを確認

# リモートに push
git push -u origin feature/{feature-name}
```

## Step 3: Create Pull Request (gh CLI)

> **重要**: PR 作成には `gh` CLI を使用する。GitHub MCP の `create_pull_request` は 404 エラーが発生する場合があるため、`gh pr create` を推奨する。

```bash
# origin/main とのコンフリクトがある場合はリベースで解消
git fetch origin
git rebase origin/main
# コンフリクトがあれば手動解消 → git rebase --continue
# リベース後は force push が必要
git push --force-with-lease origin feature/{feature-name}

# PR を作成
gh pr create \
  --base main \
  --head feature/{feature-name} \
  --title "feat({feature-name}): {short description}" \
  --body "$(cat <<'EOF'
## Summary
- {変更内容のサマリー（3-5 bullet points）}

## Test plan
- [ ] {テスト項目}

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

PR のタイトルとボディは、実装内容に応じて適切に記述する。

## Step 4: Return to Original Branch

```bash
# /team-implement Step 0 で記録した元のブランチに戻る
git checkout {original-branch}
```

元のブランチ名が不明な場合はユーザーに確認する（通常は `main`）。

## Step 5: デプロイ情報を記録・投稿

### 5-1. [MUST] Linear タスクにデプロイ情報をコメント

**このサブステップは必須。スキップ不可。**

> **Linear タスクIDが無い場合**: ユーザーに「Linear タスクIDが見つかりません。IDを指定しますか？スキップしますか？」と確認する。暗黙的にスキップしてはならない。

GitHub MCP でブランチ・コミット情報を取得し、Linear タスクにコメントとして追加する：

```
手順 1: GitHub MCP ツールで情報を取得
  - feature/{feature-name} ブランチの詳細（URL、保護状態）
  - コミット履歴（ハッシュ、メッセージ、URL）
  - push 先の確認

手順 2: Linear MCP ツールで、Linear タスクIDに以下をコメント:

## デプロイ完了: {feature}

### ブランチ
- [`feature/{feature-name}`]({branch URL on GitHub}) → origin に push 済み

### コミット履歴
- [{commit hash 1}]({commit URL 1}): {commit message 1}
- [{commit hash 2}]({commit URL 2}): {commit message 2}
...

### レビュー結果サマリー
- セキュリティ: {summary}
- コード品質: {summary}
- テストカバレッジ: {summary}

### PR
- [{PR title}]({PR URL})

### 次のステップ
- マージ待ち
```

> **Routing**: `.claude/rules/tool-routing.md` に従い、GitHub MCP で情報取得、Linear MCP でコメント投稿。

### 5-2. [MUST] ローカルログに POST エントリ追記

**このサブステップは必須。スキップ不可。**

`.claude/docs/decisions/log-{feature}.md` に POST エントリを追記:

```markdown
### [deploy] POST — {date}

- **担当者**: Claude Lead（Gemini サブエージェント経由）
- **概要**: フィーチャーブランチを origin に push、PR 作成、{original_branch} に復帰
- **成果物**: ブランチ `feature/{feature-name}` on origin、PR {PR_URL}

### デプロイ詳細
- ブランチ: `feature/{feature-name}` → origin
- コミット数: {commit_count}件
- PR: {PR_URL}
- レビュー状況: Critical/High 発見事項は解決済み
- Linear: コメント投稿済み
```

---

## Completion Report

```markdown
## デプロイ完了: {feature}

- ブランチ: `feature/{feature-name}` → origin に push 済み
- PR: {PR URL}
- 現在のブランチ: `{original-branch}` に戻りました
- Linear: コメント追加済み

### 次のステップ
- PR をレビュー・マージしてください
```

---

## Tips

- すべての git 操作は Gemini サブエージェント経由で実行される
- **PR 作成は `gh` CLI を使用する**（GitHub MCP の `create_pull_request` は不安定なため）
- push 前に必ず品質チェックを確認する
- origin/main とのコンフリクトがある場合はリベースで解消してから PR を作成する
- 元のブランチに戻れない場合は `git checkout main` にフォールバック
