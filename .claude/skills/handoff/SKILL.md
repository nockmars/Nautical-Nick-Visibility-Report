---
name: handoff
description: Write a session handoff document — what was completed, what's in progress, known issues, and exact next-session instructions. Run before context clears or at end of a multi-feature session.
---

# Handoff

Produce a handoff doc so the next session (or the next person) can pick up cleanly.

## Steps

1. **Review work since last handoff.**
   - `git log --oneline <last-handoff-commit>..HEAD` (or last 30 commits if no marker)
   - `git status` — anything uncommitted?
   - Check open TodoWrite items in this session

2. **Categorize.** Bucket what you find into:
   - **Completed** — shipped, tested, deployed
   - **In Progress** — code written but incomplete, or blocked
   - **Known Issues / Bugs** — things you discovered but didn't fix
   - **Decisions Made** — non-obvious choices, with rationale
   - **Next Session: Start Here** — exact commands or steps to resume

3. **Write to `CLAUDE_HANDOFF.md`.**
   - Append a new section at the top with today's date as a `##` heading
   - Use the format below
   - Don't delete prior entries

## Format

```markdown
## Handoff — YYYY-MM-DD

### Completed
- <commit-hash> <short description> — what user-facing change shipped

### In Progress
- <file path> — what's done, what's not, blocker if any

### Known Issues / Bugs
- <where> — <what's broken> — severity (low/med/high)

### Decisions Made
- <decision> — <why> — <reversibility>

### Next Session: Start Here
1. <exact command or step>
2. ...
```

## After Writing

- Output the new section to the user so they can review
- If working on a long-lived branch, optionally `git add CLAUDE_HANDOFF.md && git commit -m "docs: handoff <date>"`
