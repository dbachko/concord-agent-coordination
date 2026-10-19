# Verification record

Release checks on 2026-10-19:

- 62 automated tests across six files passed: domain, HTTP API, privacy, lifecycle, GPU constraints, decisions and opportunity watches.
- TypeScript and production build passed. Formatting passed.
- A clean source copy without credentials, private state or installed dependencies passed `npm ci`, build, startup and HTTP checks. Default live calls were disabled.
- Isolated HTTP smoke passed: match, infeasible equal split, feasible counterproposal, both exploration responses, dual final approval, constraint change, new-version consent and withdrawal.
- Desktop and mobile were inspected in a real browser. The plan precedes the action on mobile, with no horizontal overflow. Private controls, sources and history are collapsed. Ambiguous availability bars were replaced by a labeled offered-hours table.

## Integration evidence

Composio project-key authentication and read-only metadata queries succeeded. A narrowed Google Sheets auth config was created and an owner-specific hosted OAuth flow started. Google rejected the attempted provider authorization with “This app is blocked.” The application did not obtain a completed Google Sheets grant. A selected synthetic sheet is also not yet available. No live workload read is claimed. OAuth attempts stopped after that denial; no broader scope or alternate route to the same data was attempted.

Parallel's live adapter is implemented. No successful Parallel Search API call is recorded at this checkpoint.

Default research and workload modes remain explicit fixtures. The provider envelope, price, availability, permission for separate users and isolation are synthetic or unverified. Live errors never silently switch to fixtures. Use the verification commands to record fresh evidence in your own environment.

No host rental, payment, code deployment or third-party message is implemented. Public source publication does not deploy the service.

The compact agent-negotiation view uses actual offer, private-policy rejection, counteroffer and consensus events. Additional tests verify no fabricated rejection/counter when the first offer passes, no consensus when both permitted policies fail, and no automatic owner approval. Isolated HTTP verification confirmed the four-event $6/$6 → rejection → $4/$8 → policy-consensus path. The recording worker owns the visual pickup; no new browser inspection is claimed here.
