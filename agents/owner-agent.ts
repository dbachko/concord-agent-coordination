import type { State, Owner, Offer, Request } from "../server/types.js";
/** A deterministic owner agent. Its private store never enters a peer's serialized view. */
export class OwnerAgent {
  constructor(
    private state: State,
    readonly owner: Owner,
    private now: Date = new Date(),
  ) {}
  evaluate(
    offer: Offer,
    request: Request,
  ): { accepted: boolean; code: string } {
    const limits = this.state.owners[this.owner].limits;
    const manifest = this.state.owners[this.owner].workloadEvidence?.manifest;
    if (
      manifest &&
      (limits.gpuCount < manifest.gpuCount ||
        limits.minVramGb < manifest.minVramGb ||
        limits.runtimeMinutes < manifest.runtimeMinutes ||
        manifest.trustClass !== "public-demo")
    )
      return { accepted: false, code: "WORKLOAD_REQUIREMENTS" };
    if (offer.shares[this.owner] > limits.maxBudgetCents)
      return { accepted: false, code: "PRIVATE_LIMIT" };
    if (offer.start < limits.window.start || offer.end > limits.window.end)
      return { accepted: false, code: "PRIVATE_SCHEDULE" };
    const cal = this.state.owners[this.owner].workloadEvidence;
    if (!cal || cal.date !== request.need.date)
      return { accepted: false, code: "WORKLOAD_UNKNOWN" };
    if (
      cal.mode === "live" &&
      this.now.getTime() - Date.parse(cal.checkedAt) > 2 * 60000
    )
      return { accepted: false, code: "WORKLOAD_STALE" };
    if (cal.busy.some((b) => offer.start < b.end && offer.end > b.start))
      return { accepted: false, code: "WORKLOAD_CONFLICT" };
    return { accepted: true, code: "ACCEPT" };
  }
}
