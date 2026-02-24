# edo-2026

<!-- Sections below added by migrate-skills.py -->

---

## Rules & Standards

Coding standards enforced via `.claude/rules/`:

| Rule | Content |
|------|---------|
| `language.md` | English code, Japanese communication |
| `coding-principles.md` | Simplicity, single responsibility, early return |
| `testing.md` | TDD, AAA pattern, 80%+ coverage |
| `security.md` | Input validation, secrets management |

PostToolUse hook: auto lint/format on file changes.

## Skills

| Command | Description |
|---------|-------------|
| `/plan` | Step-by-step implementation planning |
| `/tdd` | Test-Driven Development workflow |
| `/simplify` | Code simplification |
| `/design-tracker` | Track design decisions automatically |
| `/update-design` | Update design document |

Design decisions: `.claude/docs/DESIGN.md`

## Documentation Management

| Command | Description |
|---------|-------------|
| `/research-lib` | Research libraries and save findings |
| `/update-lib-docs` | Update library constraint docs |

Library docs: `.claude/docs/libraries/`

## Multi-Agent Collaboration

| Agent | Strength | Use For |
|-------|----------|---------|
| **Claude Code** | 1M context, orchestration | Codebase analysis, implementation |
| **Codex CLI** | Deep reasoning | Design decisions, debugging, trade-offs |
| **Gemini CLI** | Google Search, multimodal | External research, PDF/video/audio |

### When to Use

- **Design/debug** → Codex (`/codex-system`)
- **External research** → Gemini (`/gemini-system`)
- **Codebase analysis** → Gemini subagent (`gemini-explore`)

### Context Management

| Output Size | Method |
|-------------|--------|
| Short (~50 lines) | Direct call OK |
| Large (50+ lines) | Via subagent |
| Reports | Subagent → save to `.claude/docs/` |

→ `.claude/rules/codex-delegation.md`, `.claude/rules/gemini-delegation.md`, `.claude/rules/tool-routing.md`

## Workflow

```
/startproject <feature>     Understand → Research & Design → Plan
    ↓ approval
/team-implement             Parallel implementation (Agent Teams)
    ↓ completion
/team-review                Parallel review (Agent Teams)
    ↓ completion
/deploy                     Push feature branch & return to original branch
```

| Command | Description |
|---------|-------------|
| `/startproject` | Multi-agent project initialization |
| `/team-implement` | Parallel implementation with Agent Teams |
| `/team-review` | Parallel code review with Agent Teams |
| `/deploy` | Push feature branch, return to original branch |

## Session Management

| Command | Description |
|---------|-------------|
| `/checkpointing` | Save session context and learnings |
| `/init` | Initialize project settings |

Checkpoints: `.claude/checkpoints/` | Logs: `.claude/logs/`
