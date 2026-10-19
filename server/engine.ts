import { OwnerAgent } from "../agents/owner-agent.js";
import { createHash, randomUUID } from "node:crypto";
import {
  type Agreement,
  type ProposalRef,
  type DecisionResponse,
  type FinalApproval,
  type CounterInput,
  type OpportunityResponse,
  type WorkloadSnapshot,
  type Event,
  type NeedInput,
  type Offer,
  type Owner,
  type Proposal,
  type Request,
  type State,
  defaults,
  names,
  OfferSchema,
  OWNERS,
  PROVIDER,
  other,
} from "./types.js";

export class DomainError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const digest = (data: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(data ?? null))
    .digest("hex");
const publicNeed = ({
  maxBudgetCents: _budget,
  consent: _consent,
  ...need
}: NeedInput) => need;
export function fixtureResearch(): State["research"] {
  return {
    mode: "fixture",
    checkedAt: new Date().toISOString(),
    status:
      "Mock research selected. No Parallel request was made. These reference links are illustrative, not live search results or verified offers.",
    sources: [
      {
        title: "Runpod — GPU pod reference",
        url: "https://docs.runpod.io/pods/overview",
        excerpt:
          "Reference only. Multi-GPU host capacity, tenancy permission, isolation, prices and availability require live verification.",
      },
      {
        title: "NVIDIA — explicit GPU device assignment",
        url: "https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/docker-specialized.html",
        excerpt:
          "Device assignment is not a tenant security boundary. No host, quote or available GPU has been verified.",
      },
    ],
  };
}
export function freshState(): State {
  return {
    schemaVersion: 4,
    watches: {},
    opportunities: [],
    owners: defaults(),
    requests: [],
    agreements: [],
    events: [],
    research: fixtureResearch(),
    provider: { ...PROVIDER },
    commands: {},
  };
}

