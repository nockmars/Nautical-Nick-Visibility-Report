# Handoff

Review `git log --oneline -20` to see recent commits, then:

1. Summarize what was completed this session (bullet points, plain English)
2. List any in-progress or half-finished work
3. Note known issues, TODOs, or decisions deferred
4. State the recommended next action for the next session
5. Write everything to `CLAUDE_HANDOFF.md` with today's date as a header

Format:
```
## Handoff — YYYY-MM-DD

### Completed
- ...

### In Progress
- ...

### Known Issues / TODOs
- ...

### Next Session: Start Here
...exact commands or steps to resume...
```

After writing the file, output the full contents so the user can confirm before closing.
