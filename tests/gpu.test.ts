import { describe, it, expect } from "vitest";
import { Engine, freshState } from "../server/engine";
import { defaults, NeedSchema } from "../server/types";
const date = "2030-06-08",
  now = new Date("2030-06-03T18:00:00Z");
const evidence = () => ({
  mode: "fixture" as const,
  date,
  checkedAt: now.toISOString(),
  label: "Synthetic test manifest",
  busy: [],
});
function pair() {
  const e = new Engine(freshState(), () => now);
  for (const o of ["alice", "bob"] as const)
    e.delegate(o, defaults(date)[o].limits, evidence());
  return e;
}
describe("GPU sharing and dot relay requirements", () => {
  it("posts a real waiting request and automatically negotiates when the second selected need arrives", () => {
    const e = new Engine(freshState(), () => now);
    e.delegate("alice", defaults(date).alice.limits, evidence());
    expect(e.current("alice")).toBeUndefined();
    expect(e.state.events.at(-1)?.type).toBe("waiting_for_match");
    e.delegate("bob", defaults(date).bob.limits, evidence());
    expect(e.state.agreements).toHaveLength(1);
    const p = e.latest(e.state.agreements[0])!;
    expect(p.deviceAssignments).toEqual({ alice: [0], bob: [1] });
    expect(p.shares).toEqual({ alice: 400, bob: 800 });
    expect(p.vramPerGpuGb).toBe(24);
  });
  it("rejects fractional GPU slicing and non-public workload trust classes", () => {
    for (const changed of [
      { gpuCount: 0.5 },
      { trustClass: "confidential" },
      { runtimeMinutes: 121 },
    ])
      expect(
        NeedSchema.safeParse({ ...defaults(date).alice.limits, ...changed })
          .success,
      ).toBe(false);
  });
  it("rejects duplicated physical GPU assignments and VRAM requirements above host capacity", () => {
    const e = pair(),
      a = e.state.agreements[0],
      p = e.latest(a)!;
    const offer = e.offerOf(p);
    expect(
      e.validate(a, { ...offer, deviceAssignments: { alice: [0], bob: [0] } }),
    ).toEqual({ ok: false, code: "GPU_ASSIGNMENT" });
    e.update(
      "bob",
      { ...defaults(date).bob.limits, minVramGb: 48 },
      evidence(),
    );
    expect(a.status).toBe("infeasible");
    expect(a.reason).toContain("VRAM");
    expect(p.status).toBe("superseded");
  });
  it("a changed live workload manifest invalidates approvals even when selected need and schedule stay unchanged", () => {
    const e = pair(),
      a = e.state.agreements[0],
      p = e.latest(a)!;
    for (const owner of ["alice", "bob"] as const)
      e.respond(owner, {
        ownerId: owner,
        decisionId: p.decisionIds.exploration[owner],
        proposal: e.reference(a, p),
        answer: "explore",
      });
    e.approve("alice", {
      ...e.reference(a, p),
      ownerId: "alice",
      decisionId: p.decisionIds.final_approval.alice,
      authorization: "final_agreement",
    });
    e.refreshWorkload("alice", {
      ...evidence(),
      manifest: {
        gpuCount: 1,
        minVramGb: 48,
        runtimeMinutes: 60,
        trustClass: "public-demo",
      },
    });
    expect(p.approvals).toEqual({});
    expect(p.status).toBe("superseded");
    expect(a.status).toBe("infeasible");
  });
});