export class Engine {
  constructor(
    public state: State = freshState(),
    public now: () => Date = () => new Date(),
  ) {}
  at() {
    return this.now().toISOString();
  }
  emit(
    type: string,
    title: string,
    detail: string,
    actor: Event["actor"] = "Concord",
    scope: Event["scope"] = "shared",
    agreementId?: string,
  ) {
    this.state.events.push({
      id: randomUUID(),
      sequence:
        (this.state.events.at(-1)?.sequence ?? this.state.events.length) + 1,
      at: this.at(),
      type,
      title,
      detail,
      actor,
      scope,
      agreementId,
    });
  }
  active(owner: Owner) {
    return this.state.requests.find(
      (r) => r.owner === owner && r.status === "active",
    );
  }
  latest(a: Agreement): Proposal | undefined {
    return a.proposals.at(-1);
  }
  selectProvider(sourceUrl: string, totalCents: number) {
    if (this.state.research.mode !== "live")
      throw new DomainError(
        409,
        "LIVE_RESEARCH_REQUIRED",
        "Run Parallel research successfully before selecting a real candidate.",
      );
    const source = this.state.research.sources.find((s) => s.url === sourceUrl);
    if (!source)
      throw new DomainError(
        400,
        "UNKNOWN_SOURCE",
        "Select a source returned by the current Parallel research.",
      );
    const selected = {
      ...PROVIDER,
      mode: "research-backed" as const,
      name: source.title.slice(0, 180),
      sourceUrl,
      sourceTitle: source.title,
      totalCents,
    };
    if (digest(selected) === digest(this.state.provider)) return;
    this.state.provider = selected;
    this.emit(
      "candidate_selected",
      "A researched service candidate was selected",
      "The source is real. The cost is an owner-selected planning envelope; capacity, device assignment, multi-tenant permission and availability still require provider confirmation. No booking was made.",
    );
    for (const a of this.state.agreements)
      if (
        [
          "awaiting_response",
          "awaiting_approval",
          "approved",
          "infeasible",
          "rejected",
        ].includes(a.status)
      ) {
        const old = this.latest(a);
        if (old && ["pending", "approved"].includes(old.status)) {
          old.status = "superseded";
          old.approvals = {};
        }
        this.negotiate(a);
      }
  }
  current(owner: Owner) {
    const req = [...this.state.requests]
      .reverse()
      .find((r) => r.owner === owner);
    return req
      ? [...this.state.agreements]
          .reverse()
          .find((a) => a.requestIds[owner] === req.id)
      : undefined;
  }
  idempotent(owner: Owner, key: string, payload: unknown, run: () => void) {
    this.sweep();
    const id = `${owner}:${key}`,
      fingerprint = digest(payload),
      old = this.state.commands[id];
    if (old) {
      if (old.digest !== fingerprint)
        throw new DomainError(
          409,
          "IDEMPOTENCY_CONFLICT",
          "This command key was already used with different input.",
        );
      return;
    }
    run();
    this.state.commands[id] = { digest: fingerprint };
  }
  delegate(owner: Owner, need: NeedInput, workloadEvidence: WorkloadSnapshot) {
    if (need.date <= this.at().slice(0, 10))
      throw new DomainError(
        422,
        "DATE_PAST",
        "Choose a future date for this demo.",
      );
    if (this.active(owner)) {
      if (digest(this.state.owners[owner].limits) === digest(need)) return;
      throw new DomainError(
        409,
        "ALREADY_ACTIVE",
        "You already have an active need. Update its constraints.",
      );
    }
    this.state.owners[owner] = {
      limits: structuredClone(need),
      workloadEvidence,
    };
    this.state.requests.push({
      id: randomUUID(),
      owner,
      need: publicNeed(need),
      revision: 1,
      status: "active",
      expiresAt: new Date(this.now().getTime() + 30 * 60000).toISOString(),
    });
    this.emit(
      "delegated",
      `${names[owner]} delegated a selected need`,
      `${need.region}; ${need.gpuCount} GPU devices. Only the selected date, region, window, and capacity requirement enter the match pool.`,
      names[owner],
    );
    this.emit(
      "workloadEvidence_read",
      "Selected workload manifest checked",
      `${workloadEvidence.label}. Manifest fields are checked by your private owner agent.`,
      `${names[owner]}’s agent`,
      owner,
    );
    this.match();
    this.findOpportunities();
    if (!this.current(owner))
      this.emit(
        "waiting_for_match",
        "Request posted; waiting for a compatible workload",
        "No agreement exists yet. A compatible active request will trigger negotiation automatically.",
        `${names[owner]}’s agent`,
        owner,
      );
  }
  update(owner: Owner, need: NeedInput, workloadEvidence: WorkloadSnapshot) {
    const req = this.active(owner);
    if (!req)
      throw new DomainError(
        409,
        "NO_ACTIVE_REQUEST",
        "Delegate an active need before changing constraints.",
      );
    if (need.date <= this.at().slice(0, 10))
      throw new DomainError(
        422,
        "DATE_PAST",
        "Choose a future date for this demo.",
      );
    const unchanged =
      digest(need) === digest(this.state.owners[owner].limits) &&
      digest(workloadEvidence.busy) ===
        digest(this.state.owners[owner].workloadEvidence?.busy) &&
      digest(workloadEvidence.manifest) ===
        digest(this.state.owners[owner].workloadEvidence?.manifest);
    if (unchanged) return;
    this.state.owners[owner] = {
      limits: structuredClone(need),
      workloadEvidence,
    };
    req.need = publicNeed(need);
    req.revision++;
    this.emit(
      "constraint_changed",
      `${names[owner]} changed a constraint`,
      "The previous proposal and all its approvals are invalid. Both owners must review the replacement terms.",
      names[owner],
    );
    const agreement = this.current(owner);
    if (agreement) {
      const old = this.latest(agreement);
      if (old && ["pending", "approved"].includes(old.status)) {
        old.status = "superseded";
        old.approvals = {};
      }
      if (!["cancelled", "expired"].includes(agreement.status))
        this.negotiate(agreement);
    } else this.match();
    this.findOpportunities();
  }
  watch(owner: Owner, need: NeedInput) {
    if (this.active(owner))
      throw new DomainError(
        409,
        "ALREADY_ACTIVE",
        "Withdraw your selected request before replacing it with an opportunity watch.",
      );
    if (need.date <= this.at().slice(0, 10))
      throw new DomainError(
        422,
        "DATE_PAST",
        "Choose a future compute date for this watch.",
      );
    const previous = this.state.watches[owner];
    if (previous?.status === "active" && digest(previous.need) === digest(need))
      return;
    for (const opportunity of this.state.opportunities)
      if (opportunity.owner === owner && opportunity.status === "pending")
        opportunity.status = "expired";
    this.state.watches[owner] = {
      id: randomUUID(),
      owner,
      need: structuredClone(need),
      status: "active",
      createdAt: this.at(),
      expiresAt: new Date(this.now().getTime() + 60 * 60000).toISOString(),
    };
    this.state.owners[owner].limits = structuredClone(need);
    this.emit(
      "watch_enabled",
      `${names[owner]} opted into selected GPU opportunities`,
      "Only the selected resource requirements, region, date/window and private limit are stored. No full memory is uploaded. No active rental request or acceptance was created.",
      names[owner],
      owner,
    );
    this.findOpportunities();
  }
  pauseWatch(owner: Owner, paused: boolean) {
    const watch = this.state.watches[owner];
    if (!watch || watch.status === "expired")
      throw new DomainError(
        409,
        "NO_ACTIVE_WATCH",
        "Create an opt-in watch before changing its pause state.",
      );
    if (watch.status === (paused ? "paused" : "active")) return;
    watch.status = paused ? "paused" : "active";
    this.emit(
      paused ? "watch_paused" : "watch_resumed",
      paused ? "Opportunity watch paused" : "Opportunity watch resumed",
      "This affects only the local opt-in watch. No scheduled production monitor or external outreach is configured.",
      names[owner],
      owner,
    );
    if (!paused) this.findOpportunities();
  }
  relevant(owner: Owner, request: Request) {
    const watch = this.state.watches[owner],
      provider = this.state.provider;
    return Boolean(
      watch &&
      watch.status === "active" &&
      watch.expiresAt > this.at() &&
      request.status === "active" &&
      request.expiresAt > this.at() &&
      watch.need.region === request.need.region &&
      watch.need.date === request.need.date &&
      watch.need.gpuCount + request.need.gpuCount <= provider.capacity &&
      Math.max(watch.need.minVramGb, request.need.minVramGb) <=
        provider.vramPerGpuGb &&
      Math.max(watch.need.runtimeMinutes, request.need.runtimeMinutes) <=
        provider.duration &&
      Math.min(watch.need.window.end, request.need.window.end, provider.end) -
        Math.max(
          watch.need.window.start,
          request.need.window.start,
          provider.start,
        ) >=
        provider.duration,
    );
  }
  findOpportunities() {
    for (const owner of OWNERS) {
      const watch = this.state.watches[owner];
      if (!watch || watch.status !== "active" || this.active(owner)) continue;
      const peer = this.active(other(owner));
      if (!peer) continue;
      const existing = this.state.opportunities.find(
        (o) => o.watchId === watch.id && o.requestId === peer.id,
      );
      if (existing) {
        if (existing.status === "pending") {
          if (!this.relevant(owner, peer)) existing.status = "expired";
          else existing.requestRevision = peer.revision;
        }
        continue;
      }
      if (!this.relevant(owner, peer)) continue;
      const opportunity = {
        id: randomUUID(),
        owner,
        watchId: watch.id,
        requestId: peer.id,
        requestRevision: peer.revision,
        status: "pending" as const,
        reason:
          "Matches your selected GPU-compute interest: same region and date, overlapping two-hour window, and separate whole GPUs within the simulated host capacity.",
        createdAt: this.at(),
        expiresAt: new Date(
          Math.min(
            Date.parse(peer.expiresAt),
            Date.parse(watch.expiresAt),
            this.now().getTime() + 15 * 60000,
          ),
        ).toISOString(),
      };
      this.state.opportunities.push(opportunity);
      this.emit(
        "opportunity_ready",
        "A compatible GPU opportunity appeared",
        opportunity.reason +
          " Would you like to check it? No price benefit or savings is verified.",
        "Concord",
        owner,
      );
    }
  }
  respondOpportunity(
    owner: Owner,
    input: OpportunityResponse,
    evidence?: WorkloadSnapshot,
  ) {
    this.sweep();
    if (input.ownerId !== owner)
      throw new DomainError(
        403,
        "OWNER_MISMATCH",
        "Use your own owner capability and ownerId.",
      );
    const opportunity = this.state.opportunities.find(
      (o) => o.id === input.opportunityId && o.owner === owner,
    );
    if (!opportunity)
      throw new DomainError(
        404,
        "OPPORTUNITY_NOT_FOUND",
        "No such opportunity exists for this owner.",
      );
    if (
      opportunity.status === "explored" &&
      input.action === "explore" &&
      opportunity.requestRevision === input.requestRevision
    )
      return;
    const watch = this.state.watches[owner],
      request = this.state.requests.find((r) => r.id === opportunity.requestId);
    if (
      !watch ||
      watch.id !== opportunity.watchId ||
      watch.status !== "active" ||
      opportunity.status !== "pending" ||
      opportunity.expiresAt <= this.at() ||
      !request ||
      !this.relevant(owner, request)
    )
      throw new DomainError(
        409,
        "OPPORTUNITY_INACTIVE",
        "This opportunity expired, was dismissed, or its watch is paused. No evaluation started.",
      );
    if (
      request.revision !== input.requestRevision ||
      opportunity.requestRevision !== input.requestRevision
    )
      throw new DomainError(
        409,
        "STALE_OPPORTUNITY",
        "The candidate request changed. Fetch the updated opportunity before responding.",
      );
    if (input.action === "dismiss") {
      opportunity.status = "dismissed";
      this.emit(
        "opportunity_dismissed",
        "Opportunity dismissed",
        "This watch/request pair will not notify you again. No request or agreement was accepted.",
        names[owner],
        owner,
      );
      return;
    }
    if (this.active(owner))
      throw new DomainError(
        409,
        "ALREADY_ACTIVE",
        "Review or withdraw your active request before exploring a different opportunity.",
      );
    if (!evidence)
      throw new DomainError(
        409,
        "WORKLOAD_REQUIRED",
        "Selected workload evidence must be checked before evaluation.",
      );
    opportunity.status = "explored";
    try {
      this.delegate(owner, watch.need, evidence);
      opportunity.delegatedRequestId = this.active(owner)!.id;
    } catch (error) {
      opportunity.status = "pending";
      throw error;
    }
    this.emit(
      "opportunity_explored",
      "You chose to evaluate the opportunity",
      "Your selected need entered negotiation. No exploration response or final agreement approval was inferred.",
      names[owner],
      owner,
    );
  }
  opportunityView(owner: Owner) {
    const watch = this.state.watches[owner];
    const opportunity = [...this.state.opportunities]
      .reverse()
      .find(
        (o) =>
          o.owner === owner &&
          o.status === "pending" &&
          o.expiresAt > this.at(),
      );
    if (!opportunity || !watch || watch.status !== "active") return undefined;
    const request = this.state.requests.find(
      (r) => r.id === opportunity.requestId,
    );
    if (!request || !this.relevant(owner, request)) return undefined;
    return {
      ...opportunity,
      question:
        "This might interest you. Would you like to check this GPU-compute opportunity?",
      candidate: { owner: names[request.owner], need: request.need },
      providerMode: this.state.provider.mode,
      benefit: "Unverified: no savings estimate is claimed.",
      allowedResponses: ["explore", "dismiss"],
    };
  }

