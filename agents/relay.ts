import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  OwnerSchema,
  NeedSchema,
  FinalApprovalSchema,
  ResponseSchema,
  CounterSchema,
  WatchSchema,
  OpportunityResponseSchema,
  defaults,
} from "../server/types.js";

// Local dot relay. No token, private owner limit, provider key, or account ID is printed.
const [action, ownerArg, ...args] = process.argv.slice(2);
const base = process.env.CONCORD_URL ?? "http://127.0.0.1:4317";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base))
  throw new Error("Local loopback URL required");
async function call(path: string, body?: unknown, token?: string, extra = {}) {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "X-Concord-Transport": "dot-local-relay",
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(data.message), { code: data.error });
  return data;
}
function summarize(view: any) {
  return {
    owner: view.owner,
    request: view.request,
    status:
      (view.pendingOpportunity ? "opportunity_available" : view.outcome) ??
      view.agreement?.status ??
      (view.request?.status === "active"
        ? "waiting_for_match"
        : (view.request?.status ??
          (view.watchProfile?.status === "active"
            ? "watching_for_opportunities"
            : "no_request"))),
    agreement: view.agreement,
    pendingDecision: view.pendingDecision,
    watchProfile: view.watchProfile,
    pendingOpportunity: view.pendingOpportunity,
    bookingAuthorization: view.bookingAuthorization,
    integrationMode:
      view.provider?.mode === "synthetic"
        ? "mock_integrations_real_local_service"
        : "source_backed_planning",
    recentEvents: view.events?.slice(-12),
    providerAssumptions: view.provider,
    disclosure: view.disclosure,
    integrations: view.integrations,
    transport:
      "dot → delegated local Mac task → loopback HTTP → dot; no native installed connector",
  };
}
async function input() {
  const index = args.indexOf("--file");
  if (index < 0 || !args[index + 1])
    throw new Error(
      "Provide --file with a reviewed JSON input; no implicit approval",
    );
  return JSON.parse(await readFile(args[index + 1], "utf8"));
}
try {
  const owner = OwnerSchema.parse(ownerArg);
  if (action === "template" || action === "watch-template") {
    console.log(
      JSON.stringify(
        action === "watch-template"
          ? { need: defaults()[owner].limits, optIn: true }
          : defaults()[owner].limits,
        null,
        2,
      ),
    );
    process.exit(0);
  }
  const sessions = await call("/api/demo/sessions", {});
  const token = sessions.sessions.find((s: any) => s.owner === owner).token;
  const commandKey = args.includes("--key")
    ? args[args.indexOf("--key") + 1]
    : randomUUID();
  let view;
  if (action === "status" || action === "proposals") {
    view = await call("/api/me", undefined, token);
  } else if (action === "submit" || action === "update") {
    const need = NeedSchema.parse(await input());
    view = await call(
      "/api/assistant/command",
      { kind: action === "submit" ? "delegate" : "update", need },
      token,
      {
        "Idempotency-Key": commandKey,
      },
    );
  } else if (action === "watch") {
    const profile = WatchSchema.parse(await input());
    view = await call(
      "/api/assistant/command",
      { kind: "watch", profile },
      token,
      { "Idempotency-Key": commandKey },
    );
  } else if (action === "pause-watch" || action === "resume-watch") {
    view = await call(
      "/api/assistant/command",
      { kind: "pause_watch", paused: action === "pause-watch" },
      token,
      { "Idempotency-Key": commandKey },
    );
  } else if (action === "opportunity") {
    const response = OpportunityResponseSchema.parse(await input());
    if (response.ownerId !== owner)
      throw new Error("Input ownerId must match the CLI owner");
    view = await call(
      "/api/assistant/command",
      { kind: "opportunity", response },
      token,
      { "Idempotency-Key": commandKey },
    );
  } else if (action === "respond" || action === "reject") {
    const decision = ResponseSchema.parse(await input());
    if (decision.ownerId !== owner)
      throw new Error("Input ownerId must match the CLI owner");
    if (action === "reject" && decision.answer !== "decline")
      throw new Error("Reject requires answer=decline");
    view = await call(
      "/api/assistant/command",
      { kind: action, decision },
      token,
      { "Idempotency-Key": commandKey },
    );
  } else if (action === "counter") {
    const counter = CounterSchema.parse(await input());
    if (counter.ownerId !== owner)
      throw new Error("Input ownerId must match the CLI owner");
    view = await call(
      "/api/assistant/command",
      { kind: "counter", counter },
      token,
      { "Idempotency-Key": commandKey },
    );
  } else if (action === "approve") {
    const proposal = FinalApprovalSchema.parse(await input());
    view = await call(
      "/api/assistant/command",
      { kind: "approve", proposal },
      token,
      { "Idempotency-Key": commandKey },
    );
  } else if (action === "cancel") {
    view = await call("/api/assistant/command", { kind: "withdraw" }, token, {
      "Idempotency-Key": commandKey,
    });
  } else if (action === "reset-demo") {
    await call("/api/demo/reset", {}, undefined, {
      "X-Demo-Capability": sessions.resetToken,
    });
    view = await call("/api/me", undefined, token);
  } else
    throw new Error(
      "Actions: template, submit, update, status, proposals, respond, counter, approve, reject, cancel, reset-demo",
    );
  console.log(JSON.stringify({ ok: true, ...summarize(view) }, null, 2));
} catch (error) {
  const e = error as Error & { code?: string };
  console.log(
    JSON.stringify(
      { ok: false, error: e.code ?? "COMMAND_FAILED", message: e.message },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}
