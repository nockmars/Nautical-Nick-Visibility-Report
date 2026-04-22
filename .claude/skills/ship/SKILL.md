---
name: ship
description: Run tests, commit with a conventional commit message, push to current branch, then verify the Railway deployment succeeded. Use when ready to ship a logical unit of work.
---

# Ship

End-to-end shipping pipeline.

## Steps

1. **Run tests.** `npm test` (or the project's test command). If any fail, STOP and report which tests failed. Do NOT commit broken work.

2. **Lint.** `npm run lint` if available. Fix or report issues.

3. **Show what's changing.** Run `git status` and `git diff --stat`. If anything looks like a secret, accidental file, or out-of-scope change, STOP and ask the user before continuing.

4. **Stage explicitly.** `git add <specific files>`. Never `git add -A`.

5. **Commit.** Conventional commit (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`). Message describes the *why*, not the *what*. One commit per logical change.

6. **Push.** `git push origin <current-branch>`.

7. **Verify Railway deploy.** Wait for the deploy to complete:
   - Hit `https://nauticalnick.net/api/health` and confirm 200 with `{ status: "ok" }`
   - If 5xx, fetch Railway logs (or instruct the user how to check them) and STOP

8. **Brief HANDOFF update.** Append a one-line entry to `CLAUDE_HANDOFF.md` under today's date: what shipped + commit hash.

## Output Format

```
✅ Tests: <count> passed
✅ Commit: <sha> "<subject>"
✅ Pushed: <branch>
✅ Deploy: <status>
📝 Handoff updated
```

## Hard Rules

- Never `--no-verify` to skip hooks
- Never push to main if tests fail
- Never force push without explicit user confirmation
- If Railway deploy fails, do not retry blindly — investigate root cause