  match() {
    const alice = this.active("alice"),
      bob = this.active("bob");
    if (!alice || !bob) return;
    if (
      this.state.agreements.some(
        (a) => a.requestIds.alice === alice.id && a.requestIds.bob === bob.id,
      )
    )
      return;
    if (
      alice.need.region !== bob.need.region ||
      alice.need.date !== bob.need.date
    )
      return;
    const a: Agreement = {
      id: randomUUID(),
      requestIds: { alice: alice.id, bob: bob.id },
      proposals: [],
      status: "negotiating",
    };
    this.state.agreements.push(a);
    this.emit(
      "matched",
      "Two compatible needs found",
      "Same compute region and date. Owner agents will now check time, capacity, and proposed cost shares.",
      "Concord",
      "shared",
      a.id,
    );
    this.negotiate(a);
  }
  validate(
    agreement: Agreement,
    input: unknown,
  ): { ok: boolean; code: string } {
    const parsed = OfferSchema.safeParse(input);
    if (!parsed.success) return { ok: false, code: "INVALID_OFFER" };
    const offer = parsed.data;
    const provider = this.state.provider;
    if (
      offer.totalCents !== provider.totalCents ||
      offer.shares.alice + offer.shares.bob !== offer.totalCents
    )
      return { ok: false, code: "ARITHMETIC" };
    if (
      offer.provider !== provider.name ||
      offer.providerMode !== provider.mode ||
      offer.providerSource !== provider.sourceUrl ||
      offer.capacity !== provider.capacity ||
      offer.end - offer.start !== provider.duration ||
      offer.start < provider.start ||
      offer.end > provider.end
    )
      return { ok: false, code: "PROVIDER_TERMS" };
    const reqs = OWNERS.map((o) =>
      this.state.requests.find((r) => r.id === agreement.requestIds[o]),
    );
    if (
      reqs.some((r) => !r || r.status !== "active" || r.expiresAt <= this.at())
    )
      return { ok: false, code: "INACTIVE_REQUEST" };
    const [alice, bob] = reqs as [Request, Request];
    if (
      alice.need.region !== bob.need.region ||
      alice.need.date !== bob.need.date
    )
      return { ok: false, code: "MATCH_CHANGED" };
    if (alice.need.gpuCount + bob.need.gpuCount > offer.capacity)
      return { ok: false, code: "CAPACITY" };
    const assignments = OWNERS.flatMap((o) => offer.deviceAssignments[o]);
    if (
      offer.vramPerGpuGb !== provider.vramPerGpuGb ||
      new Set(assignments).size !== assignments.length ||
      assignments.some((i) => i >= offer.capacity) ||
      OWNERS.some(
        (o) =>
          offer.deviceAssignments[o].length !==
          this.state.requests.find((r) => r.id === agreement.requestIds[o])!
            .need.gpuCount,
      )
    )
      return { ok: false, code: "GPU_ASSIGNMENT" };
    if (
      reqs.some(
        (r) =>
          r!.need.minVramGb > provider.vramPerGpuGb ||
          r!.need.runtimeMinutes > provider.duration ||
          r!.need.trustClass !== "public-demo",
      )
    )
      return { ok: false, code: "GPU_REQUIREMENTS" };
    for (const o of OWNERS) {
      const request = reqs.find((r) => r!.owner === o)!;
      if (
        offer.start < request.need.window.start ||
        offer.end > request.need.window.end
      )
        return { ok: false, code: "TIME_WINDOW" };
      if (
        !new OwnerAgent(this.state, o, this.now()).evaluate(offer, request)
          .accepted
      )
        return { ok: false, code: "OWNER_DECLINED" };
    }
    return { ok: true, code: "VALID" };
  }
  negotiate(a: Agreement) {
    a.status = "negotiating";
    delete a.reason;
    this.emit(
      "agent_negotiation_started",
      "Agents checking selected needs",
      "Deterministic policy agents; no owner approval inferred.",
      "Concord",
      "shared",
      a.id,
    );
    const reqs = OWNERS.map((o) =>
      this.state.requests.find((r) => r.id === a.requestIds[o])!,
    );
    const [alice, bob] = reqs,
      provider = this.state.provider;
    if (reqs.some((r) => r.status !== "active" || r.expiresAt <= this.at()))
      return this.fail(a, "An owner request is no longer active.");
    if (
      alice.need.date !== bob.need.date ||
      alice.need.region !== bob.need.region
    )
      return this.fail(
        a,
        "The selected dates or service regions no longer match.",
      );
    if (
      OWNERS.some((o) => {
        const cal = this.state.owners[o].workloadEvidence;
        return (
          !cal ||
          cal.date !== alice.need.date ||
          (cal.mode === "live" &&
            this.now().getTime() - Date.parse(cal.checkedAt) > 2 * 60000)
        );
      })
    )
      return this.fail(
        a,
        "Selected workload evidence is missing or stale. Refresh it before reviewing a new proposal.",
      );
    if (alice.need.gpuCount + bob.need.gpuCount > provider.capacity)
      return this.fail(
        a,
        "Combined GPU count exceeds the planning capacity limit.",
      );
    if (
      reqs.some(
        (r) =>
          r.need.minVramGb > provider.vramPerGpuGb ||
          r.need.runtimeMinutes > provider.duration ||
          r.need.trustClass !== "public-demo",
      )
    )
      return this.fail(
        a,
        "GPU VRAM, runtime or workload trust requirements exceed this planning host. Single-GPU slicing is not supported.",
      );
    const earliest = Math.max(
      provider.start,
      ...reqs.map((r) => r.need.window.start),
    );
    const latest = Math.min(
      provider.end,
      ...reqs.map((r) => r.need.window.end),
    );
    let start: number | undefined;
    for (let t = earliest; t + provider.duration <= latest; t += 15) {
      if (
        OWNERS.every((o) => {
          const cal = this.state.owners[o].workloadEvidence;
          return (
            cal &&
            cal.date === alice.need.date &&
            !cal.busy.some((b) => t < b.end && t + provider.duration > b.start)
          );
        })
      ) {
        start = t;
        break;
      }
    }
    if (start === undefined)
      return this.fail(
        a,
        "No common two-hour window remains after private scheduling constraints.",
      );
    const total = provider.totalCents;
    const agents = {
      alice: new OwnerAgent(this.state, "alice", this.now()),
      bob: new OwnerAgent(this.state, "bob", this.now()),
    };
    const publicNeeds = { alice: alice.need, bob: bob.need };
    const seen = new Set<number>();
    const policies = [
      { proposer: "bob", policy: "equal" },
      { proposer: "alice", policy: "usage" },
    ] as const;
    for (const [i, { proposer, policy }] of policies.entries()) {
      const shares = agents[proposer].proposeShares(total, publicNeeds, policy);
      if (seen.has(shares.alice)) continue;
      seen.add(shares.alice);
      this.emit(
        i ? "agent_counteroffer" : "agent_offer",
        `${i ? "Counters by usage" : "Proposes equal split"} · Alice $${(shares.alice / 100).toFixed(2)} / Bob $${(shares.bob / 100).toFixed(2)}`,
        "Structured offer generated from selected public requirements. Private limits are withheld.",
        `${names[proposer]}’s agent`,
        "shared",
        a.id,
      );
      const offer: Offer = {
        start,
        end: start + provider.duration,
        totalCents: total,
        shares,
        capacity: provider.capacity,
        provider: provider.name,
        providerMode: provider.mode,
        vramPerGpuGb: provider.vramPerGpuGb,
        deviceAssignments: {
          alice: Array.from({ length: alice.need.gpuCount }, (_, i) => i),
          bob: Array.from(
            { length: bob.need.gpuCount },
            (_, i) => alice.need.gpuCount + i,
          ),
        },
        ...(provider.sourceUrl ? { providerSource: provider.sourceUrl } : {}),
      };
      const decisions = OWNERS.map((owner) => ({
        owner,
        ...agents[owner].evaluate(offer, owner === "alice" ? alice : bob),
      }));
      for (const decision of decisions.filter(
        (decision) => !decision.accepted,
      )) {
        this.emit(
          "agent_rejected",
          "Rejects: private constraints",
          "The proposed terms failed this agent's private policy checks. Limits are withheld.",
          `${names[decision.owner]}’s agent`,
          "shared",
          a.id,
        );
      }
      const result = this.validate(a, offer);
      if (!result.ok) {
        this.emit(
          "offer_rejected",
          `Round ${i + 1}: offer rejected`,
          `Allocation ${offer.shares.alice / 100}/${offer.shares.bob / 100} USD did not pass both owner agents. Private limits are withheld.`,
          "Concord",
          "shared",
          a.id,
        );
        continue;
      }
      this.emit(
        "agent_consensus",
        "Both agents accept these terms",
        "All feasibility and private policy checks passed. Owner approval is still required.",
        "Concord",
        "shared",
        a.id,
      );
      this.emit(
        "counterproposal",
        i
          ? "Counterproposal passed both agents"
          : "Proposal passed both agents",
        `${i ? "GPU-minute-based" : "Equal"} allocation; integer-cent arithmetic, selected time, provider capacity, and both private budgets passed. ${i + 1} of 2 permitted rounds used.`,
        "Concord",
        "shared",
        a.id,
      );
      this.appendProposal(a, offer);

      return;
    }
    this.fail(
      a,
      "No permitted cost allocation passed both private owner checks. Negotiation stopped after its bounded rounds.",
    );
  }
  offerOf(p: Proposal): Offer {
    const {
      start,
      end,
      totalCents,
      shares,
      capacity,
      provider,
      providerMode,
      providerSource,
      deviceAssignments,
      vramPerGpuGb,
    } = p;
    return {
      start,
      end,
      totalCents,
      shares,
      capacity,
      provider,
      providerMode,
      deviceAssignments,
      vramPerGpuGb,
      ...(providerSource ? { providerSource } : {}),
    };
  }
  reference(a: Agreement, p: Proposal): ProposalRef {
    return {
      agreementId: a.id,
      proposalId: p.id,
      version: p.version,
      hash: p.hash,
    };
  }
  appendProposal(a: Agreement, offer: Offer) {
    const previous = this.latest(a);
    if (previous && ["pending", "approved"].includes(previous.status)) {
      previous.status = "superseded";
      previous.approvals = {};
      previous.explorations = {};
    }
    const reqs = OWNERS.map((o) =>
      this.state.requests.find((r) => r.id === a.requestIds[o])!,
    );
    const requestRevisions = { alice: reqs[0].revision, bob: reqs[1].revision };
    const version = a.proposals.length + 1,
      id = randomUUID();
    const expiresAt = new Date(
      Math.min(
        this.now().getTime() + 15 * 60000,
        ...reqs.map((r) => Date.parse(r.expiresAt)),
      ),
    ).toISOString();
    const alternatives: Proposal["alternatives"] = [];
    for (const start of [
      ...new Set([
        offer.start,
        offer.start + 60,
        14 * 60,
        offer.start + 15,
        offer.start + 30,
      ]),
    ]) {
      const candidate = {
        ...offer,
        start,
        end: start + this.state.provider.duration,
      };
      if (this.validate(a, candidate).ok)
        alternatives.push({
          id: randomUUID(),
          label: `${Math.floor(start / 60)}:${String(start % 60).padStart(2, "0")}–${Math.floor(candidate.end / 60)}:${String(candidate.end % 60).padStart(2, "0")} Pacific; Alice $${(candidate.shares.alice / 100).toFixed(2)}, Bob $${(candidate.shares.bob / 100).toFixed(2)}`,
          offer: candidate,
        });
      if (alternatives.length === 3) break;
    }
    const terms = {
      ...offer,
      id,
      version,
      requestRevisions,
      requestIds: a.requestIds,
      date: reqs[0].need.date,
      region: reqs[0].need.region,
      expiresAt,
    };
    const proposal: Proposal = {
      ...offer,
      id,
      version,
      changes: previous
        ? [
            previous.start !== offer.start || previous.end !== offer.end
              ? "Time updated"
              : "",
            digest(previous.shares) !== digest(offer.shares)
              ? "Cost split updated"
              : "",
            digest(previous.deviceAssignments) !==
            digest(offer.deviceAssignments)
              ? "GPU assignment updated"
              : "",
            previous.provider !== offer.provider
              ? "Provider assumptions updated"
              : "",
          ].filter(Boolean)
        : [],
      requestRevisions,
      hash: digest(terms),
      createdAt: this.at(),
      expiresAt,
      approvals: {},
      explorations: {},
      alternatives,
      decisionIds: {
        exploration: { alice: randomUUID(), bob: randomUUID() },
        final_approval: { alice: randomUUID(), bob: randomUUID() },
      },
      status: "pending",
    };
    a.proposals.push(proposal);
    a.status = "awaiting_response";
    delete a.reason;
    this.emit(
      "decision_requested",
      `Proposal v${version}: owners must choose how to continue`,
      "Each owner's main assistant receives concrete terms and feasible alternatives. Consent to explore does not approve the agreement or authorize a booking.",
      "Concord",
      "shared",
      a.id,
    );
  }
  proposalFor(owner: Owner, ref: ProposalRef) {
    this.sweep();
    const a = this.current(owner),
      p = a && this.latest(a);
    if (
      !a ||
      !p ||
      a.id !== ref.agreementId ||
      p.id !== ref.proposalId ||
      p.version !== ref.version ||
      p.hash !== ref.hash
    )
      throw new DomainError(
        409,
        "STALE_PROPOSAL",
        "These terms were replaced. Review the latest proposal before responding.",
      );
    if (
      !["awaiting_response", "awaiting_approval", "approved"].includes(
        a.status,
      ) ||
      !["pending", "approved"].includes(p.status)
    )
      throw new DomainError(
        409,
        "PLAN_INACTIVE",
        "This proposal is expired, declined, withdrawn or infeasible.",
      );
    return { a, p };
  }
  pendingDecision(owner: Owner) {
    const a = this.current(owner),
      p = a && this.latest(a);
    if (
      !a ||
      !p ||
      !["awaiting_response", "awaiting_approval"].includes(a.status) ||
      p.status !== "pending"
    )
      return undefined;
    const stage =
      a.status === "awaiting_response"
        ? ("exploration" as const)
        : ("final_approval" as const);
    const answered =
      stage === "exploration"
        ? p.explorations[owner]?.hash === p.hash
        : p.approvals[owner]?.hash === p.hash;
    return {
      id: p.decisionIds[stage][owner],
      ownerId: owner,
      stage: answered ? ("waiting_for_other_owner" as const) : stage,
      proposal: this.reference(a, p),
      expiresAt: p.expiresAt,
      question: answered
        ? "Your response is recorded. Waiting for the other owner."
        : stage === "exploration"
          ? "Would you like the agents to continue exploring these exact terms, choose a feasible alternative, counter, or decline? This is not final approval."
          : "Do you approve this exact final agreement? This does not authorize booking, payment or deployment.",
      terms: this.offerOf(p),
      alternatives: p.alternatives,
      allowedResponses: answered
        ? ["counter", "decline"]
        : stage === "exploration"
          ? ["explore", "counter", "decline"]
          : ["approve_final_agreement", "counter", "decline"],
    };
  }
  respond(owner: Owner, input: DecisionResponse) {
    const { a, p } = this.proposalFor(owner, input.proposal);
    if (input.ownerId !== owner)
      throw new DomainError(
        403,
        "OWNER_MISMATCH",
        "Use your own owner capability and ownerId.",
      );
    if (input.answer === "explore") {
      if (input.decisionId !== p.decisionIds.exploration[owner])
        throw new DomainError(
          409,
          "STALE_DECISION",
          "This exploration question was replaced. Fetch current status.",
        );
      if (p.explorations[owner]?.hash === p.hash) return;
      if (a.status !== "awaiting_response")
        throw new DomainError(
          409,
          "STAGE_CHANGED",
          "Fetch the current final-approval question.",
        );
      p.explorations[owner] = { hash: p.hash, at: this.at() };
      this.emit(
        "exploration_consented",
        `${names[owner]} agreed to explore v${p.version}`,
        "Intermediate consent only. No final agreement approval, booking, payment or deployment was authorized.",
        names[owner],
        "shared",
        a.id,
      );
      if (OWNERS.every((o) => p.explorations[o]?.hash === p.hash)) {
        a.status = "awaiting_approval";
        this.emit(
          "final_approval_requested",
          `Both owners can now review final agreement v${p.version}`,
          "Each owner must explicitly approve the same proposal ID, version and hash. Exploration responses are not final approvals.",
          "Concord",
          "shared",
          a.id,
        );
      }
      return;
    }
    const expected =
      a.status === "awaiting_response"
        ? p.decisionIds.exploration[owner]
        : p.decisionIds.final_approval[owner];
    if (input.decisionId !== expected)
      throw new DomainError(
        409,
        "STALE_DECISION",
        "The decision stage changed. Fetch the current question.",
      );
    p.status = "rejected";
    p.approvals = {};
    p.explorations = {};
    a.status = "rejected";
    a.reason = `${names[owner]} declined this proposal. No agreement was reached. Requests can be updated or withdrawn separately.`;
    this.emit(
      "proposal_declined",
      `${names[owner]} declined v${p.version}`,
      "The agents stopped this proposal. No acceptance or booking authority was inferred.",
      names[owner],
      "shared",
      a.id,
    );
  }
  counter(owner: Owner, input: CounterInput) {
    const { a, p } = this.proposalFor(owner, input.proposal);
    if (input.ownerId !== owner)
      throw new DomainError(
        403,
        "OWNER_MISMATCH",
        "Use your own owner capability and ownerId.",
      );
    const expected =
      a.status === "awaiting_response"
        ? p.decisionIds.exploration[owner]
        : p.decisionIds.final_approval[owner];
    if (input.decisionId !== expected || a.status === "approved")
      throw new DomainError(
        409,
        "STALE_DECISION",
        "Fetch the active negotiation decision before countering. Update the selected need to reopen an approved plan.",
      );
    if (a.proposals.length >= 6)
      throw new DomainError(
        409,
        "ROUND_LIMIT",
        "The six-version interactive negotiation cap has been reached. Withdraw and submit a new selected need if necessary.",
      );
    const alternative =
      input.alternativeId &&
      p.alternatives.find((x) => x.id === input.alternativeId);
    if (input.alternativeId && !alternative)
      throw new DomainError(
        409,
        "STALE_ALTERNATIVE",
        "Choose an alternative from the current proposal.",
      );
    const offer: Offer = alternative
      ? structuredClone(alternative.offer)
      : { ...this.offerOf(p), ...input.terms! };
    if (digest(offer) === digest(this.offerOf(p)))
      throw new DomainError(
        409,
        "UNCHANGED_TERMS",
        "These are the current terms. Use explore or final approval for the current stage.",
      );
    const validation = this.validate(a, offer);
    if (!validation.ok) {
      this.emit(
        "counter_rejected",
        `${names[owner]}’s counteroffer did not pass checks`,
        "No terms changed. Both owner limits, GPU assignments, time and integer-cent arithmetic must pass.",
        "Concord",
        "shared",
        a.id,
      );
      throw new DomainError(
        422,
        "INFEASIBLE_COUNTER",
        "The counteroffer did not pass both owner agents and deterministic checks. Private limits are withheld.",
      );
    }
    this.emit(
      "owner_counteroffer",
      `${names[owner]} proposed revised terms`,
      "A concrete user-selected counteroffer passed both agents. All prior exploration and final approvals are invalidated.",
      names[owner],
      "shared",
      a.id,
    );
    this.appendProposal(a, offer);
  }

