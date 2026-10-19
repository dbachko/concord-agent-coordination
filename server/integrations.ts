import { z } from "zod";
import {
  type WorkloadSnapshot,
  type Owner,
  type Research,
  type Window,
} from "./types.js";
import { DomainError, fixtureResearch } from "./engine.js";

export const TIME_ZONE = "America/Los_Angeles";
export function zonedDayBounds(date: string) {
  const noon = new Date(`${date}T12:00:00Z`);
  const offset = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    timeZoneName: "shortOffset",
  })
    .formatToParts(noon)
    .find((p) => p.type === "timeZoneName")!
    .value.replace("GMT", "");
  const hours = Number(offset || 0),
    sign = hours < 0 ? "-" : "+";
  const suffix = `${sign}${String(Math.abs(hours)).padStart(2, "0")}:00`;
  return {
    start: `${date}T00:00:00${suffix}`,
    end: `${date}T23:59:59${suffix}`,
  };
}
const SourceSchema = z.object({
  title: z.string().max(1000),
  url: z.url().refine((x) => /^https?:\/\//.test(x)),
  excerpts: z.array(z.string()).max(40).default([]),
});
const SearchSchema = z.object({
  search_id: z.string().optional(),
  results: z.array(SourceSchema).max(100),
});
export type IntegrationConfig = NodeJS.ProcessEnv;

export function integrationStatus(env: IntegrationConfig = process.env) {
  const parallelMode = env.PARALLEL_MODE === "live" ? "live" : "fixture";
  const composioMode = env.COMPOSIO_MODE === "live" ? "live" : "fixture";
  const missingWorkload = [
    "COMPOSIO_API_KEY",
    "COMPOSIO_GOOGLESHEETS_AUTH_CONFIG_ID",
    ...["ALICE", "BOB"].flatMap((o) => [
      `COMPOSIO_${o}_USER_ID`,
      `COMPOSIO_${o}_CONNECTED_ACCOUNT_ID`,
      `COMPOSIO_${o}_WORKLOAD_ID`,
    ]),
  ].filter((k) => !env[k]);
  return {
    liveCallsAllowed: env.ALLOW_LIVE_CALLS === "true",
    requireLive: env.REQUIRE_LIVE_INTEGRATIONS === "true",
    parallel: {
      mode: parallelMode,
      configured: Boolean(env.PARALLEL_API_KEY),
      blocker:
        parallelMode === "fixture"
          ? "Mock research selected. No Parallel request is made; credentials are optional for this rehearsal."
          : !env.PARALLEL_API_KEY
            ? "PARALLEL_API_KEY is missing. Set it server-side in the ignored .env, then set PARALLEL_MODE=live and restart."
            : "Configured; use Research GPU hosts to verify a live call.",
    },
    composio: {
      mode: composioMode,
      configured: !missingWorkload.length,
      blocker:
        composioMode === "fixture"
          ? "Mock workload manifests selected. No Composio request or account permission is used."
          : missingWorkload.length
            ? `Missing ${missingWorkload.join(", ")}. Use an explicitly selected synthetic workload manifest sheet per demo owner and a read-only authorized Google Sheets connection; no OAuth flow runs here.`
            : "Configured; each submission reads only the selected workload manifest range through Composio.",
    },
    agents: {
      mode: "deterministic",
      detail:
        "Two private policy agents. No model key or generative chat is required or claimed.",
    },
  };
}

export class Integrations {
  private sessions = new Map<
    Owner,
    Awaited<ReturnType<import("@composio/core").Composio["create"]>>
  >();
  constructor(
    private env: IntegrationConfig = process.env,
    private fetcher: typeof fetch = fetch,
  ) {}
  status() {
    return integrationStatus(this.env);
  }
  async research(): Promise<Research> {
    if (this.env.PARALLEL_MODE !== "live") return fixtureResearch();
    if (this.env.ALLOW_LIVE_CALLS !== "true")
      throw new DomainError(
        409,
        "LIVE_CALLS_PAUSED",
        "Live calls are paused. Use explicitly labeled mock integrations until live testing is authorized.",
      );
    if (!this.env.PARALLEL_API_KEY)
      throw new DomainError(
        503,
        "PARALLEL_NOT_CONFIGURED",
        "Parallel live research requires PARALLEL_API_KEY in the server environment.",
      );
    let response: Response;
    try {
      response = await this.fetcher("https://api.parallel.ai/v1/search", {
        method: "POST",
        signal: AbortSignal.timeout(18000),
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.env.PARALLEL_API_KEY,
        },
        body: JSON.stringify({
          mode: "fast",
          objective:
            "Find official GPU host options for two independent public demonstration workloads, each requiring one whole GPU with at least 24 GB VRAM on a two-GPU host. Research multi-GPU host configuration, per-device assignment, separate workload permission, isolation limitations, pricing units, billing and cancellation. Prefer Runpod, Lambda, Vast and NVIDIA official documentation. Do not infer that CUDA_VISIBLE_DEVICES supplies security isolation. Do not infer current availability, a confirmed price, permission to resell or share accounts, or that a single GPU can be split. Clearly report unknown sharing policy.",
          search_queries: [
            "site:docs.runpod.io pods multi GPU pricing security isolation",
            "site:lambda.ai GPU cloud multi GPU instances pricing terms",
            "site:docs.nvidia.com container toolkit device GPU isolation",
          ],
        }),
      });
    } catch {
      throw new DomainError(
        502,
        "PARALLEL_UNREACHABLE",
        "Parallel search timed out or could not be reached. No live result was recorded.",
      );
    }
    if (!response.ok)
      throw new DomainError(
        502,
        "PARALLEL_FAILED",
        `Parallel returned HTTP ${response.status}. No live result was recorded.`,
      );
    const parsed = SearchSchema.safeParse(await response.json());
    if (!parsed.success || !parsed.data.results.length)
      throw new DomainError(
        502,
        "PARALLEL_NO_EVIDENCE",
        "Parallel returned no usable source-backed options. No availability or quote can be inferred.",
      );
    return {
      mode: "live",
      checkedAt: new Date().toISOString(),
      searchId: parsed.data.search_id,
      status:
        "Live Parallel search excerpts. Untrusted source material; GPU host capacity, tenancy permission, isolation, final price and availability require provider confirmation. Web prices are estimates, never confirmed offers.",
      sources: parsed.data.results.slice(0, 6).map((s) => ({
        title: s.title.slice(0, 180),
        url: s.url,
        excerpt: s.excerpts.join("\n").slice(0, 900),
      })),
    };
  }
  async workloadEvidence(
    owner: Owner,
    date: string,
  ): Promise<WorkloadSnapshot> {
    if (this.env.COMPOSIO_MODE !== "live")
      return {
        mode: "fixture",
        checkedAt: new Date().toISOString(),
        date,
        label: "Synthetic workload manifest; no Composio call",
        busy:
          owner === "alice"
            ? [{ start: 540, end: 600 }]
            : [{ start: 780, end: 840 }],
        manifest: {
          gpuCount: 1,
          minVramGb: 24,
          runtimeMinutes: owner === "alice" ? 60 : 120,
          trustClass: "public-demo",
        },
      };
    if (this.env.ALLOW_LIVE_CALLS !== "true")
      throw new DomainError(
        409,
        "LIVE_CALLS_PAUSED",
        "Live calls are paused. No Composio request was sent.",
      );
    const prefix = `COMPOSIO_${owner.toUpperCase()}`;
    const apiKey = this.env.COMPOSIO_API_KEY,
      authConfigId = this.env.COMPOSIO_GOOGLESHEETS_AUTH_CONFIG_ID,
      userId = this.env[`${prefix}_USER_ID`],
      accountId = this.env[`${prefix}_CONNECTED_ACCOUNT_ID`],
      sheetId = this.env[`${prefix}_WORKLOAD_ID`];
    if (!apiKey || !authConfigId || !userId || !accountId || !sheetId)
      throw new DomainError(
        503,
        "COMPOSIO_NOT_CONFIGURED",
        `Composio live read requires COMPOSIO_API_KEY, COMPOSIO_GOOGLESHEETS_AUTH_CONFIG_ID, ${prefix}_USER_ID, ${prefix}_CONNECTED_ACCOUNT_ID, ${prefix}_WORKLOAD_ID. Select a demo-only workload spreadsheet; no production data or default sheet is read.`,
      );
    try {
      let session = this.sessions.get(owner);
      if (!session) {
        const { Composio } = await import("@composio/core");
        const composio = new Composio({ apiKey, allowTracking: false });
        session = await composio.create(userId, {
          toolkits: ["googlesheets"],
          authConfigs: { googlesheets: authConfigId },
          tools: { googlesheets: { enable: ["GOOGLESHEETS_BATCH_GET"] } },
          connectedAccounts: { googlesheets: [accountId] },
          manageConnections: { enable: false },
          sandbox: { enable: false },
          instant: false,
        });
        this.sessions.set(owner, session);
      }
      const result = await session.execute(
        "GOOGLESHEETS_BATCH_GET",
        {
          spreadsheet_id: sheetId,
          ranges: ["Workload!A1:B4"],
        },
        { account: accountId },
      );
      if (result.resultType !== "completed" || result.error)
        throw new DomainError(
          502,
          "COMPOSIO_TOOL_FAILED",
          "Composio did not return the selected workload manifest. No workload requirements were assumed.",
        );
      return parseWorkloadManifest(result.data, sheetId, date);
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError(
        502,
        "COMPOSIO_READ_FAILED",
        "Composio could not read the selected workload manifest. Verify its existing connection, read-only spreadsheet access and selected range. No expanded scopes or fixture fallback were used.",
      );
    }
  }
}

