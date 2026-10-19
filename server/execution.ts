import { randomUUID } from "node:crypto";

export type ExecutionStep = { actor: string; label: string };
export type ExecutionRun = {
  id: string;
  agreementId: string;
  status: "running" | "paused" | "completed" | "failed" | "cancelled";
  next: ExecutionStep | null;
  steps: number;
  elapsedMs: number;
  startedAt: string;
};
type Job = {
  run: ExecutionRun;
  iterator: Generator<ExecutionStep, void, unknown>;
  started: number;
  resolve: () => void;
  done: Promise<void>;
  scheduled?: NodeJS.Immediate;
};

/** Executes the next generator segment, never replays a completed transcript. */
export class Execution {
  enabled = false;
  mode: "automatic" | "step" = "automatic";
  private jobs = new Map<string, Job>();
  private history = new Map<string, ExecutionRun>();
  constructor(
    private changed: () => void,
    private valid: (agreementId: string) => boolean,
    private failed: (agreementId: string) => void,
    private succeeded: (agreementId: string) => boolean,
  ) {}
  start(
    agreementId: string,
    iterator: Generator<ExecutionStep, void, unknown>,
  ) {
    this.cancel(agreementId);
    let resolve!: () => void;
    const job: Job = {
      run: {
        id: randomUUID(),
        agreementId,
        status: "running",
        next: { actor: "Concord", label: "Start policy negotiation" },
        steps: 0,
        elapsedMs: 0,
        startedAt: new Date().toISOString(),
      },
      iterator,
      started: performance.now(),
      resolve: () => resolve(),
      done: new Promise<void>((r) => {
        resolve = r;
      }),
    };
    this.jobs.set(agreementId, job);
    this.advance(job); // Start the run; manual mode pauses before the first policy operation.
  }
  private finish(job: Job, status: ExecutionRun["status"]) {
    if (job.scheduled) clearImmediate(job.scheduled);
    job.run.status = status;
    job.run.next = null;
    job.run.elapsedMs = Math.round(performance.now() - job.started);
    this.jobs.delete(job.run.agreementId);
    this.history.set(job.run.agreementId, structuredClone(job.run));
    job.resolve();
    this.changed();
  }
  private advance(job: Job) {
    if (this.jobs.get(job.run.agreementId) !== job) return;
    if (!this.valid(job.run.agreementId)) return this.finish(job, "cancelled");
    job.scheduled = undefined;
    try {
      const result = job.iterator.next();
      job.run.steps++;
      job.run.elapsedMs = Math.round(performance.now() - job.started);
      if (result.done)
        return this.finish(
          job,
          this.succeeded(job.run.agreementId) ? "completed" : "failed",
        );
      job.run.next = result.value;
      job.run.status = this.mode === "step" ? "paused" : "running";
      this.changed();
      if (this.mode === "automatic")
        job.scheduled = setImmediate(() => this.advance(job));
    } catch {
      this.failed(job.run.agreementId); // Never expose exception text, tool payloads or private limits.
      this.finish(job, "failed");
    }
  }
  setMode(mode: "automatic" | "step") {
    this.mode = mode;
    for (const job of this.jobs.values()) {
      if (job.scheduled) clearImmediate(job.scheduled);
      job.scheduled = undefined;
      job.run.status = mode === "step" ? "paused" : "running";
      if (mode === "automatic")
        job.scheduled = setImmediate(() => this.advance(job));
    }
    this.changed();
  }
  step(agreementId: string) {
    const job = this.jobs.get(agreementId);
    if (!job || this.mode !== "step") return false;
    this.advance(job);
    return true;
  }
  cancel(agreementId: string) {
    const job = this.jobs.get(agreementId);
    if (job) {
      job.iterator.return();
      this.finish(job, "cancelled");
    }
  }
  cancelAll() {
    for (const id of [...this.jobs.keys()]) this.cancel(id);
  }
  run(agreementId?: string) {
    if (!agreementId) return undefined;
    const run =
      this.jobs.get(agreementId)?.run ?? this.history.get(agreementId);
    return run && structuredClone(run);
  }
  async idle() {
    while (this.mode === "automatic" && this.jobs.size)
      await Promise.all([...this.jobs.values()].map((job) => job.done));
  }
}
