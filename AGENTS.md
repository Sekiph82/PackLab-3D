# H!veAI mandatory control-plane adapter

Before doing project work, read `.hiveai/RULES.md`, `.hiveai/PROJECT.json`, and the v3 machine block in `.hiveai/TASKS.md`. The tracked GitHub branch is current-state authority; local folders are execution workspaces.

After every meaningful task/workflow/audit/session state change, update the v3 TASKS block and append-only EVENTS.jsonl, then commit and push the tracked branch before claiming completion.

Do not create a competing task ledger. Provider-specific behavior must not change H!veAI state semantics.

# Project-specific Codex instructions

## H!veAI GitHub tracking

- The repository root TASKS.md is the only current project-status tracker.
- Keep the Project Status fields and task rows current when work changes state.
- Commit and push TASKS.md with the implementation evidence that it describes.
- Do not create or revive .hiveai PROJECT/RULES/TASKS/STATE/HANDOFF/EVENTS files as a competing tracker.
