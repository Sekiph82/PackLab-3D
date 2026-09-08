# H!veAI Project Control Rules v1

All tracked repositories use the same contract.

## Mandatory read order
1. `.hiveai/PROJECT.json`
2. `.hiveai/RULES.md`
3. `.hiveai/STATE.json`
4. `.hiveai/HANDOFF.md`
5. canonical task source from PROJECT.json
6. task-specific project documents

## Truth
- Canonical task ledger: `tasks.md`.
- STATE.json = current materialized state.
- HANDOFF.md = resume pointer.
- EVENTS.jsonl = append-only lifecycle history.
- Builder logs = CLAIM_ONLY; audits = independent evidence.
- Never create a second task ledger.

## Mandatory post-action sync
After meaningful task/workflow/audit/remediation/session/blocker/owner/release changes: update task source if truth changed, update STATE.json, update HANDOFF.md, append one EVENTS.jsonl row, then write standard prompt/log/audit artifacts if applicable.

Workflow states: IDLE, READY, IN_PROGRESS, AWAITING_AUDIT, CHANGES_REQUIRED, BLOCKED, WAITING_OWNER, COMPLETE.

Event schema: `{"schema":"hiveai-event/v1","eventId":"<id>","projectKey":"packlab-3d","type":"<type>","at":"<UTC>","actor":"CODEX|CLAUDE|CHATGPT|OWNER|SYSTEM","taskId":"<id|null>","workflowState":"<state>","summary":"<fact>","commit":"<sha|null>","auditId":"<id|null>","sessionId":"<id|null>"}`

## Refresh
H!veAI watches task source, PROJECT/STATE/HANDOFF/EVENTS, Git HEAD/index/refs, and standard artifact dirs. Filesystem changes refresh immediately with debounce; 60-second reconciliation is fallback only.
