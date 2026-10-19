# Actual dot relay

Dot delegates a structured command to the connected Mac task. The task runs this CLI, reads the real loopback service response, and returns JSON to the same dot conversation. This is a local tool relay, not a native installed connector or simulated dot window.

Run from the project directory. Commands print JSON without capability tokens, provider keys or private budget limits. The local demo harness can select either synthetic identity; production needs actual owner authentication. Set `CONCORD_URL=http://127.0.0.1:4318` only for isolated tests.

## Selected interest → opportunity

```sh
npm run --silent agent -- watch-template alice > /tmp/alice-watch.json
# Review the selected requirements and opt-in before registering.
npm run --silent agent -- watch alice --file /tmp/alice-watch.json --key alice-watch-001
npm run --silent agent -- status alice
npm run --silent agent -- pause-watch alice
npm run --silent agent -- resume-watch alice
```

A watch contains only `{ "need": NEED, "optIn": true }`. It stores selected GPU count, VRAM, runtime, region, date/window and a private limit. It does not upload full assistant memory or create an active rental request. It expires after one hour. Compatible new requests trigger a deduplicated opportunity event for that owner. Dismissed watch/request pairs do not notify again; paused watches do not deliver opportunities.

A separately submitted **synthetic Bob** request can trigger the watch. This is seeded demo activity, never a genuine customer. `status alice` returns `opportunity_available`, a relevance reason, public candidate requirements, an expiry and the exact opportunity ID/revision. No savings are claimed.

After the user chooses explore or dismiss, save the exact response:

```json
{
  "ownerId": "alice",
  "opportunityId": "ACTUAL_OPPORTUNITY_UUID",
  "requestRevision": 1,
  "action": "explore"
}
```

```sh
npm run --silent agent -- opportunity alice --file /tmp/opportunity-response.json --key alice-opportunity-001
```

Explore checks the selected mock workload manifest, delegates the selected need and starts negotiation. It grants no exploration consent or final approval for the resulting proposal.

## Submit a selected need directly

```sh
npm run --silent agent -- template alice > /tmp/alice-need.json
npm run --silent agent -- submit alice --file /tmp/alice-need.json --key alice-request-001
npm run --silent agent -- update alice --file /tmp/alice-need-v2.json
npm run --silent agent -- proposals alice
npm run --silent agent -- cancel alice
```

Required `NEED` schema (additional fields rejected):

```json
{
  "region": "US West",
  "date": "2026-10-24",
  "window": { "start": 540, "end": 1020 },
  "gpuCount": 1,
  "minVramGb": 24,
  "runtimeMinutes": 60,
  "trustClass": "public-demo",
  "maxBudgetCents": 500,
  "consent": true
}
```

Times are Pacific minutes after midnight. Whole GPU count: 1–8; VRAM: 1–192 GB per GPU; runtime: 15–120 minutes; private budget: 100–200000 integer cents; region: US West or EU Central. Choose a future date. `template` generates a current-date example. `consent:true` requires authorization to delegate the selected synthetic need.

The user need not name a rental service. Current research/provider/workload inputs are explicitly mocked. The $12 host envelope and $4/$8 allocation are test data, not real prices, savings, capacity or offers.

## Pending decision → explicit user response

`status` returns `pendingDecision` with owner ID, decision ID, stage, expiry, concrete terms, feasible alternatives and an exact proposal reference:

```json
{
  "agreementId": "ACTUAL_AGREEMENT_UUID",
  "proposalId": "ACTUAL_PROPOSAL_UUID",
  "version": 1,
  "hash": "ACTUAL_64_CHARACTER_HASH"
}
```

Present these actual terms in dot. Do not infer acceptance from silence or an agent's policy check. At the **exploration** stage, the user's yes means only permission to continue exploring:

```json
{
  "ownerId": "alice",
  "decisionId": "ACTUAL_EXPLORATION_DECISION_UUID",
  "proposal": {
    "agreementId": "ACTUAL_UUID",
    "proposalId": "ACTUAL_UUID",
    "version": 1,
    "hash": "ACTUAL_HASH"
  },
  "answer": "explore"
}
```

```sh
npm run --silent agent -- respond alice --file /tmp/exploration-response.json --key alice-explore-001
```

Use `answer:"decline"` with `reject` to stop that proposal. Duplicate responses with the same key are idempotent. An ambiguous raw `yes` is not an API answer; dot maps it only to the stage and exact terms actually presented to the user.

For an alternative:

```json
{
  "ownerId": "alice",
  "decisionId": "ACTUAL_CURRENT_DECISION_UUID",
  "proposal": {
    "agreementId": "ACTUAL_UUID",
    "proposalId": "ACTUAL_UUID",
    "version": 1,
    "hash": "ACTUAL_HASH"
  },
  "alternativeId": "ACTUAL_CURRENT_ALTERNATIVE_UUID"
}
```

```sh
npm run --silent agent -- counter alice --file /tmp/counteroffer.json --key alice-counter-001
```

Alternatively supply `terms:{start,end,shares:{alice,bob},deviceAssignments?}` instead of `alternativeId`. The service validates private budgets, time, GPU assignments, VRAM and arithmetic. A feasible counter creates a new proposal ID/version/hash, clearing prior exploration and final approvals. Infeasible counters change no terms. Negotiation stops after six versions.

## Final agreement approval is separate

Only after **both** owners consent to explore identical current terms does each receive a `final_approval` decision. Present the exact final version again, then submit only that owner's explicit approval:

```json
{
  "ownerId": "alice",
  "decisionId": "ACTUAL_FINAL_DECISION_UUID",
  "agreementId": "ACTUAL_AGREEMENT_UUID",
  "proposalId": "ACTUAL_PROPOSAL_UUID",
  "version": 2,
  "hash": "ACTUAL_64_CHARACTER_HASH",
  "authorization": "final_agreement"
}
```

```sh
npm run --silent agent -- approve alice --file /tmp/final-approval.json --key alice-final-002
```

Both correct-version final approvals yield `agreement_reached_awaiting_booking_authorization`. `bookingAuthorization` remains `not_requested`. There is no booking, payment, deployment or third-party-message action. Expiry, withdrawal, changed requirements, stale decisions or a replaced proposal prevent old responses from confirming anything.

`reset-demo alice` resets the synthetic rehearsal and invalidates all IDs. Re-fetch status before presenting or executing a response. Do not reset a main rehearsal while waiting for a user's answer.
