hiveaiDashboardSchema: hiveai-project-dashboard/v1
projectKey: packlab-3d
repository: Sekiph82/PackLab-3D
branchPolicy: main
dashboardMode: source-map
trackingMode: canonical-control-plane-v1
refreshPolicy: watcher-first-500ms-plus-60s-reconcile

## Source authorities

Canonical task source: `tasks.md`
Handoff source: `.hiveai/HANDOFF.md`
Roadmap source: `tasks.md`
Progress/history source: `.hiveai/EVENTS.jsonl`
Architecture source: `.hiveai/PROJECT.json`
Decision/governance source: `.hiveai/RULES.md`
Agent instruction source: `.hiveai/RULES.md`
Build/test metadata: `.hiveai/STATE.json`
