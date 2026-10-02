# Elega documentation

| Document | What it covers |
| --- | --- |
| [architecture.md](architecture.md) | System context, containers, modules, request lifecycle, sequences, deployment |
| [adr/](adr/) | Architecture decision records |
| [database.md](database.md) | Conventions, ER diagrams, module ownership, indexes, retention, partitioning, roles |
| [../apps/api/migrations/](../apps/api/migrations/) | SQL migrations (PostgreSQL 16), applied by `pnpm db:migrate` |
| [api/openapi.yaml](api/openapi.yaml) | REST API draft, OpenAPI 3.1 |
| [api/realtime-events.md](api/realtime-events.md) | Socket.IO event contract |
| [authorization-matrix.md](authorization-matrix.md) | Who may do what; source for generated policy tests |
| [design-directions.md](design-directions.md) | Three visual directions to choose from |
| [scaffolding-plan.md](scaffolding-plan.md) | Monorepo layout, tooling, scripts, CI for M0 |
| [progress.md](progress.md) | Milestone status log |
