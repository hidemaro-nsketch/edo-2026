#!/usr/bin/env python3
"""
PreToolUse hook: Enforce tool routing rules.

Detects Bash commands that should be routed through a Gemini subagent
(git operations, docker, ruff, uv dependency management) and injects
a strong routing reminder into Claude's context.

NOTE: Uses additionalContext instead of decision:block because hooks
apply project-wide, including to subagents that legitimately need to
run these commands after Gemini consultation.
"""

import json
import re
import sys

# Git subcommands that MUST be routed through Gemini subagent
ROUTED_GIT_SUBCOMMANDS = {
    "commit",
    "push",
    "pull",
    "merge",
    "rebase",
    "checkout",
    "switch",
    "branch",
    "log",
    "diff",
    "stash",
    "cherry-pick",
    "reset",
    "tag",
    "fetch",
    "clone",
    "remote",
    "am",
    "format-patch",
}

# Git subcommands that are ALLOWED directly (informational / read-only)
ALLOWED_GIT_SUBCOMMANDS = {
    "status",
}

# Patterns for allowed git usage (informational context only)
ALLOWED_GIT_PATTERNS = [
    re.compile(r"^git\s+status\b"),
    re.compile(r"^git\s+branch\s+--show-current\b"),
    re.compile(r"^git\s+rev-parse\b"),
    re.compile(r"^git\s+config\s+--get\b"),
    re.compile(r"^git\s+remote\s+-v\b"),
]

# Other commands that must be routed through Gemini subagent
ROUTED_COMMAND_PATTERNS = [
    (re.compile(r"^docker(?:\s|-)"), "Docker operations"),
    (re.compile(r"^docker-compose\b"), "Docker operations"),
    (
        re.compile(r"^(?:uv\s+run\s+)?ruff\s+(?:check|format)\b"),
        "Lint/format execution",
    ),
    (re.compile(r"^uv\s+(?:add|remove|sync|lock)\b"), "Dependency management"),
]

GEMINI_SUBAGENT_TEMPLATE = (
    "Task tool (subagent_type: 'general-purpose') with prompt: "
    '`gemini -p "Plan: {task}" 2>/dev/null` then execute commands.'
)


def extract_git_subcommand(command: str) -> str | None:
    """Extract the git subcommand from a command string."""
    match = re.search(r"\bgit\s+(\w+)", command)
    if match:
        return match.group(1)
    return None


def is_allowed_git(command: str) -> bool:
    """Check if this git command is in the allowed list."""
    cmd_stripped = command.strip()
    for pattern in ALLOWED_GIT_PATTERNS:
        if pattern.search(cmd_stripped):
            return True
    return False


def check_routed_command(command: str) -> tuple[bool, str]:
    """Check if this command matches a routed pattern (non-git)."""
    cmd_stripped = command.strip()
    for pattern, category in ROUTED_COMMAND_PATTERNS:
        if pattern.search(cmd_stripped):
            return True, category
    return False, ""


def analyze_command(command: str) -> tuple[bool, str, str]:
    """Analyze a bash command for routing violations.

    Returns: (is_violation, category, details)
    """
    cmd_stripped = command.strip()

    # Check for git commands
    git_subcmd = extract_git_subcommand(cmd_stripped)
    if git_subcmd:
        if is_allowed_git(cmd_stripped):
            return False, "", ""
        if git_subcmd in ROUTED_GIT_SUBCOMMANDS:
            return True, "Git operation", f"`git {git_subcmd}`"
        # Unknown git subcommand - warn anyway
        if git_subcmd not in ALLOWED_GIT_SUBCOMMANDS:
            return True, "Git operation", f"`git {git_subcmd}`"

    # Check for other routed commands
    is_routed, category = check_routed_command(cmd_stripped)
    if is_routed:
        return True, category, cmd_stripped.split()[0]

    return False, "", ""


def main():
    try:
        data = json.load(sys.stdin)
        tool_input = data.get("tool_input", {})
        command = tool_input.get("command", "")

        if not command:
            sys.exit(0)

        is_violation, category, details = analyze_command(command)

        if is_violation:
            output = {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "additionalContext": (
                        f"**TOOL ROUTING VIOLATION** [{category}]: "
                        f"Detected {details} being executed directly. "
                        "Per .claude/rules/tool-routing.md and CLAUDE.md, "
                        f"{category.lower()} MUST be routed through a Gemini subagent. "
                        "Do NOT execute this command directly from the main agent. "
                        f"Instead use: {GEMINI_SUBAGENT_TEMPLATE} "
                        "Exceptions: `git status`, `git branch --show-current` (informational only)."
                    ),
                }
            }
            print(json.dumps(output))

        sys.exit(0)

    except Exception as e:
        print(f"Hook error: {e}", file=sys.stderr)
        sys.exit(0)


if __name__ == "__main__":
    main()
