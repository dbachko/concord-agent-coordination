import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { Integrations } from "../server/integrations.js";
import { DomainError } from "../server/engine.js";
import { nextSaturday, OWNERS } from "../server/types.js";

// Real, read-only remote calls. Never print credentials, account IDs, or busy intervals.
const integrations = new Integrations(),
  status = integrations.status();
const missing = status.parallel.configured && status.composio.configured;
if (
  !missing ||
  status.parallel.mode !== "live" ||
  status.composio.mode !== "live"
) {
  console.error(
    "Live verification blocked. Configure .env using .env.example.",
  );
  if (!status.parallel.configured) console.error(status.parallel.blocker);
  if (!status.composio.configured) console.error(status.composio.blocker);
  console.error(
    "Both PARALLEL_MODE and COMPOSIO_MODE must be live. No remote calls were made.",
  );
  process.exitCode = 1;
} else {
  const report: Record<string, unknown> = {
    checkedAt: new Date().toISOString(),
    date: nextSaturday(),
    realCalls: true,
    bookingAttempted: false,
  };
  try {
    const research = await integrations.research();
    report.parallel = {
      mode: research.mode,
      searchId: research.searchId,
      sourceCount: research.sources.length,
      sourceUrls: research.sources.map((s) => s.url),
    };
    console.log(
      `Parallel: real search succeeded; ${research.sources.length} source-backed results.`,
    );
    for (const owner of OWNERS) {
      const workloadEvidence = await integrations.workloadEvidence(
        owner,
        nextSaturday(),
      );
      report[owner] = {
        workloadEvidenceMode: workloadEvidence.mode,
        checkedAt: workloadEvidence.checkedAt,
        busyIntervalCount: workloadEvidence.busy.length,
      };
      console.log(
        `Composio ${owner}: real selected-workloadEvidence read succeeded; busy details withheld.`,
      );
    }
    report.ok = true;
    console.log(
      "All required live API calls succeeded. This verifies research and selected-workloadEvidence access, not a GPU provider quote or availability.",
    );
  } catch (error) {
    report.ok = false;
    report.error =
      error instanceof DomainError
        ? { code: error.code, message: error.message }
        : {
            code: "UNEXPECTED_RESPONSE",
            message:
              "A live call did not return a supported response. No success is claimed.",
          };
    console.error(JSON.stringify(report.error));
    process.exitCode = 1;
  }
  mkdirSync(".data", { recursive: true, mode: 0o700 });
  writeFileSync(
    ".data/live-verification.json",
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
}
