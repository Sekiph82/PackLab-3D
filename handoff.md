# handoff.md — PackLab 3D

Claude must follow tasks.md exactly.

## Multilingual Requirements
- Claude must generate UI text in EN/TR/SW.
- Claude must create i18n files.
- Claude must ensure backend messages follow selected language.

## Workflow Rules
- No step skipping.
- Each module delivered with explanation + code + tests.
- User approval required before next stage.
- All UI strings must be placed in i18n files.

## Priority Order
1. Multilingual system
2. Backend API
3. Mesh pipeline
4. CAD pipeline
5. Label pipeline
6. UI
7. Export
8. Tests
9. Installer
