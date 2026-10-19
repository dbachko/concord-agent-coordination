import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../server/app";
import { Integrations } from "../server/integrations";
import { defaults } from "../server/types";
import { Store } from "../server/store";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const date = "2030-06-08";
describe("owner-scoped API", () => {
  let app: ReturnType<typeof createApp>,
    alice: string,
    bob: string,
    reset: string;
  const send = (token: string, body: object, key = crypto.randomUUID()) =>
    request(app.app)
      .post("/api/assistant/command")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", key)
      .send(body);
  beforeEach(async () => {
    app = createApp({
      integrations: new Integrations({ REQUIRE_LIVE_INTEGRATIONS: "false" }),
    });
    const res = await request(app.app).post("/api/demo/sessions").send({});
    alice = res.body.sessions[0].token;
    bob = res.body.sessions[1].token;
    reset = res.body.resetToken;
  });
  afterEach(() => app.close());
  it("requires owner capabilities and rejects owner spoofing or extra tool input", async () => {
    expect((await request(app.app).get("/api/me")).status).toBe(401);
    expect(
      (
        await request(app.app)
          .get("/api/me")
          .set("Authorization", "Bearer fake")
      ).status,
    ).toBe(401);
    const res = await send(bob, {
      kind: "delegate",
      owner: "alice",
      need: defaults(date).alice.limits,
    });
    expect(res.status).toBe(400);
    expect(app.engine.state.requests).toHaveLength(0);
  });
  it("implements the vertical slice, private API view, idempotency and exact approvals", async () => {
    const first = {
      kind: "delegate",
      need: { ...defaults(date).alice.limits, maxBudgetCents: 493 },
    };
    const key = crypto.randomUUID();
    expect((await send(alice, first, key)).status).toBe(200);
    expect((await send(alice, first, key)).status).toBe(200);
    const b = await send(bob, {
      kind: "delegate",
      need: defaults(date).bob.limits,
    });
    expect(b.status).toBe(200);
    expect(JSON.stringify(b.body)).not.toMatch(/:493(?=[,}])/);
    expect(b.body.owner).toBe("bob");
    expect(b.body.agreement.partner.need).not.toHaveProperty("maxBudgetCents");
    const p = b.body.agreement.proposal,
      proposal = {
        agreementId: b.body.agreement.id,
        proposalId: p.id,
        version: p.version,
        hash: p.hash,
      };
    for (const [owner, token] of [
      ["alice", alice],
      ["bob", bob],
    ] as const) {
      expect(
        (
          await send(token, {
            kind: "respond",
            decision: {
              ownerId: owner,
              decisionId: p.decisionIds.exploration[owner],
              proposal,
              answer: "explore",
            },
          })
        ).status,
      ).toBe(200);
    }
    const aliceApproval = {
      ...proposal,
      ownerId: "alice",
      decisionId: p.decisionIds.final_approval.alice,
      authorization: "final_agreement",
    };
    const bobApproval = {
      ...proposal,
      ownerId: "bob",
      decisionId: p.decisionIds.final_approval.bob,
      authorization: "final_agreement",
    };
    expect(
      (await send(alice, { kind: "approve", proposal: aliceApproval })).status,
    ).toBe(200);
    const approved = await send(bob, {
      kind: "approve",
      proposal: bobApproval,
    });
    expect(approved.body.agreement.status).toBe("approved");
    const changed = await send(bob, {
      kind: "update",
      need: { ...defaults(date).bob.limits, window: { start: 720, end: 1020 } },
    });
    expect(changed.body.agreement.proposal.approvals).toEqual({});
    expect(changed.body.agreement.proposal.version).toBe(2);
    expect(
      (await send(alice, { kind: "approve", proposal: aliceApproval })).status,
    ).toBe(409);
    expect(app.engine.state.agreements).toHaveLength(1);
  });
  it("requires explicit consent and enforces schema, bounded input and idempotency conflicts", async () => {
    expect(
      (
        await send(alice, {
          kind: "delegate",
          need: { ...defaults(date).alice.limits, consent: false },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await send(alice, {
          kind: "delegate",
          need: {
            ...defaults(date).alice.limits,
            window: { start: 900, end: 800 },
          },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await send(alice, {
          kind: "delegate",
          need: { ...defaults(date).alice.limits, maxBudgetCents: 0.1 },
        })
      ).status,
    ).toBe(400);
    const key = crypto.randomUUID();
    await send(
      alice,
      { kind: "delegate", need: defaults(date).alice.limits },
      key,
    );
    expect((await send(alice, { kind: "withdraw" }, key)).status).toBe(409);
  });
  it("returns decision questions and routes duplicate responses, counteroffers and declines through owner-scoped HTTP", async () => {
    await send(bob, { kind: "delegate", need: defaults(date).bob.limits });
    const initial = await send(alice, {
      kind: "delegate",
      need: defaults(date).alice.limits,
    });
    const d = initial.body.pendingDecision;
    expect(d.stage).toBe("exploration");
    expect(initial.body.agreement.proposal.approvals).toEqual({});
    const yes = {
        kind: "respond",
        decision: {
          ownerId: "alice",
          decisionId: d.id,
          proposal: d.proposal,
          answer: "explore",
        },
      },
      key = crypto.randomUUID();
    expect((await send(alice, yes, key)).status).toBe(200);
    expect((await send(alice, yes, key)).status).toBe(200);
    expect(
      app.engine.state.events.filter((e) => e.type === "exploration_consented"),
    ).toHaveLength(1);
    const spoof = await send(bob, yes);
    expect(spoof.status).toBe(403);
    const v = await request(app.app)
        .get("/api/me")
        .set("Authorization", `Bearer ${bob}`),
      bd = v.body.pendingDecision;
    const revised = await send(bob, {
      kind: "counter",
      counter: {
        ownerId: "bob",
        decisionId: bd.id,
        proposal: bd.proposal,
        alternativeId: bd.alternatives[2].id,
      },
    });
    expect(revised.status).toBe(200);
    expect(revised.body.pendingDecision.proposal.version).toBe(2);
    expect(revised.body.agreement.proposal.explorations).toEqual({});
    expect((await send(alice, yes)).status).toBe(409);
    const decline = revised.body.pendingDecision;
    const rejected = await send(bob, {
      kind: "reject",
      decision: {
        ownerId: "bob",
        decisionId: decline.id,
        proposal: decline.proposal,
        answer: "decline",
      },
    });
    expect(rejected.status).toBe(200);
    expect(rejected.body.agreement.status).toBe("rejected");
    expect(rejected.body.bookingAuthorization).toBe("not_requested");
  });
  it("delivers an opt-in opportunity through HTTP and requires explicit exploration before creating Alice's request", async () => {
    expect(
      (
        await send(alice, {
          kind: "watch",
          profile: { need: defaults(date).alice.limits, optIn: false },
        })
      ).status,
    ).toBe(400);
    const watching = await send(alice, {
      kind: "watch",
      profile: { need: defaults(date).alice.limits, optIn: true },
    });
    expect(watching.status).toBe(200);
    expect(watching.body.request).toBeUndefined();
    await send(bob, { kind: "delegate", need: defaults(date).bob.limits });
    const own = await request(app.app)
        .get("/api/me")
        .set("Authorization", `Bearer ${alice}`),
      opportunity = own.body.pendingOpportunity;
    expect(opportunity.owner).toBe("alice");
    expect(app.engine.state.requests).toHaveLength(1);
    const command = {
        kind: "opportunity",
        response: {
          ownerId: "alice",
          opportunityId: opportunity.id,
          requestRevision: opportunity.requestRevision,
          action: "explore",
        },
      },
      key = crypto.randomUUID();
    const evaluated = await send(alice, command, key);
    expect(evaluated.status).toBe(200);
    expect(evaluated.body.pendingDecision.stage).toBe("exploration");
    expect(evaluated.body.agreement.proposal.approvals).toEqual({});
    expect((await send(alice, command, key)).status).toBe(200);
    expect(app.engine.state.requests).toHaveLength(2);
    expect(app.engine.state.agreements).toHaveLength(1);
  });
  it("does not permit foreign origins, non-loopback hosts, or unauthenticated reset", async () => {
    expect(
      (
        await request(app.app)
          .post("/api/demo/sessions")
          .set("Origin", "https://evil.example")
          .send({})
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app.app)
          .post("/api/demo/sessions")
          .set("Host", "evil.example")
          .send({})
      ).status,
    ).toBe(403);
    expect(
      (await request(app.app).post("/api/demo/reset").send({})).status,
    ).toBe(401);
    await send(alice, { kind: "delegate", need: defaults(date).alice.limits });
    expect(
      (
        await request(app.app)
          .post("/api/demo/reset")
          .set("X-Demo-Capability", reset)
          .send({})
      ).status,
    ).toBe(200);
    expect(app.engine.state.requests).toHaveLength(0);
  });
  it("never serves private snapshots or credentials as development assets", async () => {
    for (const path of [
      "/.data/state.json",
      "/.env",
      "/.ENV",
      "/.DATA/state.json",
      "/.env.local",
      "/@fs/Users/example/.data/state.json",
      "/%2edata/state.json",
    ])
      expect((await request(app.app).get(path)).status).toBe(404);
  });
  it("rejects oversized commands before processing their input", async () => {
    const result = await send(alice, { payload: "x".repeat(14000) });
    expect(result.status).toBe(413);
    expect(result.body.error).toBe("INPUT_TOO_LARGE");
    expect(app.engine.state.requests).toHaveLength(0);
  });
  it("concurrent duplicate delegation resolves to a single request and agreement", async () => {
    const payload = { kind: "delegate", need: defaults(date).alice.limits },
      key = crypto.randomUUID();
    const results = await Promise.all([
      send(alice, payload, key),
      send(alice, payload, key),
      send(bob, { kind: "delegate", need: defaults(date).bob.limits }),
    ]);
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(app.engine.state.requests).toHaveLength(2);
    expect(app.engine.state.agreements).toHaveLength(1);
  });
  it("expiry and withdrawal endpoints prevent confirmation over HTTP", async () => {
    await send(alice, { kind: "delegate", need: defaults(date).alice.limits });
    const r = await send(bob, {
      kind: "delegate",
      need: defaults(date).bob.limits,
    });
    const a = r.body.agreement,
      p = a.proposal;
    expect(
      (
        await request(app.app)
          .post("/api/demo/expire")
          .set("Authorization", `Bearer ${alice}`)
          .send({})
      ).body.agreement.status,
    ).toBe("expired");
    expect(
      (
        await send(bob, {
          kind: "approve",
          proposal: {
            agreementId: a.id,
            proposalId: p.id,
            version: p.version,
            hash: p.hash,
            ownerId: "bob",
            decisionId: p.decisionIds.final_approval.bob,
            authorization: "final_agreement",
          },
        })
      ).status,
    ).toBe(409);
    expect((await send(bob, { kind: "withdraw" })).body.request.status).toBe(
      "withdrawn",
    );
  });
  it("blocks fixture delegation when the primary live-required mode is active", async () => {
    app.close();
    app = createApp({
      integrations: new Integrations({ REQUIRE_LIVE_INTEGRATIONS: "true" }),
    });
    const sessions = await request(app.app).post("/api/demo/sessions").send({});
    alice = sessions.body.sessions[0].token;
    const r = await send(alice, {
      kind: "delegate",
      need: defaults(date).alice.limits,
    });
    expect(r.status).toBe(503);
    expect(r.body.error).toBe("LIVE_MODE_REQUIRED");
    expect(app.engine.state.requests).toHaveLength(0);
  });
  it("requires successful live research and selection even if live mode flags are set", async () => {
    app.close();
    app = createApp({
      integrations: new Integrations({
        REQUIRE_LIVE_INTEGRATIONS: "true",
        PARALLEL_MODE: "live",
        COMPOSIO_MODE: "live",
      }),
    });
    const sessions = await request(app.app).post("/api/demo/sessions").send({});
    alice = sessions.body.sessions[0].token;
    const r = await send(alice, {
      kind: "delegate",
      need: defaults(date).alice.limits,
    });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("LIVE_RESEARCH_REQUIRED");
    expect(app.engine.state.requests).toHaveLength(0);
  });
  it("rejects stale async results when a reset occurs during a workloadEvidence read", async () => {
    app.close();
    let release: (() => void) | undefined;
    const i = new Integrations({ REQUIRE_LIVE_INTEGRATIONS: "false" });
    const original = i.workloadEvidence.bind(i);
    i.workloadEvidence = async (owner, date) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return original(owner, date);
    };
    app = createApp({ integrations: i });
    const sessions = await request(app.app).post("/api/demo/sessions").send({});
    alice = sessions.body.sessions[0].token;
    reset = sessions.body.resetToken;
    const pending = send(alice, {
      kind: "delegate",
      need: defaults(date).alice.limits,
    }).then((r) => r);
    // Wait for the known local async boundary, not a network timeout.
    while (!release)
      await new Promise<void>((resolve) => setImmediate(resolve));
    await request(app.app)
      .post("/api/demo/reset")
      .set("X-Demo-Capability", reset)
      .send({});
    release();
    const r = await pending;
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("DEMO_RESET");
    expect(app.engine.state.requests).toHaveLength(0);
  });
});
describe("local durability", () => {
  it("atomically persists state and recovers owner requests and approvals", () => {
    const dir = mkdtempSync(join(tmpdir(), "concord-test-"));
    try {
      const file = join(dir, "state.json"),
        store = new Store(file),
        state = store.load();
      state.owners.alice.limits.maxBudgetCents = 493;
      store.save(state);
      expect(store.load().owners.alice.limits.maxBudgetCents).toBe(493);
      expect(JSON.parse(readFileSync(file, "utf8")).schemaVersion).toBe(4);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
