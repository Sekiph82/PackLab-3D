# H!veAI mandatory control-plane adapter

Before any project work, read `.hiveai/RULES.md`, `.hiveai/PROJECT.json`, `.hiveai/STATE.json`, `.hiveai/HANDOFF.md`, and the canonical task source declared in PROJECT.json.

After every meaningful task/workflow/audit/session state change, synchronize canonical task source + STATE.json + HANDOFF.md + EVENTS.jsonl before finishing.

Do not create a competing task ledger. Provider-specific behavior must not change H!veAI state semantics.

# Project-specific Codex instructions
