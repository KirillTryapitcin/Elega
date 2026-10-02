# ADR-001: Modular monolith, not microservices

Status: Accepted · 2026-10-02

## Context
Two people (Kirill and Claude) build and operate Elega. The MVP has 16 domain modules with
heavy cross-module reads (every content query needs relationships and blocks). Launch
traffic is a closed alpha of 20–50 users growing to a few thousand in beta.

## Decision
One NestJS application with strict module boundaries, deployed as two process types from
the same image: `api` (HTTP + WebSocket) and `worker` (BullMQ). Rules:
- A module exposes one public service; other modules import only that.
- No module reads another module's tables. Enforced by an ESLint import-boundary rule
  (`eslint-plugin-boundaries`) and by repository classes living inside their module.
- Cross-module side effects go through domain events written to `outbox` in the same
  transaction and relayed to a Redis stream for workers.

## Consequences
- One deploy, one database, local transactions, simple debugging.
- Boundary discipline is a lint rule, not a network; it must stay enforced in CI.
- A hot module (media processing, chat gateway) can be split into its own deployable later
  because it already talks through events and a service interface.

## Alternatives considered
- Microservices: distributed transactions, N deploy pipelines and service discovery for a
  two-person team. Rejected.
- Unstructured monolith: fastest at first, but the block/visibility rules would leak into
  every module. Rejected.
