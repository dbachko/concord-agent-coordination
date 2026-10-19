import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { DomainError } from "../server/engine.js";
import { Integrations } from "../server/integrations.js";
import { nextSaturday, OwnerSchema } from "../server/types.js";

// One explicitly selected owner can validate the read adapter independently.
// The guard is mandatory; this command never changes persistent configuration.
const owner = OwnerSchema.parse(process.argv[2] ?? "alice");
const env = { ...process.env, COMPOSIO_MODE: "live" };
const report: Record<string, unknown> = {
  checkedAt: new Date().toISOString(),
  owner,
  operation: "GOOGLESHEETS_BATCH_GET",
  range: "Workload!A1:B4",
  bookingAttempted: false,
};
try {
  const snapshot = await new Integrations(env).workloadEvidence(
    owner,
    nextSaturday(),
  );
  report.ok = true;
  report.mode = snapshot.mode;
  report.manifest = snapshot.manifest;
  console.log(JSON.stringify(report, null, 2));
  console.log(
    "Selected-owner live workload read succeeded. This does not verify the other owner, Parallel, provider pricing or availability.",
  );
} catch (error) {
  report.ok = false;
  report.error =
    error instanceof DomainError
      ? { code: error.code, message: error.message }
      : {
          code: "UNEXPECTED_RESPONSE",
          message: "No supported live result was recorded.",
        };
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
}
mkdirSync(".data", { recursive: true, mode: 0o700 });
writeFileSync(
  `.data/composio-${owner}-verification.json`,
  JSON.stringify(report, null, 2),
  { mode: 0o600 },
);
