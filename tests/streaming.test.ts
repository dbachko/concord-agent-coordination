import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import { createApp } from "../server/app";
import { Engine, freshState } from "../server/engine";
import { Integrations } from "../server/integrations";
import { defaults, type Event } from "../server/types";
import { OwnerAgent } from "../agents/owner-agent";
import {
  mergeEvents,
  readEvents,
  SSEParser,
  type StreamFrame,
} from "../src/event-stream";

const date = "2030-06-08",
  now = new Date("2030-06-03T18:00:00Z");
function listen(response: Response, controller: AbortController) {
  const frames: StreamFrame[] = [];
  const waiters = new Set<() => void>();
  const done = readEvents(response, (frame) => {
    frames.push(frame);
    for (const wake of [...waiters]) wake();
  }).catch(() => {});
  return {
    frames,
    close: () => controller.abort(),
    done,
    until: (predicate: (frame: StreamFrame) => boolean) =>
      new Promise<StreamFrame>((resolve, reject) => {
        const timer = setTimeout(() => {
          waiters.delete(check);
          reject(new Error("Expected stream frame did not arrive"));
        }, 2000);
        const check = () => {
          const frame = frames.find(predicate);
          if (frame) {
            clearTimeout(timer);
            waiters.delete(check);
            resolve(frame);
          }
        };
        waiters.add(check);
        check();
      }),
  };
}
const payload = (frame: StreamFrame) => JSON.parse(frame.data);

