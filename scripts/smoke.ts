import assert from "node:assert/strict";

// Uses an explicitly offline test server, never the primary live demo or real account connections.
const base = process.env.SMOKE_URL || "http://127.0.0.1:4318";
async function post(path: string, body: unknown, token?: string, extra = {}) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extra,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  assert.equal(response.ok, true, data.message);
  return data;
}
async function view(token: string) {
  const res = await fetch(`${base}/api/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}
assert.equal(
  new URL(base).port,
  "4318",
  "Smoke resets are restricted to the isolated test server on 4318.",
);
const auth = await post("/api/demo/sessions", {});
const [alice, bob] = auth.sessions;
const initial = await view(alice.token);
assert.equal(
  initial.integrations.requireLive,
  false,
  "Refusing to reset the primary live-required demo. Start a separate explicit fixture server on 4318.",
);
await post("/api/demo/reset", {}, undefined, {
  "X-Demo-Capability": auth.resetToken,
});
const send = (token: string, body: unknown) =>
  post("/api/assistant/command", body, token, {
    "Idempotency-Key": crypto.randomUUID(),
  });
for (const session of [alice, bob]) {
  const own = await view(session.token);
  await send(session.token, { kind: "delegate", need: own.limits });
}
let current = await view(alice.token),
  p = current.agreement.proposal;
assert.deepEqual(p.shares, { alice: 400, bob: 800 });
const exploreBoth = async () => {
  for (const owner of [alice, bob]) {
    const v = await view(owner.token),
      d = v.pendingDecision;
    await send(owner.token, {
      kind: "respond",
      decision: {
        ownerId: owner.owner,
        decisionId: d.id,
        proposal: d.proposal,
        answer: "explore",
      },
    });
  }
};
const approve = async (owner: { token: string }) => {
  const v = await view(owner.token),
    proposal = v.agreement.proposal;
  await send(owner.token, {
    kind: "approve",
    proposal: {
      agreementId: v.agreement.id,
      proposalId: proposal.id,
      ownerId: owner === alice ? "alice" : "bob",
      decisionId:
        proposal.decisionIds.final_approval[owner === alice ? "alice" : "bob"],
      authorization: "final_agreement",
      version: proposal.version,
      hash: proposal.hash,
    },
  });
};
await exploreBoth();
await approve(alice);
await approve(bob);
assert.equal((await view(alice.token)).agreement.status, "approved");
const bv = await view(bob.token);
await send(bob.token, {
  kind: "update",
  need: { ...bv.limits, window: { ...bv.limits.window, start: 720 } },
});
current = await view(alice.token);
p = current.agreement.proposal;
assert.equal(p.version, 2);
assert.equal(p.start, 840);
assert.deepEqual(p.approvals, {});
await exploreBoth();
await approve(alice);
await approve(bob);
assert.equal((await view(bob.token)).agreement.status, "approved");
await send(bob.token, { kind: "withdraw" });
assert.equal((await view(alice.token)).agreement.status, "cancelled");
console.log(
  "HTTP smoke passed: match → rejected offer → counterproposal → explicit exploration → dual final approval → constraint change → v2 → fresh exploration and final approvals → withdrawal.",
);
