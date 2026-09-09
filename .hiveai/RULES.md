# H!veAI GitHub-first rules

This repository uses the GitHub-first tracking contract v3.

- The tracked GitHub branch is the authoritative source for current milestone, task, workflow state, required actor, next action, blockers, progress, and completion claims.
- H!veAI must read \`.hiveai/PROJECT.json\`, the v3 machine block in \`.hiveai/TASKS.md\`, \`.hiveai/RULES.md\`, and append-only \`.hiveai/EVENTS.jsonl\` from the tracked remote branch.
- Local folders are execution workspaces only. Local STATE, HANDOFF, watcher projections, first-open tasks, and provider self-assessment never override remote truth.
- Remote failure uses the last successful GitHub snapshot with a stale timestamp. With no cache, report UNAVAILABLE. Never fall back to local task files for current truth.
- Progress is emitted only with an exact scope and internally consistent completed/total/percent values; otherwise all progress fields are null.
- State-changing work must update TASKS and EVENTS, commit, and push the tracked branch before claiming completion.
- Builders implement; independent auditors verify. Secrets, tokens, and destructive live provider actions stay out of repository evidence.
- Preserve historical project-specific governance and docs outside these four canonical v3 files.