  fail(a: Agreement, reason: string) {
    a.status = "infeasible";
    a.reason = reason;
    this.emit(
      "infeasible",
      "No feasible shared plan",
      reason,
      "Concord",
      "shared",
      a.id,
    );
  }
  approve(owner: Owner, input: FinalApproval) {
    this.sweep();
    const a = this.current(owner),
      p = a && this.latest(a);
    if (
      !a ||
      !p ||
      a.id !== input.agreementId ||
      p.id !== input.proposalId ||
      p.version !== input.version ||
      p.hash !== input.hash
    )
      throw new DomainError(
        409,
        "STALE_PROPOSAL",
        "These terms were replaced. Review the latest proposal before approving.",
      );
    if (input.ownerId !== owner)
      throw new DomainError(
        403,
        "OWNER_MISMATCH",
        "Use your own owner capability and ownerId.",
      );
    if (
      input.authorization !== "final_agreement" ||
      input.decisionId !== p.decisionIds.final_approval[owner]
    )
      throw new DomainError(
        409,
        "FINAL_APPROVAL_REQUIRED",
        "Use the exact current final-agreement approval question.",
      );
    if (!OWNERS.every((o) => p.explorations[o]?.hash === p.hash))
      throw new DomainError(
        409,
        "EXPLORATION_REQUIRED",
        "Both owners must respond to the current exploration question before final agreement approval.",
      );
    if (
      !["awaiting_approval", "approved"].includes(a.status) ||
      !["pending", "approved"].includes(p.status)
    )
      throw new DomainError(
        409,
        "PLAN_INACTIVE",
        "This plan is expired, withdrawn, or infeasible.",
      );
    if (
      OWNERS.some(
        (o) =>
          this.active(o)?.id !== a.requestIds[o] ||
          this.active(o)?.revision !== p.requestRevisions[o],
      )
    )
      throw new DomainError(
        409,
        "STALE_REVISION",
        "An owner changed their selected need.",
      );
    const {
      start,
      end,
      totalCents,
      shares,
      capacity,
      provider,
      providerMode,
      providerSource,
      deviceAssignments,
      vramPerGpuGb,
    } = p;
    if (
      !this.validate(a, {
        start,
        end,
        totalCents,
        shares,
        capacity,
        provider,
        providerMode,
        deviceAssignments,
        vramPerGpuGb,
        ...(providerSource ? { providerSource } : {}),
      }).ok
    )
      throw new DomainError(
        409,
        "VALIDATION_FAILED",
        "The proposal no longer passes all deterministic checks.",
      );
    if (p.approvals[owner]?.hash === p.hash) return;
    p.approvals[owner] = { hash: p.hash, at: this.at() };
    this.emit(
      "approved_by_owner",
      `${names[owner]} approved v${p.version}`,
      `Approval is bound to fingerprint ${p.hash.slice(0, 12)}.`,
      names[owner],
      "shared",
      a.id,
    );
    if (OWNERS.every((o) => p.approvals[o]?.hash === p.hash)) {
      p.status = "approved";
      a.status = "approved";
      this.emit(
        "plan_approved",
        "Agreement reached, awaiting booking authorization",
        "Both owners explicitly approved identical final terms. No booking authorization has been requested or granted. Host availability, tenancy permission, isolation and final quote remain unconfirmed.",
        "Concord",
        "shared",
        a.id,
      );
    }
  }
  withdraw(owner: Owner) {
    const req = this.active(owner);
    if (!req) return;
    req.status = "withdrawn";
    this.emit(
      "withdrawn",
      `${names[owner]} withdrew their need`,
      "This request is out of the match pool. Any shared plan is cancelled and cannot be approved.",
      names[owner],
    );
    const a = this.current(owner);
    if (a) {
      a.status = "cancelled";
      const p = this.latest(a);
      if (p) {
        p.status = "cancelled";
        p.approvals = {};
      }
    }
  }
  sweep() {
    for (const watch of Object.values(this.state.watches))
      if (watch && watch.expiresAt <= this.at()) watch.status = "expired";
    for (const opportunity of this.state.opportunities)
      if (opportunity.status === "pending") {
        const request = this.state.requests.find(
            (r) => r.id === opportunity.requestId,
          ),
          watch = this.state.watches[opportunity.owner];
        if (
          opportunity.expiresAt <= this.at() ||
          !request ||
          request.status !== "active" ||
          request.expiresAt <= this.at() ||
          !watch ||
          watch.status === "expired"
        )
          opportunity.status = "expired";
      }

    for (const req of this.state.requests)
      if (req.status === "active" && req.expiresAt <= this.at()) {
        req.status = "expired";
        this.emit(
          "request_expired",
          `${names[req.owner]}’s request expired`,
          "Expired needs are removed from matching.",
        );
      }
    for (const a of this.state.agreements) {
      const p = this.latest(a);
      if (["cancelled", "expired"].includes(a.status)) continue;
      if (
        p &&
        ["pending", "approved"].includes(p.status) &&
        OWNERS.some((o) => {
          const cal = this.state.owners[o].workloadEvidence;
          return (
            cal?.mode === "live" &&
            this.now().getTime() - Date.parse(cal.checkedAt) > 2 * 60000
          );
        })
      ) {
        p.status = "superseded";
        p.approvals = {};
        a.status = "infeasible";
        a.reason =
          "Selected workload evidence is stale. Refresh it before reviewing a new proposal.";
        this.emit(
          "workloadEvidence_stale",
          "Workload evidence became stale",
          "Old approvals were cleared. Both selected workload manifests must be fresh before a replacement plan can pass.",
          "Concord",
          "shared",
          a.id,
        );
      }
      if (
        OWNERS.some(
          (o) =>
            this.state.requests.find((r) => r.id === a.requestIds[o])
              ?.status !== "active",
        ) ||
        (p &&
          ["pending", "approved"].includes(p.status) &&
          p.expiresAt <= this.at())
      ) {
        a.status = "expired";
        if (p) {
          p.status = "expired";
          p.approvals = {};
        }
        this.emit(
          "proposal_expired",
          "Proposal expired",
          "The approval window closed. Old approvals cannot confirm this plan.",
          "Concord",
          "shared",
          a.id,
        );
      }
    }
  }
  expireDemo(owner: Owner) {
    const a = this.current(owner),
      p = a && this.latest(a);
    if (!p || !["pending", "approved"].includes(p.status))
      throw new DomainError(
        409,
        "NO_PROPOSAL",
        "There is no active proposal to expire.",
      );
    p.expiresAt = this.at();
    this.sweep();
  }
  refreshWorkload(owner: Owner, workloadEvidence: WorkloadSnapshot) {
    const need = this.state.owners[owner].limits;
    const before = this.active(owner)?.revision;
    this.update(owner, need, workloadEvidence);
    if (before === this.active(owner)?.revision) {
      this.state.owners[owner].workloadEvidence = workloadEvidence;
      const a = this.current(owner);
      if (a?.status === "infeasible" && a.reason?.includes("stale"))
        this.negotiate(a);
    }
  }
  view(owner: Owner) {
    this.sweep();
    const request = [...this.state.requests]
      .reverse()
      .find((r) => r.owner === owner);
    const agreement = this.current(owner);
    const p = agreement && this.latest(agreement);
    const peer =
      agreement &&
      this.state.requests.find(
        (r) => r.id === agreement.requestIds[other(owner)],
      );
    return structuredClone({
      owner,
      name: names[owner],
      limits: this.state.owners[owner].limits,
      workloadEvidence: this.state.owners[owner].workloadEvidence,
      request,
      pendingDecision: this.pendingDecision(owner),
      watchProfile: this.state.watches[owner] && {
        id: this.state.watches[owner]!.id,
        status: this.state.watches[owner]!.status,
        selectedInterest: publicNeed(this.state.watches[owner]!.need),
        expiresAt: this.state.watches[owner]!.expiresAt,
      },
      pendingOpportunity: this.opportunityView(owner),
      outcome:
        agreement?.status === "approved"
          ? "agreement_reached_awaiting_booking_authorization"
          : agreement?.status,
      bookingAuthorization: "not_requested",
      agreement: agreement && {
        id: agreement.id,
        status: agreement.status,
        reason: agreement.reason,
        proposal: p,
        history: agreement.proposals.map((v) => ({
          version: v.version,
          status: v.status,
          hash: v.hash,
        })),
        partner: peer && {
          name: names[peer.owner],
          need: peer.need,
          status: peer.status,
        },
      },
      events: this.state.events
        .filter(
          (e) =>
            e.scope === owner ||
            (e.scope === "shared" &&
              (!e.agreementId || e.agreementId === agreement?.id)),
        )
        .slice(-100),
      research: this.state.research,
      provider: this.state.provider,
      serverTime: this.at(),
      disclosure:
        "Demo identities and workloads. Policy-based negotiation agents. Research and workload manifests are live only when labeled. Each workload receives separate whole GPUs; no single-GPU slicing. Device assignment alone does not provide tenant isolation. Price, availability and provider permission are unconfirmed. An approved conditional plan is not a booking or rental.",
    });
  }
}
export type OwnerView = ReturnType<Engine["view"]>;
