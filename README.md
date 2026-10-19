# Concord

Coordination for personal agents. Share selected needs, find compatible opportunities, negotiate terms, and ask owners to approve a plan. Private constraints stay with each owner; an opt-in watch surfaces new matches.

## Local development

Requires Node.js **22.22.3+**, npm, and a POSIX shell for the commands below. Use the committed lockfile.

```sh
git clone https://github.com/dbachko/concord-agent-coordination.git
cd concord-agent-coordination
npm ci
cp .env.example .env
npm run dev
```

Open <http://127.0.0.1:4317>. Defaults run locally with labeled fixture integrations and no API keys. Matching, negotiation, versioned consent, expiry and cancellation execute in the backend. No model key is required.

Keep `.env` and `.data/` private. Edit `.env` server-side and restart the service after changing configuration. Never put keys in frontend code or commit them.

## Environment

| Variable                                                                   | Purpose                                                                                                                                                                |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                                                                     | Loopback HTTP port; defaults to `4317`.                                                                                                                                |
| `PARALLEL_MODE`                                                            | `fixture` (default) or `live` research.                                                                                                                                |
| `PARALLEL_API_KEY`                                                         | Required only for live Parallel Search API calls.                                                                                                                      |
| `COMPOSIO_MODE`                                                            | `fixture` (default) or `live` selected-context reads.                                                                                                                  |
| `COMPOSIO_API_KEY`                                                         | Composio **Platform project key**, required for live Composio calls. This does not grant access to an owner's Google data.                                             |
| `COMPOSIO_GOOGLESHEETS_AUTH_CONFIG_ID`                                     | Read-only Google Sheets auth config in that same Composio project.                                                                                                     |
| `COMPOSIO_ALICE_USER_ID`, `COMPOSIO_BOB_USER_ID`                           | Stable application owner IDs used when creating each owner's connection.                                                                                               |
| `COMPOSIO_ALICE_CONNECTED_ACCOUNT_ID`, `COMPOSIO_BOB_CONNECTED_ACCOUNT_ID` | Each owner's authorized, **ACTIVE** Google Sheets connection, belonging to that owner ID.                                                                              |
| `COMPOSIO_ALICE_WORKLOAD_ID`, `COMPOSIO_BOB_WORKLOAD_ID`                   | Selected synthetic spreadsheet IDs; the current adapter reads only `Workload!A1:B4`. These are spreadsheet IDs, not account or auth-config IDs.                        |
| `ALLOW_LIVE_CALLS`                                                         | Must equal `true` before either live adapter makes remote calls; defaults to `false`.                                                                                  |
| `REQUIRE_LIVE_INTEGRATIONS`                                                | `true` requires both live modes and successful evidence before the full approval flow. It does not enable network calls or configure credentials. Defaults to `false`. |

Fixture mode ignores the corresponding credentials. Each live adapter needs its own configuration plus `ALLOW_LIVE_CALLS=true`; failures never silently switch to fixtures. The full two-owner live path needs both owner mappings.

For Composio, create the project key and auth config, then let each owner complete OAuth. A generated link or `INITIATED` account is insufficient. Use demo-only data and the narrowed `spreadsheets.readonly` plus `userinfo.email` grant. See [Composio setup](docs/COMPOSIO-SETUP.md) for permissions, sheet format and connection steps.

Additional process overrides: `STATE_FILE` selects the server snapshot path; otherwise it uses a port-specific file under `.data/`. `CONCORD_URL` selects the relay's loopback server, and `SMOKE_URL` selects the smoke-test URL. Pass these on the command line; the relay does not load `.env` itself.

## Commands

| Command                           | Purpose                                                |
| --------------------------------- | ------------------------------------------------------ |
| `npm run dev`                     | Backend plus Vite development middleware.              |
| `npm run build`                   | TypeScript check and frontend production build.        |
| `npm start`                       | Serve the production build locally; run `build` first. |
| `npm test` / `npm run test:watch` | Run the automated suite / watch tests.                 |
| `npm run check`                   | Tests and production build.                            |
| `npm run format:check`            | Check formatting; `npm run format` applies it.         |

To verify authorized live reads after configuration:

```sh
ALLOW_LIVE_CALLS=true npm run verify:composio -- alice
ALLOW_LIVE_CALLS=true PARALLEL_MODE=live COMPOSIO_MODE=live npm run verify:live
```

The first checks only Alice's selected context. The second checks Parallel and both owners. Reports go to ignored `.data/`. In the UI, the live-required flow also needs successful research and a selected source-backed candidate before delegation. Research evidence does not confirm price or availability.

For an isolated fixture smoke test, start a separate instance, then run the smoke command in another terminal:

```sh
PORT=4318 REQUIRE_LIVE_INTEGRATIONS=false PARALLEL_MODE=fixture COMPOSIO_MODE=fixture npm run dev
npm run smoke
```

The smoke test resets only port `4318`; it must not target an active owner session.

## Integrate a personal assistant

An assistant sends structured selected needs and explicit owner responses through the local CLI/HTTP relay:

```sh
npm run --silent agent -- status alice
CONCORD_URL=http://127.0.0.1:4318 npm run --silent agent -- status alice
```

[The relay contract](docs/DOT-RELAY.md) covers submission, watches, counters, withdrawal and exact-version approvals. The current local session issuer is a synthetic-owner harness; production needs authenticated owner identity. Concord is not installed as a native assistant connector.

## Code and implementation scope

- `server/`: HTTP API, matching, proposal lifecycle, persistence and integrations.
- `agents/`: private policy checks and assistant relay.
- `src/`: React/TypeScript console.
- `tests/`: feasibility, privacy, consent, expiry and idempotency checks.
- `docs/`: architecture, integration setup, examples and verification evidence.

The included resource schema and policies currently implement one example domain. Other domains require their own schema, feasibility policy and adapter. See [architecture](docs/ARCHITECTURE.md), [examples](docs/DEMO.md) and [integration boundaries](docs/INTEGRATIONS.md). No booking, payment or deployment executor is implemented.

## Integration status and troubleshooting

The local coordination flow is tested. Live adapters are implemented, but this release has no verified live Parallel search or Composio Sheets data read. Composio project authentication succeeded; Google blocked the attempted OAuth grant. See the [verification record](docs/VERIFICATION.md).

- **`LIVE_CALLS_PAUSED`:** enable the explicit guard only when live access is authorized.
- **Missing Composio configuration:** check the project key, auth-config ID, owner IDs, active connections and selected sheet IDs. They serve different purposes.
- **Google “This app is blocked”:** stop the flow. A project key cannot override Google's denial; use the supported OAuth configuration/support path in [Composio setup](docs/COMPOSIO-SETUP.md).
- **Port already in use:** choose another `PORT`; use the matching `CONCORD_URL` for relay commands.

MIT licensed. See [CONTRIBUTING.md](CONTRIBUTING.md).
