import { describe, expect, it } from "vitest";
import { Engine, freshState } from "../server/engine";
import { defaults, type Owner } from "../server/types";

const date = "2030-06-08";
const now = new Date("2030-06-03T18:00:00Z");
function negotiate(aliceBudget = 500, bobBudget = 900) {
  const engine = new Engine(freshState(), () => now);
  for (const owner of ["alice", "bob"] as Owner[]) {
    engine.delegate(
      owner,
      {
        ...defaults(date)[owner].limits,
        maxBudgetCents: owner === "alice" ? aliceBudget : bobBudget,
      },
      {
        mode: "fixture",
        date,
        checkedAt: now.toISOString(),
        label: "Synthetic test evidence",
        busy: [],
      },
    );
  }
  return engine;
}
const exchange = (engine: Engine) =>
  engine.state.events.filter((event) =>
    [
      "agent_offer",
      "agent_rejected",
      "agent_counteroffer",
      "agent_consensus",
    ].includes(event.type),
  );

describe("recorded policy-agent negotiation", () => {
  it("records Bob's real offer, Alice's policy rejection, Alice's counter and consensus before any owner consent", () => {
    const engine = negotiate();
    const events = exchange(engine);
    expect(events.map((event) => event.type)).toEqual([
      "agent_offer",
      "agent_rejected",
      "agent_counteroffer",
      "agent_consensus",
    ]);
    expect(events.map((event) => event.actor)).toEqual([
      "Bob’s agent",
      "Alice’s agent",
      "Alice’s agent",
      "Concord",
    ]);
    expect(events[0].title).toContain("Alice $6.00 / Bob $6.00");
    expect(events[2].title).toContain("Alice $4.00 / Bob $8.00");
    const proposal = engine.latest(engine.state.agreements[0])!;
    expect(proposal.shares).toEqual({ alice: 400, bob: 800 });
    expect(proposal.approvals).toEqual({});
    expect(proposal.explorations).toEqual({});
    expect(engine.state.agreements[0].status).toBe("awaiting_response");
    expect(events.every((event) => event.scope === "shared")).toBe(true);
    expect(JSON.stringify(events)).not.toContain("maxBudgetCents");
    expect(JSON.stringify(events)).not.toContain("PRIVATE_LIMIT");
  });
  it("does not invent a rejection or counter when both private agents accept the first offer", () => {
    const engine = negotiate(700);
    expect(exchange(engine).map((event) => event.type)).toEqual([
      "agent_offer",
      "agent_consensus",
    ]);
    expect(engine.latest(engine.state.agreements[0])!.shares).toEqual({
      alice: 600,
      bob: 600,
    });
  });
  it("records the actual rejecting owner per round and never emits consensus when both permitted policies fail", () => {
    const engine = negotiate(500, 700);
    const events = exchange(engine);
    expect(
      events
        .filter((event) => event.type === "agent_rejected")
        .map((event) => event.actor),
    ).toEqual(["Alice’s agent", "Bob’s agent"]);
    expect(events.some((event) => event.type === "agent_consensus")).toBe(
      false,
    );
    expect(engine.state.agreements[0].status).toBe("infeasible");
    expect(engine.state.agreements[0].proposals).toHaveLength(0);
  });
});