describe("real policy execution stream", () => {
  let app: ReturnType<typeof createApp>,
    server: Server,
    base: string,
    alice: string,
    bob: string,
    reset: string;
  const controllers: AbortController[] = [];
  async function post(
    path: string,
    body: unknown,
    token = alice,
    extra: Record<string, string> = {},
  ) {
    const response = await fetch(base + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...extra,
      },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }
  const send = (owner: "alice" | "bob", kind = "delegate") =>
    post(
      "/api/assistant/command",
      { kind, need: defaults(date)[owner].limits },
      owner === "alice" ? alice : bob,
      { "Idempotency-Key": crypto.randomUUID() },
    );
  async function open(token = alice, cursor?: string) {
    const controller = new AbortController();
    controllers.push(controller);
    const response = await fetch(base + "/api/events", {
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(cursor ? { "Last-Event-ID": cursor } : {}),
      },
    });
    return listen(response, controller);
  }
  async function step() {
    const run = app.engine.view("alice").execution.run!;
    const response = await post("/api/negotiation/step", {
      runId: run.id,
      expectedStep: run.steps,
    });
    expect(response.status).toBe(200);
    return response.body;
  }
  beforeEach(async () => {
    app = createApp({
      engine: new Engine(freshState(), () => now),
      integrations: new Integrations({
        COMPOSIO_API_KEY: "NEVER_STREAM_THIS_KEY",
      }),
    });
    server = app.app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No test port");
    base = `http://127.0.0.1:${address.port}`;
    const sessions = await post("/api/demo/sessions", {});
    alice = sessions.body.sessions[0].token;
    bob = sessions.body.sessions[1].token;
    reset = sessions.body.resetToken;
  });
  afterEach(async () => {
    for (const controller of controllers.splice(0)) controller.abort();
    app.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    vi.restoreAllMocks();
  });
  it("requires owner authentication for streaming and execution controls", async () => {
    expect((await fetch(base + "/api/events")).status).toBe(401);
    expect(
      (await post("/api/negotiation/mode", { mode: "step" }, "wrong")).status,
    ).toBe(401);
  });
  it("streams actual incremental operations and gates decisions until consensus, with stale-step deduplication", async () => {
    const stream = await open();
    await stream.until((frame) => frame.type === "snapshot");
    await post("/api/negotiation/mode", { mode: "step" });
    await send("alice");
    const matched = await send("bob");
    expect(matched.body.execution.run.status).toBe("paused");
    expect(
      app.engine.state.events.some((event) => event.type === "agent_offer"),
    ).toBe(false);
    expect(matched.body.pendingDecision).toBeUndefined();
    const originalRun = matched.body.execution.run;
    let view = await step();
    await stream.until(
      (frame) =>
        frame.type === "activity" &&
        payload(frame).event.type === "agent_offer",
    );
    expect(view.pendingDecision).toBeUndefined();
    expect(
      (
        await post("/api/negotiation/step", {
          runId: originalRun.id,
          expectedStep: originalRun.steps,
        })
      ).status,
    ).toBe(409);
    expect(
      app.engine.state.events.filter((event) => event.type === "agent_offer"),
    ).toHaveLength(1);
    view = await step();
    expect(view.events.at(-1).type).toBe("agent_rejected");
    expect(view.pendingDecision).toBeUndefined();
    view = await step();
    expect(view.events.at(-1).type).toBe("agent_counteroffer");
    expect(view.pendingDecision).toBeUndefined();
    view = await step();
    expect(view.events.at(-1).type).toBe("agent_accepted");
    expect(view.pendingDecision).toBeUndefined();
    view = await step();
    expect(view.execution.run.status).toBe("completed");
    expect(view.pendingDecision.stage).toBe("exploration");
    expect(view.agreement.proposal.shares).toEqual({ alice: 400, bob: 800 });
    expect(view.agreement.proposal.approvals).toEqual({});
    await stream.until(
      (frame) =>
        frame.type === "snapshot" &&
        payload(frame).view.execution.run?.status === "completed",
    );
    expect(
      stream.frames
        .filter((frame) => frame.type === "activity")
        .map((frame) => payload(frame).event.type)
        .filter((type) => type.startsWith("agent_")),
    ).toEqual([
      "agent_negotiation_started",
      "agent_offer",
      "agent_rejected",
      "agent_counteroffer",
      "agent_accepted",
      "agent_consensus",
    ]);
    stream.close();
  });
  it("replays missed events from an authenticated cursor without duplicating executed operations", async () => {
    await post("/api/negotiation/mode", { mode: "step" });
    await send("alice");
    await send("bob");
    const first = await open();
    await first.until((frame) => frame.type === "snapshot");
    await step();
    const offer = payload(
      await first.until(
        (frame) =>
          frame.type === "activity" &&
          payload(frame).event.type === "agent_offer",
      ),
    ).event as Event;
    first.close();
    await first.done;
    for (let i = 0; i < 4; i++) await step();
    const resumed = await open(alice, offer.id);
    await resumed.until((frame) => frame.type === "snapshot");
    const replay = resumed.frames
      .filter((frame) => frame.type === "activity")
      .map((frame) => payload(frame).event as Event);
    expect(replay.some((event) => event.id === offer.id)).toBe(false);
    expect(replay.some((event) => event.type === "agent_counteroffer")).toBe(
      true,
    );
    const merged = mergeEvents([offer, ...replay], replay);
    expect(new Set(merged.map((event) => event.id)).size).toBe(merged.length);
    expect(
      app.engine.state.events.filter((event) => event.type === "agent_offer"),
    ).toHaveLength(1);
  });
  it("redacts another owner's private activity, limits and all integration secrets", async () => {
    const stream = await open(bob);
    await stream.until((frame) => frame.type === "snapshot");
    app.engine.emit(
      "private_test",
      "ALICE_PRIVATE_MARKER",
      "ALICE_PRIVATE_DETAILS",
      "Alice’s agent",
      "alice",
    );
    await send("alice");
    await send("bob");
    await stream.until(
      (frame) =>
        frame.type === "snapshot" &&
        payload(frame).view.execution.run?.status === "completed",
    );
    const wire = JSON.stringify(stream.frames);
    expect(wire).not.toContain("ALICE_PRIVATE");
    expect(wire).not.toContain('\\"maxBudgetCents\\":500');
    expect(wire).not.toContain("PRIVATE_LIMIT");
    expect(wire).not.toContain("NEVER_STREAM_THIS_KEY");
  });
  it("cancels paused execution on withdrawal and prevents further confirmation", async () => {
    await post("/api/negotiation/mode", { mode: "step" });
    await send("alice");
    await send("bob");
    await step();
    const old = app.engine.view("alice").execution.run!;
    const result = await post(
      "/api/assistant/command",
      { kind: "withdraw" },
      alice,
      { "Idempotency-Key": crypto.randomUUID() },
    );
    expect(result.body.execution.run.status).toBe("cancelled");
    expect(result.body.agreement.status).toBe("cancelled");
    expect(
      (
        await post("/api/negotiation/step", {
          runId: old.id,
          expectedStep: old.steps,
        })
      ).status,
    ).toBe(409);
    expect(
      app.engine.state.events.some(
        (event) => event.type === "agent_counteroffer",
      ),
    ).toBe(false);
  });
  it("rechecks time-sensitive private evidence when a paused operation actually executes", async () => {
    await post("/api/negotiation/mode", { mode: "step" });
    await send("alice");
    await send("bob");
    app.engine.state.owners.alice.workloadEvidence!.mode = "live";
    app.engine.state.owners.alice.workloadEvidence!.checkedAt =
      now.toISOString();
    await step(); // Offer is generated while the evidence is fresh.
    app.engine.now = () => new Date("2030-06-03T18:03:00Z");
    const rejected = await step();
    expect(rejected.events.at(-1).type).toBe("agent_rejected");
    for (
      let i = 0;
      i < 5 &&
      app.engine.execution.run(rejected.agreement.id)?.status === "paused";
      i++
    )
      await step();
    const final = app.engine.view("alice");
    expect(final.agreement!.status).toBe("infeasible");
    expect(final.events.some((event) => event.type === "agent_consensus")).toBe(
      false,
    );
    expect(final.pendingDecision).toBeUndefined();
  });
  it("terminates safely on expiry, errors and reset, and resynchronizes an obsolete cursor", async () => {
    await post("/api/negotiation/mode", { mode: "step" });
    await send("alice");
    await send("bob");
    app.engine.active("alice")!.expiresAt = "2030-06-03T17:59:59Z";
    const expired = app.engine.view("alice");
    expect(expired.execution.run!.status).toBe("cancelled");
    expect(
      (
        await post("/api/negotiation/step", {
          runId: expired.execution.run!.id,
          expectedStep: expired.execution.run!.steps,
        })
      ).status,
    ).toBe(409);
    expect(expired.pendingDecision).toBeUndefined();
    await post("/api/demo/reset", {}, alice, { "X-Demo-Capability": reset });
    await send("alice");
    await send("bob");
    const failureStream = await open(bob);
    await failureStream.until((frame) => frame.type === "snapshot");
    const secretError = "PRIVATE_ENGINE_ERROR_SHOULD_NOT_STREAM";
    vi.spyOn(OwnerAgent.prototype, "proposeShares").mockImplementation(() => {
      throw new Error(secretError);
    });
    const failed = await step();
    expect(failed.execution.run.status).toBe("failed");
    expect(failed.agreement.status).toBe("infeasible");
    expect(JSON.stringify(failed)).not.toContain(secretError);
    await failureStream.until(
      (frame) =>
        frame.type === "snapshot" &&
        payload(frame).view.execution.run?.status === "failed",
    );
    expect(JSON.stringify(failureStream.frames)).not.toContain(secretError);
    expect(
      failureStream.frames.some(
        (frame) =>
          frame.type === "activity" &&
          payload(frame).event.type === "agent_run_failed",
      ),
    ).toBe(true);
    const oldCursor = failed.events.at(-1).id;
    await post("/api/demo/reset", {}, alice, { "X-Demo-Capability": reset });
    const fresh = await open(alice, oldCursor);
    const snapshot = payload(
      await fresh.until((frame) => frame.type === "snapshot"),
    );
    expect(snapshot.cursorReset).toBe(true);
    expect(snapshot.view.events).toEqual([]);
    expect(snapshot.view.execution.run).toBeUndefined();
  });
});

describe("stream parser and client merge", () => {
  it("handles split UTF-8, CRLF, comments and multiple frames without inventing events", async () => {
    const encoder = new TextEncoder(),
      bytes = encoder.encode(
        ': heartbeat\r\n\r\nid: real-id\r\nevent: activity\r\ndata: {"actor":"Alice’s agent"}\r\n\r\n',
      );
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 3)
          controller.enqueue(bytes.slice(i, i + 3));
        controller.close();
      },
    });
    const frames: StreamFrame[] = [];
    await readEvents(
      new Response(body, { headers: { "Content-Type": "text/event-stream" } }),
      (frame) => frames.push(frame),
    );
    expect(frames).toEqual([
      { type: "activity", id: "real-id", data: '{"actor":"Alice’s agent"}' },
    ]);
    expect(() => new SSEParser().push("x".repeat(1048577))).toThrow();
  });
});
