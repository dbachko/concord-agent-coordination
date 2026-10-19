import { describe, it, expect } from "vitest";
import { Engine, freshState } from "../server/engine";
import {
  defaults,
  WatchSchema,
  type OpportunityResponse,
} from "../server/types";
const date = "2030-06-08",
  now = new Date("2030-06-03T18:00:00Z"),
  evidence = {
    mode: "fixture" as const,
    date,
    checkedAt: now.toISOString(),
    label: "Synthetic manifest",
    busy: [],
  };
function watched() {
  const e = new Engine(freshState(), () => now);
  e.watch("alice", defaults(date).alice.limits);
  return e;
}
function notified() {
  const e = watched();
  e.delegate("bob", defaults(date).bob.limits, evidence);
  return e;
}
function answer(
  e: Engine,
  action: "explore" | "dismiss" = "explore",
): OpportunityResponse {
  const o = e.opportunityView("alice")!;
  return {
    ownerId: "alice",
    opportunityId: o.id,
    requestRevision: o.requestRevision,
    action,
  };
}
describe("opt-in local opportunity notifications", () => {
  it("holds selected interests without an active request, then emits one relevant event on a new compatible request", () => {
    const e = watched();
    expect(e.active("alice")).toBeUndefined();
    expect(e.state.requests).toHaveLength(0);
    expect(e.opportunityView("alice")).toBeUndefined();
    e.delegate("bob", defaults(date).bob.limits, evidence);
    const o = e.opportunityView("alice")!;
    expect(o.reason).toContain("same region");
    expect(o.providerMode).toBe("synthetic");
    expect(o.benefit).toContain("Unverified");
    expect(e.state.agreements).toHaveLength(0);
    e.findOpportunities();
    e.findOpportunities();
    expect(e.state.opportunities).toHaveLength(1);
    expect(
      e.state.events.filter((x) => x.type === "opportunity_ready"),
    ).toHaveLength(1);
    expect(e.view("bob").watchProfile).toBeUndefined();
    expect(e.view("bob").events.some((x) => x.type === "watch_enabled")).toBe(
      false,
    );
    expect(JSON.stringify(e.view("bob"))).not.toMatch(/"maxBudgetCents":500/);
  });
  it("requires explicit opt-in, supports pause/resume and does not configure a production monitor", () => {
    expect(
      WatchSchema.safeParse({ need: defaults(date).alice.limits, optIn: false })
        .success,
    ).toBe(false);
    const e = watched();
    e.pauseWatch("alice", true);
    e.delegate("bob", defaults(date).bob.limits, evidence);
    expect(e.opportunityView("alice")).toBeUndefined();
    e.pauseWatch("alice", false);
    expect(e.opportunityView("alice")).toBeDefined();
    const input = answer(e);
    e.pauseWatch("alice", true);
    expect(() => e.respondOpportunity("alice", input, evidence)).toThrow();
  });
  it("dismisses without an active request or acceptance and never repeats that request notification", () => {
    const e = notified(),
      input = answer(e, "dismiss");
    e.respondOpportunity("alice", input);
    expect(e.active("alice")).toBeUndefined();
    expect(e.opportunityView("alice")).toBeUndefined();
    e.update(
      "bob",
      { ...defaults(date).bob.limits, window: { start: 660, end: 1020 } },
      evidence,
    );
    e.findOpportunities();
    expect(e.state.opportunities).toHaveLength(1);
    expect(e.state.opportunities[0].status).toBe("dismissed");
  });
  it("only explicit explore creates a selected request and negotiation; it never consents or approves for either owner", () => {
    const e = notified(),
      input = answer(e);
    e.respondOpportunity("alice", input, evidence);
    const a = e.state.agreements[0],
      p = e.latest(a)!;
    expect(e.state.requests).toHaveLength(2);
    expect(a.status).toBe("awaiting_response");
    expect(p.explorations).toEqual({});
    expect(p.approvals).toEqual({});
    e.respondOpportunity("alice", input, evidence);
    expect(e.state.requests).toHaveLength(2);
    expect(e.state.agreements).toHaveLength(1);
    expect(e.opportunityView("alice")).toBeUndefined();
  });
  it("rejects stale candidate revisions and expires notices when a request expires or is withdrawn", () => {
    const e = notified(),
      old = answer(e);
    e.update(
      "bob",
      { ...defaults(date).bob.limits, window: { start: 660, end: 1020 } },
      evidence,
    );
    expect(() => e.respondOpportunity("alice", old, evidence)).toThrow(
      "changed",
    );
    const fresh = answer(e);
    e.withdraw("bob");
    expect(() => e.respondOpportunity("alice", fresh, evidence)).toThrow(
      "expired",
    );
    const expired = notified(),
      input = answer(expired);
    expired.active("bob")!.expiresAt = now.toISOString();
    expect(() => expired.respondOpportunity("alice", input, evidence)).toThrow(
      "expired",
    );
  });
  it("filters incompatible requirements and does not leak private reservation limits in the notification", () => {
    const e = watched();
    e.delegate(
      "bob",
      { ...defaults(date).bob.limits, region: "EU Central" },
      evidence,
    );
    expect(e.opportunityView("alice")).toBeUndefined();
    e.update("bob", defaults(date).bob.limits, evidence);
    const o = e.opportunityView("alice")!;
    expect(o.candidate.need).not.toHaveProperty("maxBudgetCents");
    expect(() => e.respondOpportunity("bob", answer(e), evidence)).toThrow(
      "own owner",
    );
  });
});
