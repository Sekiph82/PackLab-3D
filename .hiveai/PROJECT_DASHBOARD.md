---
hiveaiDashboardSchema: hiveai-project-dashboard/v1
projectKey: packlab-3d
repository: Sekiph82/PackLab-3D
branchPolicy: main
dashboardMode: source-map
refreshPolicy: watcher-driven source invalidation; no generated status commits
---

# H!veAI Project Dashboard Manifest

This file is a pointer map for H!veAI. It is not a task ledger and must not duplicate task checkboxes.

## Project identity

Project: PackLab 3D
Repository: `Sekiph82/PackLab-3D`
Default branch: `main`

## Source authorities

Canonical task source: `tasks.md`
Handoff source: `handoff.md`
Roadmap source: none verified
Progress/history source: none verified
Architecture source: none verified
Design/brand sources: `PackLab3D_BrandIdentity.md` and other project design notes as secondary context
Decision source: none verified
Agent instruction source: `claude.md`
Security source: none verified
Build/test metadata: `build_all.bat`, `build_backend.bat`, `build_frontend.bat`, project package/manifests and scripts

## Authority notes

Keep the existing lowercase filenames `tasks.md`, `handoff.md`, and `claude.md`; exact casing is part of repository truth and should not be renamed only for consistency.

`tasks.md` is task authority. `handoff.md` supplies current/next/blocker/waiting context. Brand/design documents are secondary context only.

## Refresh model

H!veAI should derive live state from Registry/Git/watcher evidence plus the canonical sources above. This manifest should remain pointer-only and should not be rewritten as a generated status snapshot.