/** Untrusted selected sheet data is constrained to four numeric/enum fields. It never supplies instructions or executable code. */
export function parseWorkloadManifest(
  raw: unknown,
  sheetId: string,
  date: string,
): WorkloadSnapshot {
  const record = z.record(z.string(), z.unknown()).parse(raw);
  const payload = record.response_data ?? record.data ?? record;
  const parsed = z
    .object({
      spreadsheetId: z.string(),
      valueRanges: z
        .array(
          z.object({
            values: z.array(z.array(z.union([z.string(), z.number()]))).max(4),
          }),
        )
        .length(1),
    })
    .safeParse(payload);
  if (!parsed.success || parsed.data.spreadsheetId !== sheetId)
    throw new DomainError(
      502,
      "WORKLOAD_UNKNOWN",
      "Selected workload manifest is missing, malformed or from the wrong spreadsheet.",
    );
  const rows = parsed.data.valueRanges[0].values;
  const fields = Object.fromEntries(
    rows.map((row) => [String(row[0]), row[1]]),
  );
  const manifest = z
    .object({
      gpuCount: z.coerce.number().int().min(1).max(8),
      minVramGb: z.coerce.number().int().min(1).max(192),
      runtimeMinutes: z.coerce.number().int().min(15).max(120),
      trustClass: z.literal("public-demo"),
    })
    .strict()
    .safeParse(fields);
  if (
    !manifest.success ||
    rows.length !== 4 ||
    new Set(rows.map((row) => row[0])).size !== 4
  )
    throw new DomainError(
      502,
      "WORKLOAD_UNKNOWN",
      "Manifest must contain exactly gpuCount, minVramGb, runtimeMinutes and trustClass=public-demo. No private or executable workload data is supported.",
    );
  return {
    mode: "live",
    checkedAt: new Date().toISOString(),
    date,
    label: "Composio · selected workload manifest read",
    busy: [],
    manifest: manifest.data,
  };
}
