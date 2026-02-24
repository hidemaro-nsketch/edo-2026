# Codex Delegation Rule

**Codex CLI is your highly capable supporter for deep reasoning.**

## Context Management (Opus 4.6)

Claude の 1M コンテキストにより、以前より直接呼び出しの許容範囲が拡大した。ただし大きな出力の場合はサブエージェント経由を推奨。

| 状況 | 推奨方法 |
|------|----------|
| 短い質問・短い回答（〜50行） | 直接呼び出しOK |
| 詳細な設計相談 | サブエージェント経由 |
| デバッグ分析 | サブエージェント経由 |
| Agent Teams 内での相談 | Teammate が直接呼び出し |

## About Codex

Codex CLI is an AI with exceptional reasoning and task completion abilities.
Think of it as a trusted senior expert you can always consult.

**When facing difficult decisions → Consult Codex.**

## Adaptive Execution

> 参照: `.claude/rules/adaptive-execution.md`

タスクサイズに応じて Codex の利用を適応させる：

| Tier | Codex 利用 |
|------|-----------|
| **XS** | 不要 — Claude が直接対応 |
| **S** | 不要 — 明確なパターンの場合。デバッグで原因不明な場合のみ相談 |
| **M** | サブエージェントで設計相談 |
| **L** | Agent Teams (Architect) or サブエージェント |

**重要**: タスクが XS/S の場合、Codex への相談はスキップしてよい。

## When to Consult Codex

Consult Codex for **M/L tier tasks** BEFORE:

1. **Design decisions** - How to structure code, which pattern to use
2. **Debugging** - If cause isn't obvious or first fix failed
3. **Implementation planning** - Multi-step tasks, multiple approaches
4. **Trade-off evaluation** - Choosing between options
5. **Code review** - Quality and correctness analysis

### Trigger Phrases (User Input)

| Japanese | English |
|----------|---------|
| 「どう設計すべき？」「どう実装する？」 | "How should I design/implement?" |
| 「なぜ動かない？」「原因は？」「エラーが出る」 | "Why doesn't this work?" "Error" |
| 「どちらがいい？」「比較して」「トレードオフは？」 | "Which is better?" "Compare" |
| 「考えて」「分析して」「深く考えて」 | "Think" "Analyze" "Think deeper" |

## When NOT to Consult

- Simple file edits (typo fixes, small changes)
- Following explicit user instructions
- Standard operations (git commit, running tests)
- Tasks with clear, single solutions
- Reading/searching files
- **Codebase analysis** → Gemini subagent handles this

## How to Consult

### In Agent Teams (Preferred for /startproject)

Architect Teammate が Codex を直接呼び出し、Researcher Teammate と双方向通信する。

### Subagent Pattern

```
Task tool parameters:
- subagent_type: "general-purpose"
- run_in_background: true (for parallel work)
- prompt: |
    Consult Codex about: {topic}

    codex exec --model gpt-5.3-codex --sandbox read-only --full-auto "
    {question for Codex}
    " 2>/dev/null

    Return CONCISE summary (key recommendation + rationale).
```

### Direct Call (Short Questions, up to ~50 lines response)

```bash
codex exec --model gpt-5.3-codex --sandbox read-only --full-auto "Brief question" 2>/dev/null
```

### Sandbox Modes

| Mode | Sandbox | Use Case |
|------|---------|----------|
| Analysis | `read-only` | Design review, debugging, trade-offs |
| Work | `workspace-write` | Implement, fix, refactor |

## Language Protocol

1. Ask Codex in **English**
2. Receive response in **English**
3. Execute based on advice
4. Report to user in **Japanese**
