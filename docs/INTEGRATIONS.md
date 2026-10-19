# Integrations and setup

The current example coordinates two selected public-demo GPU workloads. The resource envelope, capacity, schedule and price are synthetic. They are not confirmed provider offers. See [the example script](DEMO.md) and [verification record](VERIFICATION.md).

| Component       | Current behavior                                                                                                      |
| --------------- | --------------------------------------------------------------------------------------------------------------------- |
| Parallel        | Search API adapter for candidate GPU hosts, pricing units, policies and isolation; preserves source URLs and excerpts |
| Composio        | `GOOGLESHEETS_BATCH_GET`, pinned to each owner's read-only auth config, connection and selected `Workload!A1:B4`      |
| Assistant relay | Local CLI/HTTP transport for an existing assistant                                                                    |
| Provider        | Synthetic two-GPU host; no verified availability, price, tenancy permission or secure isolation                       |

No single GPU is divided. Device visibility is not a tenant security boundary. Final agreement is a proposed plan, not a reservation or allocation.

## Configure live reads

Copy `.env.example` to `.env`. Keep credentials server-side and out of source control.

- Set `PARALLEL_API_KEY` for Parallel research.
- Follow [Composio setup](COMPOSIO-SETUP.md) for a demo-only Google Sheets account, narrowed provider grant, separate owner mappings and selected synthetic workload sheets.
- Set `ALLOW_LIVE_CALLS=true` and the desired integration mode to `live`, then restart. Both live modes and `REQUIRE_LIVE_INTEGRATIONS=true` enable the full live-required path.

```sh
ALLOW_LIVE_CALLS=true npm run verify:composio -- alice
ALLOW_LIVE_CALLS=true PARALLEL_MODE=live COMPOSIO_MODE=live npm run verify:live
```

Reports go to ignored `.data/` without credentials or connection identifiers. One owner's successful read does not verify the other owner, research or provider availability. Defaults use explicit fixtures. No successful live data retrieval is claimed without a verification result.

## Isolated rehearsal

```sh
PORT=4318 REQUIRE_LIVE_INTEGRATIONS=false PARALLEL_MODE=fixture COMPOSIO_MODE=fixture npm run dev
# In another terminal:
npm run smoke
```

The smoke test resets only the disposable 4318 instance. Keep the main instance intact while waiting for an owner's response.
