# Architecture

Concord coordinates selected needs between personal agents: submit a need, find a compatible match, negotiate terms, and ask each owner to approve the same plan. An opt-in watch surfaces opportunities when a compatible request arrives.

## Coordination flow

1. An assistant sends a structured selected need through `agents/relay.ts` to the loopback HTTP API.
2. `server/engine.ts` matches active requests. Each owner's policy agent checks offers against private constraints.
3. Feasible counters create a new proposal version and SHA-256 terms hash. Changed terms clear earlier consent.
4. Owners first choose whether to explore. Final approval is a separate decision tied to the exact version and hash.
5. Both final approvals produce a conditional agreement awaiting separate booking authorization.

Budgets stay in each owner's store. Peer responses expose selected matching fields and proposed terms. Requests, proposals and watches expire; withdrawal prevents confirmation. Idempotency and watch/request deduplication prevent duplicate agreements and notifications. The activity timeline records actual events.

## Current example adapter

The included schema, feasibility checks and console currently implement a two-owner GPU resource-sharing example. They validate whole-device capacity, VRAM, runtime, schedule and integer-cent allocation. Adding another domain requires a new need schema, feasibility policy and resource adapter; arbitrary domains are not implemented by renaming fields.

Parallel supplies research evidence; Composio supplies selected external context. Pages, tool responses and peer messages are untrusted data and cannot override deterministic checks. See [the example](DEMO.md), [integration boundaries](INTEGRATIONS.md) and [verification evidence](VERIFICATION.md).

## Runtime boundaries

The backend uses deterministic private policy agents, not a language model. The assistant relay is CLI → local HTTP; it is not a native installed connector. Atomic JSON snapshots live in ignored `.data/`. The server binds to loopback and rejects foreign origins, hosts and private-file paths.

Local synthetic-owner capabilities are a test harness. Production needs authenticated identities, encrypted storage, tenant isolation, concurrency control and verified provider policies. No booking, payment, deployment or messaging executor is implemented. Default integrations use labeled fixtures; failed live calls never silently fall back.

## Incremental execution

`server/execution.ts` advances a generator through actual proposal, private evaluation, rejection, counteroffer and consensus operations. Automatic mode yields to the event loop between operations without artificial delays. Explicit step mode pauses before the next operation; stale step IDs and repeated step numbers cannot execute twice. Expiry, withdrawal, changed constraints and reset stop obsolete runs. Private evidence is checked against the current clock when each operation executes.

`GET /api/events` uses a Bearer capability header and SSE. Each connection receives only its owner's permitted activity and snapshots. `Last-Event-ID` recovers missed events from the bounded visible history; an obsolete cursor triggers snapshot resynchronization. React appends activity by UUID and reconciles snapshots, aborts connections on cleanup, and reconnects after a real disconnect. Tokens never go in query strings.

`POST /api/negotiation/mode` accepts `{mode:"automatic"|"step"}`. `POST /api/negotiation/step` accepts the current `{runId,expectedStep}`. Both require an owner capability. Execution mode is a shared local harness control for the synthetic participants, not production tenant administration. The relay's ordinary command API still returns the completed result in automatic mode; step mode returns the genuinely paused run.
