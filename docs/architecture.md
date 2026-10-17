# HoldThat architecture

The browser talks to an Express service and real MCP endpoint on the same origin. Deterministic transitions own the checklist. SQLite persists one active session per opaque, HttpOnly browser cookie.

## Boundaries

- src/domain/index.ts: three authored dependency graphs, immutable transitions, explicit confirmations, transitive correction and next-step clarification.
- src/server/store.ts: transactional revision checks and request deduplication, persisted history and per-browser isolation.
- src/server/app.ts: constrained REST controls, Streamable HTTP MCP tools, same-origin/host checks, schema validation, request caps and model proposals.
- src/server/model.ts: optional Bedrock Converse adapter. Validated proposals cannot directly mutate state.
- src/client/main.ts: accessible form controls, real MCP client, progress review, correction, export, optional speech and clearly labelled model availability.

The MCP transport is stateless; domain state lives in SQLite. get_session, report_progress, interrupt_task and resume_task are the only tools. Confirmation and correction are explicit interface actions, not model tools.

## Progress semantics

A reported completion becomes uncertain with a pending confirmation. Started and uncertain states remain unresolved after interruption. Confirmation unlocks dependent steps. A correction resets dependent work without erasing previous events. Revision guards reject stale writes; an identical request retry returns current state without replaying its mutation.

Domain event timestamps are logical revisions. Database update/export timestamps are real wall-clock times; neither is proof that physical work occurred.

## Storage and hosting

The app uses one SQLite-backed server instance. Cloud hosting must retain /data and preserve a stable HTTPS origin. There is no multi-replica synchronization, login, cross-device transfer or production deployment yet. No paid provider is needed for manual controls; real Bedrock use remains a separate verification gate.
