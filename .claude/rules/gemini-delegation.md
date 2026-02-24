# Gemini Delegation Rule

**Gemini CLI is your external information and multimodal specialist.**

## Role Division

| Task | Agent |
|------|-------|
| コードベース分析 | **Gemini サブエージェント**（`gemini-explore` or `general-purpose`） |
| ライブラリ調査 | Gemini（外部Web検索） |
| 最新ドキュメント検索 | Gemini（Google Search） |
| マルチモーダル | Gemini |
| 設計判断 | Codex |

## Context Management

| 状況 | 推奨方法 |
|------|----------|
| 短い質問・短い回答 | 直接呼び出しOK |
| コードベース分析 | サブエージェント経由（`gemini-explore` 推奨） |
| ライブラリ調査 | サブエージェント経由（出力が大きい場合） |
| マルチモーダル処理 | サブエージェント経由 |
| Agent Teams 内での調査 | Teammate が直接呼び出し |

## About Gemini

Gemini CLI excels at:
- **Codebase analysis** — Repository structure, architecture, cross-module analysis
- **Google Search grounding** — Access latest information, official docs
- **Multimodal processing** — Video, audio, PDF analysis
- **Web research** — Library comparison, best practices, API specs

**Gemini does NOT excel at** (use Claude/Codex instead):
- Design decisions (Codex)
- Debugging (Codex)
- Code implementation (Claude)

## Adaptive Execution

> 参照: `.claude/rules/adaptive-execution.md`

タスクサイズに応じて Gemini の利用を適応させる：

| Tier | Gemini 利用 |
|------|------------|
| **XS** | 不要 |
| **S** | 不要 |
| **M** | 未知のライブラリ・外部 API が関わる場合**のみ** |
| **L** | 標準（Researcher teammate or サブエージェント） |

**重要**: 外部調査が不要なタスクでは Gemini を起動しない。内部リファクタリング、既知のパターン適用、設定変更などは Gemini 不要。

## When to Consult Gemini

Consult Gemini when **external information is actually needed**:

1. **External information** - Latest docs, library updates, API specs
2. **Library research** - Comparison, best practices, known issues
3. **Multimodal tasks** - Video, audio, PDF content extraction
4. **Codebase analysis** - Repository-wide architecture (large scope only)

### Trigger Phrases (User Input)

| Japanese | English |
|----------|---------|
| 「コードベースを理解して」「アーキテクチャ分析して」 | "Analyze the codebase" "Understand the architecture" |
| 「調べて」「リサーチして」「調査して」 | "Research" "Investigate" "Look up" |
| 「このPDF/動画/音声を見て」 | "Analyze this PDF/video/audio" |
| 「最新のドキュメントを確認して」 | "Check the latest documentation" |
| 「〜について情報を集めて」 | "Gather information about X" |

## When NOT to Consult

Skip Gemini for:

- Design decisions → Codex
- Debugging → Codex
- Code implementation → Claude
- Simple file operations → Claude

## How to Consult

### In Agent Teams (Preferred for /startproject)

Researcher Teammate が Gemini を直接呼び出し、Architect Teammate と双方向通信する。

### Subagent Pattern: Codebase Analysis

```
Task tool parameters:
- subagent_type: "gemini-explore"  (preferred for codebase analysis)
- run_in_background: true
- prompt: |
    Analyze: {analysis target}

    Use Gemini CLI with --include-directories to analyze the codebase:
    gemini -p "{analysis question}" --include-directories . 2>/dev/null

    Save full output to: .claude/docs/research/{topic}.md
    Return CONCISE summary (key findings + architecture insights).
```

### Subagent Pattern: External Research

```
Task tool parameters:
- subagent_type: "general-purpose"
- run_in_background: true (for parallel work)
- prompt: |
    Research: {topic}

    gemini -p "{research question}" 2>/dev/null

    Save full output to: .claude/docs/research/{topic}.md
    Return CONCISE summary (5-7 bullet points).
```

### Direct Call (Short Questions Only)

```bash
gemini -p "Brief question" 2>/dev/null
```

## CLI Commands Reference

```bash
# External research
gemini -p "{question}" 2>/dev/null

# Multimodal
gemini -p "{prompt}" < /path/to/file.pdf 2>/dev/null

# JSON output
gemini -p "{question}" --output-format json 2>/dev/null
```

## Language Protocol

1. Ask Gemini in **English**
2. Receive response in **English**
3. Subagent/Teammate summarizes and saves full output
4. Main reports to user in **Japanese**
