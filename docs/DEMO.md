# GPU sharing example

Main: http://127.0.0.1:4317. Isolated tests: port 4318. Both currently use mock integrations, simulated provider data and real local logic. No live API success is claimed.

## Live local execution

Choose **Inspect step by step**, submit Alice and Bob with **Find a match**, then press **Run next step**. The first click computes Bob's equal-split offer; the next executes Alice's private check and rejection; the next computes her usage-based counteroffer; subsequent clicks execute acceptance and consensus. Owner exploration and final approval remain separate. **Use automatic mode** runs the remaining operations immediately without fake timing. New events arrive over the authenticated stream; existing history retains its original timestamps.

Only local policy execution is live here. Provider prices and workloads are explicitly synthetic; this is not an LLM conversation or proof of external API success.

## Walkthrough

1. Alice opts into a watch for a selected public-demo workload: one whole GPU, 24 GB VRAM, 60 minutes, US West, Saturday 9am–5pm Pacific, synthetic private $5 limit. No active Alice request exists.
2. Seed Bob's separately authorized synthetic request: one GPU, 24 GB VRAM, 120 minutes, same region/date, 10am–5pm, private synthetic $9 limit.
3. The real local service emits one opportunity: “This might interest you. Would you like to check it?” Dot receives its actual ID and relevance reason through the local relay. No savings claim is shown.
4. User chooses explore, dismiss or pause through dot. Explore creates Alice's selected request and returns an actual negotiation decision.
5. Dot presents the proposal and feasible time alternatives. The mock fixture rejects a $6/$6 equal split and proposes $4/$8 by GPU-minutes. These are invented planning figures, not prices or savings.
6. The visible **Agent negotiation** section records Bob’s equal-split proposal, Alice’s private-policy rejection, Alice’s usage-based counteroffer, and both agents’ policy consensus. These are deterministic policy-agent events, not generated conversation. They occur before owner exploration and final approval.
7. A user can counter with a later time or different feasible cost split. This creates a new exact version and clears earlier consent. Both owners then choose whether to continue exploring it.
8. Only after both exploration responses does each receive a separate final-agreement question. Both exact-version final approvals produce “Agreement reached, awaiting booking authorization.” Nothing is booked.

See DOT-RELAY.md for strict input schemas and commands. The parent dot task acts as the actual transport by delegating these local commands and reporting returned JSON. A local UI test alone is not proof of the main conversation's completed user-response loop.

## Standalone console

Only one demo owner's private controls are visible at a time; Alice/Bob buttons select synthetic identities. The shared proposal shows public selected windows, proposed separate whole-GPU assignments, mock total and cost split. It never shows both private budgets. Device assignments are proposed separate whole devices, not actual allocations or secure tenant isolation. Plan details show offered hours and the proposed session as a labeled table.

- **Explore opportunity** starts evaluation; **Dismiss** deduplicates that watch/request pair.
- **Watch for opportunities**, **Pause**, **Resume** control only the local selected-interest watch. No production monitor is installed.
- **Continue exploring · vN** records intermediate consent only.
- **Request a change** offers feasible times and a typed counteroffer form.
- **Approve final agreement · vN** appears only after both exploration responses.
- **Decline proposal** stops that proposal without silently withdrawing the selected request.
- **Edit private constraints** changes selected GPU/VRAM/runtime/date/window/region/budget requirements and invalidates old approvals.
- **Withdraw** cancels; **Test expiry** closes the approval window.
- **Activity** expands actual events; evidence and provider assumptions are collapsed.
- **Reset demo** invalidates all synthetic IDs; do not use it while waiting on a main-chat response.

Mocks remain clearly labeled. Provider tenancy permission, secure isolation, actual capacity, price and availability are unverified. No single GPU is sliced, code deployed, host rented, payment made or external message sent.
