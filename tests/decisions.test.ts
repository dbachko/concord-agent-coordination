import { describe, it, expect } from "vitest";
import { Engine, freshState } from "../server/engine";
import { defaults, ResponseSchema, type Owner } from "../server/types";
import { Integrations } from "../server/integrations";
const date = "2030-06-08",
  now = new Date("2030-06-03T18:00:00Z");
function pair() {
  const e = new Engine(freshState(), () => now);
  for (const owner of ["alice", "bob"] as const)
    e.delegate(owner, defaults(date)[owner].limits, {
      mode: "fixture",
      date,
      checkedAt: now.toISOString(),
      label: "Synthetic test manifest",
      busy: [],
    });
  return e;
}
const latest = (e: Engine) => e.latest(e.state.agreements[0])!;
function response(
  e: Engine,
  owner: Owner,
  answer: "explore" | "decline" = "explore",
) {
  const d = e.pendingDecision(owner)!;
  return { ownerId: owner, decisionId: d.id, proposal: d.proposal, answer };
}
function final(e: Engine, owner: Owner) {
  const p = latest(e),
    a = e.state.agreements[0];
  return {
    ...e.reference(a, p),
    ownerId: owner,
    decisionId: p.decisionIds.final_approval[owner],
    authorization: "final_agreement" as const,
  };
}
function exploreBoth(e: Engine) {
  for (const owner of ["alice", "bob"] as const)
    e.respond(owner, response(e, owner));
}
describe("explicit user negotiation feedback", () => {
  it("returns a concrete pending exploration question and feasible alternatives without accepting for either owner", () => {
    const e = pair(),
      p = latest(e),
      d = e.pendingDecision("alice")!;
    expect(d.stage).toBe("exploration");
    expect(d.proposal.proposalId).toBe(p.id);
    expect(d.alternatives).toHaveLength(3);
    expect(
      d.alternatives.every(
        (x) => e.validate(e.state.agreements[0], x.offer).ok,
      ),
    ).toBe(true);
    expect(p.explorations).toEqual({});
    expect(p.approvals).toEqual({});
    expect(e.view("alice").bookingAuthorization).toBe("not_requested");
    expect(() => e.approve("alice", final(e, "alice"))).toThrow(
      "Both owners must respond",
    );
    expect(
      ResponseSchema.safeParse({ ...response(e, "alice"), answer: "yes" })
        .success,
    ).toBe(false);
  });
  it("records duplicate exploration yes exactly once, separately from final approval", () => {
    const e = pair(),
      input = response(e, "alice");
    e.idempotent("alice", "same-yes-key", input, () =>
      e.respond("alice", input),
    );
    e.idempotent("alice", "same-yes-key", input, () => {
      throw Error("must not repeat");
    });
    e.respond("alice", input);
    expect(
      e.state.events.filter((x) => x.type === "exploration_consented"),
    ).toHaveLength(1);
    expect(latest(e).approvals).toEqual({});
    expect(e.pendingDecision("alice")?.stage).toBe("waiting_for_other_owner");
    e.respond("bob", response(e, "bob"));
    expect(e.state.agreements[0].status).toBe("awaiting_approval");
    e.respond("alice", input);
    expect(latest(e).approvals).toEqual({});
  });
  it("requires two explicit identical-version final approvals and leaves booking authorization separate", () => {
    const e = pair();
    exploreBoth(e);
    e.approve("alice", final(e, "alice"));
    expect(e.state.agreements[0].status).toBe("awaiting_approval");
    e.approve("bob", final(e, "bob"));
    e.approve("bob", final(e, "bob"));
    expect(e.view("alice").outcome).toBe(
      "agreement_reached_awaiting_booking_authorization",
    );
    expect(e.view("alice").bookingAuthorization).toBe("not_requested");
    expect(
      e.state.events.filter((x) => x.type === "approved_by_owner"),
    ).toHaveLength(2);
  });
  it("countering with a feasible alternative creates a new proposal and invalidates old responses and approvals", () => {
    const e = pair();
    exploreBoth(e);
    const old = latest(e),
      oldApproval = final(e, "alice");
    e.approve("alice", oldApproval);
    const d = e.pendingDecision("bob")!;
    e.counter("bob", {
      ownerId: "bob",
      decisionId: d.id,
      proposal: d.proposal,
      alternativeId: d.alternatives[2].id,
    });
    const p = latest(e);
    expect(p.version).toBe(2);
    expect(p.id).not.toBe(old.id);
    expect(p.hash).not.toBe(old.hash);
    expect(p.start).toBe(840);
    expect(old.status).toBe("superseded");
    expect(old.approvals).toEqual({});
    expect(old.explorations).toEqual({});
    expect(p.approvals).toEqual({});
    expect(p.explorations).toEqual({});
    expect(() => e.approve("alice", oldApproval)).toThrow("replaced");
    expect(e.pendingDecision("alice")?.stage).toBe("exploration");
  });
  it("accepts a valid explicit cost/device counter and rejects infeasible counters without changing terms", () => {
    const e = pair(),
      d = e.pendingDecision("alice")!,
      p = latest(e);
    expect(() =>
      e.counter("alice", {
        ownerId: "alice",
        decisionId: d.id,
        proposal: d.proposal,
        terms: { start: p.start, end: p.end, shares: { alice: 900, bob: 300 } },
      }),
    ).toThrow("did not pass");
    expect(latest(e).id).toBe(p.id);
    e.counter("alice", {
      ownerId: "alice",
      decisionId: d.id,
      proposal: d.proposal,
      terms: {
        start: p.start,
        end: p.end,
        shares: { alice: 450, bob: 750 },
        deviceAssignments: { alice: [1], bob: [0] },
      },
    });
    expect(latest(e).version).toBe(2);
    expect(latest(e).deviceAssignments).toEqual({ alice: [1], bob: [0] });
    expect(latest(e).shares).toEqual({ alice: 450, bob: 750 });
  });
  it("a decline stops the proposal without accepting or withdrawing the owner request implicitly", () => {
    const e = pair();
    e.respond("alice", response(e, "alice", "decline"));
    expect(e.state.agreements[0].status).toBe("rejected");
    expect(latest(e).status).toBe("rejected");
    expect(e.active("alice")?.status).toBe("active");
    expect(e.pendingDecision("bob")).toBeUndefined();
    expect(latest(e).approvals).toEqual({});
  });
  it("rejects owner spoofing, stale question IDs, expired requests and expired proposal responses", () => {
    const e = pair(),
      input = response(e, "alice");
    expect(() => e.respond("bob", input)).toThrow("own owner");
    expect(() =>
      e.respond("alice", { ...input, decisionId: crypto.randomUUID() }),
    ).toThrow("replaced");
    latest(e).expiresAt = now.toISOString();
    expect(() => e.respond("alice", input)).toThrow("expired");
    const r = pair(),
      rInput = response(r, "alice");
    r.active("bob")!.expiresAt = now.toISOString();
    expect(() => r.respond("alice", rInput)).toThrow("expired");
  });
  it("caps interactive negotiation at six versions", () => {
    const e = pair();
    for (let i = 1; i <= 5; i++) {
      const d = e.pendingDecision("alice")!,
        p = latest(e);
      e.counter("alice", {
        ownerId: "alice",
        decisionId: d.id,
        proposal: d.proposal,
        terms: {
          start: p.start,
          end: p.end,
          shares: { alice: 400 + i, bob: 800 - i },
        },
      });
    }
    const d = e.pendingDecision("alice")!,
      p = latest(e);
    expect(() =>
      e.counter("alice", {
        ownerId: "alice",
        decisionId: d.id,
        proposal: d.proposal,
        terms: { start: p.start, end: p.end, shares: { alice: 450, bob: 750 } },
      }),
    ).toThrow("six-version");
  });
  it("cannot make live integration calls while paused even if keys and modes are set", async () => {
    let calls = 0;
    const i = new Integrations(
      {
        PARALLEL_MODE: "live",
        COMPOSIO_MODE: "live",
        PARALLEL_API_KEY: "test-not-real",
      },
      (async () => {
        calls++;
        throw Error("must not call");
      }) as typeof fetch,
    );
    await expect(i.research()).rejects.toMatchObject({
      code: "LIVE_CALLS_PAUSED",
    });
    await expect(i.workloadEvidence("alice", date)).rejects.toMatchObject({
      code: "LIVE_CALLS_PAUSED",
    });
    expect(calls).toBe(0);
  });
});
