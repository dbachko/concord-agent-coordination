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
