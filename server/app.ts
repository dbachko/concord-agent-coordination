import express from "express";
import { randomBytes } from "node:crypto";
import { z, ZodError } from "zod";
import {
  AssistantCommandSchema,
  OWNERS,
  ProviderSelectionSchema,
  type Owner,
} from "./types.js";
import { DomainError, Engine, freshState } from "./engine.js";
import { Integrations } from "./integrations.js";
import { Store } from "./store.js";

export function createApp(
  options: { store?: Store; engine?: Engine; integrations?: Integrations } = {},
) {
  const store = options.store ?? new Store(),
    engine = options.engine ?? new Engine(store.load()),
    integrations = options.integrations ?? new Integrations();
  const app = express();
  const tokens = {
    alice: randomBytes(32).toString("hex"),
    bob: randomBytes(32).toString("hex"),
  };
  const resetToken = randomBytes(32).toString("hex");
  const inFlight = new Map<string, Promise<void>>();
  let generation = 0;
  app.disable("x-powered-by");
  app.use(express.json({ limit: "12kb" }));
  app.use((req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
    });
    let segments: string[];
    try {
      segments = decodeURIComponent(req.path)
        .replaceAll("\\", "/")
        .toLowerCase()
        .split("/");
    } catch {
      return res.status(400).json({ error: "INVALID_PATH" });
    }
    if (
      segments.some(
        (s) =>
          [".data", ".git", ".agents", ".codex", ".env"].includes(s) ||
          s.startsWith(".env."),
      )
    )
      return res.status(404).json({ error: "NOT_FOUND" });
    const host = req.headers.host?.split(":")[0];
    if (!["127.0.0.1", "localhost"].includes(host ?? ""))
      return res.status(403).json({
        error: "LOCAL_ONLY",
        message: "This demo only accepts loopback hosts.",
      });
    const origin = req.headers.origin;
    if (
      origin &&
      origin !== `http://${req.headers.host}` &&
      origin !== `https://${req.headers.host}`
    )
      return res.status(403).json({
        error: "ORIGIN_REJECTED",
        message: "Cross-origin access is not allowed.",
      });
    next();
  });
  app.get("/api/health", (_req, res) =>
    res.json({ ok: true, app: "concord", localDemo: true }),
  );
  // Deliberate local demo harness. Real applications must issue sessions through their identity provider.
  app.post("/api/demo/sessions", (_req, res) =>
    res.json({
      sessions: OWNERS.map((owner) => ({ owner, token: tokens[owner] })),
      resetToken,
    }),
  );
  function ownerFor(req: express.Request): Owner {
    const token = req.headers.authorization?.replace(/^Bearer /, "");
    const owner = OWNERS.find((o) => tokens[o] === token);
    if (!owner)
      throw new DomainError(
        401,
        "UNAUTHORIZED",
        "Use the capability for your own assistant session.",
      );
    return owner;
  }
  app.get("/api/me", (req, res) => {
    const view = engine.view(ownerFor(req));
    store.save(engine.state);
    res.json({ ...view, integrations: integrations.status() });
  });
  app.post("/api/assistant/command", async (req, res) => {
    const owner = ownerFor(req),
      command = AssistantCommandSchema.parse(req.body);
    const key = z
      .string()
      .min(8)
      .max(100)
      .regex(/^[\w-]+$/)
      .parse(req.headers["idempotency-key"]);
    const cacheId = `${owner}:${key}`;
    const old = engine.state.commands[cacheId];
    if (old) {
      engine.idempotent(owner, key, command, () => {});
      return res.json(engine.view(owner));
    }
    const run = async () => {
      if (integrations.status().requireLive && command.kind === "approve") {
        const proposal =
          engine.current(owner) && engine.latest(engine.current(owner)!);
        if (
          proposal?.providerMode !== "research-backed" ||
          OWNERS.some(
            (o) => engine.state.owners[o].workloadEvidence?.mode !== "live",
          )
        )
          throw new DomainError(
            409,
            "LIVE_EVIDENCE_REQUIRED",
            "A live-mode approval requires a source-backed service candidate and successful live workload manifest reads for both owners.",
          );
      }
      if (
        integrations.status().requireLive &&
        (command.kind === "delegate" ||
          command.kind === "update" ||
          (command.kind === "opportunity" &&
            command.response.action === "explore"))
      ) {
        const status = integrations.status();
        if (status.parallel.mode !== "live" || status.composio.mode !== "live")
          throw new DomainError(
            503,
            "LIVE_MODE_REQUIRED",
            "The main demo requires PARALLEL_MODE=live and COMPOSIO_MODE=live. Fixtures are available only through explicit offline mode.",
          );
        if (
          engine.state.research.mode !== "live" ||
          engine.state.provider.mode !== "research-backed"
        )
          throw new DomainError(
            409,
            "LIVE_RESEARCH_REQUIRED",
            "Open Connections & evidence, complete real Parallel research, then select a source-backed service candidate and planning envelope.",
          );
      }
      const epoch = generation;
      const revision = engine.active(owner)?.revision;
      const evidenceNeed =
        command.kind === "delegate" || command.kind === "update"
          ? command.need
          : command.kind === "opportunity" &&
              command.response.action === "explore"
            ? engine.state.watches[owner]?.need
            : undefined;
      const workloadEvidence = evidenceNeed
        ? await integrations.workloadEvidence(owner, evidenceNeed.date)
        : undefined;
      if (epoch !== generation)
        throw new DomainError(
          409,
          "DEMO_RESET",
          "The demo reset while the workload manifest was being checked. Retry your command.",
        );
      if (revision !== engine.active(owner)?.revision)
        throw new DomainError(
          409,
          "CONCURRENT_CHANGE",
          "Your need changed during the workload manifest read. Review and retry.",
        );
      try {
        engine.idempotent(owner, key, command, () => {
          switch (command.kind) {
            case "delegate":
              engine.delegate(owner, command.need, workloadEvidence!);
              break;
            case "update":
              engine.update(owner, command.need, workloadEvidence!);
              break;
            case "approve":
              engine.approve(owner, command.proposal);
              break;
            case "respond":
            case "reject":
              engine.respond(owner, command.decision);
              break;
            case "counter":
              engine.counter(owner, command.counter);
              break;
            case "withdraw":
              engine.withdraw(owner);
              break;
            case "watch":
              engine.watch(owner, command.profile.need);
              break;
            case "pause_watch":
              engine.pauseWatch(owner, command.paused);
              break;
            case "opportunity":
              engine.respondOpportunity(
                owner,
                command.response,
                workloadEvidence,
              );
              break;
          }
          if (req.headers["x-concord-transport"] === "dot-local-relay")
            engine.emit(
              "dot_relay_command",
              "Command received through the dot local relay",
              `Structured ${command.kind} command reached the real loopback service. This event confirms service receipt; dot displays the actual response through its local task.`,
              owner === "alice" ? "Alice’s agent" : "Bob’s agent",
              owner,
            );
        });
      } finally {
        store.save(engine.state);
      }
    };
    const existing = inFlight.get(cacheId);
    if (existing) {
      await existing;
      engine.idempotent(owner, key, command, () => {});
    } else {
      const promise = run();
      inFlight.set(cacheId, promise);
      try {
        await promise;
      } finally {
        inFlight.delete(cacheId);
      }
    }
    res.json(engine.view(owner));
  });
  app.post("/api/research", async (req, res) => {
    ownerFor(req);
    const epoch = generation;
    const research = await integrations.research();
    if (epoch !== generation)
      throw new DomainError(
        409,
        "DEMO_RESET",
        "Demo reset while research was in flight. Retry research.",
      );
    engine.state.research = research;
    engine.emit(
      "research",
      research.mode === "live"
        ? "Live Parallel research returned"
        : "Reference fixtures loaded",
      research.mode === "live"
        ? `${research.sources.length} source-backed options returned. Quotes, availability, and tenancy permission remain unconfirmed.`
        : "No Parallel call was made. Reference links are illustrative; provider terms remain synthetic.",
    );
    store.save(engine.state);
    res.json(research);
  });
  app.post("/api/provider/select", (req, res) => {
    const owner = ownerFor(req),
      input = ProviderSelectionSchema.parse(req.body);
    engine.selectProvider(input.sourceUrl, input.planningTotalCents);
    store.save(engine.state);
    res.json(engine.view(owner));
  });
  app.post("/api/workload/refresh", async (req, res) => {
    const owner = ownerFor(req),
      current = engine.active(owner);
    if (!current)
      throw new DomainError(
        409,
        "NO_ACTIVE_REQUEST",
        "Delegate a selected need before refreshing its workload manifest.",
      );
    const revision = current.revision,
      epoch = generation,
      need = structuredClone(engine.state.owners[owner].limits);
    const workloadEvidence = await integrations.workloadEvidence(
      owner,
      need.date,
    );
    if (epoch !== generation || engine.active(owner)?.revision !== revision)
      throw new DomainError(
        409,
        "CONCURRENT_CHANGE",
        "Your need changed while its workload manifest was being refreshed. Retry.",
      );
    const changed =
      JSON.stringify({
        busy: workloadEvidence.busy,
        manifest: workloadEvidence.manifest,
      }) !==
      JSON.stringify({
        busy: engine.state.owners[owner].workloadEvidence?.busy,
        manifest: engine.state.owners[owner].workloadEvidence?.manifest,
      });
    engine.refreshWorkload(owner, workloadEvidence);
    engine.emit(
      "workloadEvidence_refreshed",
      "Selected workload manifest rechecked",
      changed
        ? "Workload constraints changed; proposal approvals were invalidated and the plan was re-evaluated."
        : "Workload constraints are unchanged. Current proposal terms and approvals remain valid.",
      `${owner === "alice" ? "Alice" : "Bob"}’s agent`,
      owner,
    );
    store.save(engine.state);
    res.json(engine.view(owner));
  });
  app.post("/api/demo/reset", (req, res) => {
    if (req.headers["x-demo-capability"] !== resetToken)
      throw new DomainError(
        401,
        "UNAUTHORIZED",
        "Demo reset requires the local harness capability.",
      );
    generation++;
    engine.state = freshState();
    store.save(engine.state);
    res.json({ ok: true });
  });
  app.post("/api/demo/expire", (req, res) => {
    const owner = ownerFor(req);
    engine.expireDemo(owner);
    store.save(engine.state);
    res.json(engine.view(owner));
  });
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "NOT_FOUND", message: "No such API route." }),
  );
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (error instanceof DomainError)
        return res
          .status(error.status)
          .json({ error: error.code, message: error.message });
      if (error instanceof ZodError)
        return res.status(400).json({
          error: "INVALID_INPUT",
          message: error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        });
      if (error instanceof SyntaxError)
        return res.status(400).json({
          error: "INVALID_JSON",
          message: "The request must contain valid JSON.",
        });
      if (
        typeof error === "object" &&
        error !== null &&
        "status" in error &&
        error.status === 413
      )
        return res.status(413).json({
          error: "INPUT_TOO_LARGE",
          message: "The selected need command exceeds the 12 KB limit.",
        });
      // Never log SDK errors or request bodies: they can contain keys or private workloadEvidence IDs.
      res.status(500).json({
        error: "INTERNAL_ERROR",
        message:
          "The command could not complete. Retry after checking the local server setup.",
      });
    },
  );
  const timer = setInterval(() => {
    engine.sweep();
    store.save(engine.state);
  }, 1000);
  timer.unref();
  let polling = false;
  const workloadTimer = setInterval(async () => {
    if (polling || integrations.status().composio.mode !== "live") return;
    polling = true;
    try {
      for (const owner of OWNERS) {
        const req = engine.active(owner);
        if (
          !req ||
          engine.state.owners[owner].workloadEvidence?.mode !== "live"
        )
          continue;
        const revision = req.revision,
          epoch = generation;
        try {
          const workloadEvidence = await integrations.workloadEvidence(
            owner,
            req.need.date,
          );
          if (
            epoch === generation &&
            engine.active(owner)?.revision === revision
          )
            engine.refreshWorkload(owner, workloadEvidence);
        } catch {
          engine.emit(
            "workloadEvidence_refresh_failed",
            "Workload refresh did not complete",
            "The last successful read remains timestamped. Evidence older than two minutes invalidates approvals. Use refresh after checking the selected connection.",
            `${owner === "alice" ? "Alice" : "Bob"}’s agent`,
            owner,
          );
        }
      }
      engine.sweep();
      store.save(engine.state);
    } finally {
      polling = false;
    }
  }, 60000);
  workloadTimer.unref();
  return {
    app,
    engine,
    close: () => {
      clearInterval(timer);
      clearInterval(workloadTimer);
    },
  };
}
