import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Box,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  CircleCheck,
  CircleDot,
  Clock3,
  ExternalLink,
  Fingerprint,
  GitBranch,
  Layers3,
  Link2,
  LoaderCircle,
  LockKeyhole,
  MessageCircle,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Cpu,
  Unplug,
  X,
  XCircle,
} from "lucide-react";
import {
  api,
  clock,
  command,
  day,
  minutesFrom,
  money,
  timeInput,
  type Session,
  type View,
} from "./api";
import type { NeedInput, Owner, Proposal } from "../server/types";

const statusText: Record<string, string> = {
  negotiating: "Negotiating",
  awaiting_response: "Reviewing proposal",
  rejected: "Proposal declined",
  awaiting_approval: "Ready for your review",
  approved: "Agreement approved",
  infeasible: "No feasible plan",
  expired: "Proposal expired",
  cancelled: "Plan cancelled",
};
function useOwner(session?: Session) {
  const [view, setView] = useState<View>();
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    if (!session) return;
    try {
      const data = await api<View>("/api/me", session.token);
      setView(data);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [session]);
  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 1500);
    return () => clearInterval(id);
  }, [refresh]);
  return { view, error, refresh };
}

function OpportunityCard({
  view,
  busy,
  act,
}: {
  view: View;
  busy: boolean;
  act: (body: unknown) => Promise<void>;
}) {
  const opportunity = view.pendingOpportunity;
  if (!opportunity) return null;
  const respond = (action: "explore" | "dismiss") =>
    act({
      kind: "opportunity",
      response: {
        ownerId: view.owner,
        opportunityId: opportunity.id,
        requestRevision: opportunity.requestRevision,
        action,
      },
    });
  return (
    <section className="opportunity-card" aria-label="New opportunity">
      <div className="opportunity-kicker">
        <Sparkles size={15} />
        New match <span>DEMO</span>
      </div>
      <h3>Compatible request found</h3>
      <p>
        {opportunity.candidate.owner} · {opportunity.candidate.need.region}
      </p>
      <div className="opportunity-resources">
        <Cpu size={17} />
        <strong>
          {opportunity.candidate.need.gpuCount} whole GPU ·{" "}
          {opportunity.candidate.need.minVramGb} GB
        </strong>
        <span>{opportunity.candidate.need.region}</span>
      </div>
      <details>
        <summary>
          Why this matches <ChevronDown size={12} />
        </summary>
        <p>{opportunity.reason}</p>
        <p>
          Price benefit unverified. Your full memory and private budget are not
          shared.
        </p>
      </details>
      <button
        className="button"
        disabled={busy}
        onClick={() => void respond("explore")}
      >
        <ArrowRight size={15} />
        Explore opportunity
      </button>
      <button
        className="text-button"
        disabled={busy}
        onClick={() => void respond("dismiss")}
      >
        <X size={13} />
        Dismiss
      </button>
      <small>Explore first. Approve separately.</small>
    </section>
  );
}

function DecisionCard({
  view,
  busy,
  act,
}: {
  view: View;
  busy: boolean;
  act: (body: unknown) => Promise<void>;
}) {
  const decision = view.pendingDecision;
  const [start, setStart] = useState(timeInput(decision?.terms.start ?? 600));
  const [cost, setCost] = useState(
    (decision?.terms.shares[view.owner] ?? 0) / 100,
  );
  if (!decision) return null;
  const { proposal, ownerId } = decision;
  const respond = (answer: "explore" | "decline") =>
    act({
      kind: answer === "decline" ? "reject" : "respond",
      decision: { ownerId, decisionId: decision.id, proposal, answer },
    });
  const approve = () =>
    act({
      kind: "approve",
      proposal: {
        ...proposal,
        ownerId,
        decisionId: decision.id,
        authorization: "final_agreement",
      },
    });
  function counter(e: FormEvent) {
    e.preventDefault();
    const own = Math.round(cost * 100);
    void act({
      kind: "counter",
      counter: {
        ownerId,
        decisionId: decision!.id,
        proposal,
        terms: {
          start: minutesFrom(start),
          end: minutesFrom(start) + decision!.terms.end - decision!.terms.start,
          shares:
            ownerId === "alice"
              ? { alice: own, bob: decision!.terms.totalCents - own }
              : { bob: own, alice: decision!.terms.totalCents - own },
        },
      },
    });
  }
  return (
    <section
      className="decision-card"
      aria-label={`${view.name}’s current decision`}
    >
      <div className="decision-stage">
        <CircleDot size={13} />
        {decision.stage === "exploration"
          ? "Explore only"
          : decision.stage === "final_approval"
            ? "Final agreement approval"
            : "Response recorded"}
        <b>v{proposal.version}</b>
      </div>
      <h3>
        {decision.stage === "waiting_for_other_owner"
          ? "Waiting for the other owner"
          : decision.stage === "exploration"
            ? "Does this work for you?"
            : "Approve these exact terms?"}
      </h3>
      <p>
        {decision.stage === "exploration"
          ? "Exploring does not approve the plan."
          : decision.stage === "final_approval"
            ? "Approve this version. Booking needs separate consent."
            : "Your exploration response is saved."}
      </p>
      <div className="decision-primary">
        {decision.stage === "exploration" && (
          <button
            className="button"
            disabled={busy}
            onClick={() => void respond("explore")}
          >
            <ArrowRight size={16} />
            Continue exploring · v{proposal.version}
          </button>
        )}
        {decision.stage === "final_approval" && (
          <button
            className="button"
            disabled={busy}
            onClick={() => void approve()}
          >
            <Check size={16} />
            Approve final agreement · v{proposal.version}
          </button>
        )}
      </div>
      <details className="decision-alternatives">
        <summary>
          Request a change <ChevronDown size={13} />
        </summary>
        <div className="alternative-options">
          {decision.alternatives
            .filter(
              (a) =>
                a.offer.start !== decision.terms.start ||
                a.offer.shares[ownerId] !== decision.terms.shares[ownerId],
            )
            .map((a) => (
              <button
                key={a.id}
                className="alternative-option"
                disabled={busy}
                onClick={() =>
                  void act({
                    kind: "counter",
                    counter: {
                      ownerId,
                      decisionId: decision.id,
                      proposal,
                      alternativeId: a.id,
                    },
                  })
                }
              >
                <Clock3 size={14} />
                <span>
                  {clock(a.offer.start)}–{clock(a.offer.end)}
                  <small>
                    {money(a.offer.shares[ownerId])} your share · passes current
                    checks
                  </small>
                </span>
                <ArrowRight size={14} />
              </button>
            ))}
        </div>
        <form className="counter-form" onSubmit={counter}>
          <label>
            Propose start
            <input
              aria-label="Counteroffer start"
              type="time"
              required
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label>
            Your share ($)
            <input
              aria-label="Counteroffer own share"
              type="number"
              min="0"
              max={decision.terms.totalCents / 100}
              step="0.01"
              required
              value={cost}
              onChange={(e) => setCost(Number(e.target.value))}
            />
          </label>
          <button className="button secondary compact" disabled={busy}>
            Send counteroffer
          </button>
        </form>
        <p className="form-hint">
          Both agents recheck a counter. A change clears all earlier consent and
          approvals.
        </p>
      </details>
      <button
        className="text-button decline-proposal"
        disabled={busy}
        onClick={() => void respond("decline")}
      >
        <X size={14} />
        Decline proposal
      </button>
    </section>
  );
}
function Availability({ view, proposal }: { view: View; proposal: Proposal }) {
  const own = view.request!.need,
    peer = view.agreement!.partner!.need;
  const needs =
    view.owner === "alice"
      ? { alice: own, bob: peer }
      : { alice: peer, bob: own };
  return (
    <div className="gpu-surface">
      <div className="gpu-tiles">
        {(["alice", "bob"] as const).map((owner) => (
          <div className={`gpu-tile ${owner}`} key={owner}>
            <div>
              <Cpu size={20} />
              <span>{owner === "alice" ? "Alice" : "Bob"}</span>
              <b>Proposed GPU {proposal.deviceAssignments[owner].join(", ")}</b>
            </div>
            <strong>
              {proposal.vramPerGpuGb}
              <small> GB / GPU</small>
            </strong>
            <p>
              {needs[owner].gpuCount} whole device ·{" "}
              {needs[owner].runtimeMinutes} min workload
            </p>
          </div>
        ))}
      </div>
      <table className="availability-table">
        <caption>Offered hours · Pacific</caption>
        <thead>
          <tr>
            <th scope="col">Owner</th>
            <th scope="col">Hours</th>
          </tr>
        </thead>
        <tbody>
          {(["alice", "bob"] as const).map((owner) => (
            <tr key={owner}>
              <th scope="row">{owner === "alice" ? "Alice" : "Bob"}</th>
              <td>
                {clock(needs[owner].window.start)}–
                {clock(needs[owner].window.end)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="availability-summary">
        Proposed session: {clock(proposal.start)}–{clock(proposal.end)} Pacific.
      </p>
    </div>
  );
}

function Assistant({
  session,
  view,
  refresh,
  onMutation,
}: {
  session: Session;
  view: View;
  refresh: () => Promise<void>;
  onMutation: () => Promise<void>;
}) {
  const owner = session.owner;
  const [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [draft, setDraft] = useState<NeedInput>(view.limits);
  const lastRevision = useRef(view.request?.revision);
  useEffect(() => {
    if (
      lastRevision.current !== view.request?.revision ||
      (!editing && JSON.stringify(draft) !== JSON.stringify(view.limits))
    ) {
      setDraft(view.limits);
      lastRevision.current = view.request?.revision;
    }
  }, [view]);
  const active = view.request?.status === "active";
  const liveRequired = view.integrations?.requireLive;
  const liveReady =
    !liveRequired ||
    (view.research.mode === "live" &&
      view.provider.mode === "research-backed" &&
      view.integrations?.composio.configured &&
      view.integrations?.composio.mode === "live");
  const a = view.agreement,
    p = a?.proposal;
  const proposalActive =
    p &&
    p.status === "pending" &&
    a?.status === "awaiting_approval" &&
    (!liveRequired || p.providerMode === "research-backed");
  const approved = p?.approvals[owner]?.hash === p?.hash;
  const selected = active ? view.request!.need : draft;
  async function act(body: unknown) {
    setBusy(true);
    setError("");
    try {
      await command(session, body);
      await Promise.all([refresh(), onMutation()]);
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function refreshWorkload() {
    setBusy(true);
    setError("");
    try {
      await api("/api/workload/refresh", session.token, {});
      await Promise.all([refresh(), onMutation()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function submitEdit(e: FormEvent) {
    e.preventDefault();
    void act({ kind: active ? "update" : "delegate", need: draft });
  }
  async function sendMessage(e: FormEvent) {
    e.preventDefault();
    const text = message.trim().toLowerCase();
    if (!text) return;
    if (
      text === "find a match" ||
      text === "find a shared compute" ||
      text === "delegate"
    )
      await act({ kind: "delegate", need: draft });
    else if (
      (text === "yes" || text === "explore") &&
      view.pendingDecision?.stage === "exploration"
    )
      await act({
        kind: "respond",
        decision: {
          ownerId: owner,
          decisionId: view.pendingDecision.id,
          proposal: view.pendingDecision.proposal,
          answer: "explore",
        },
      });
    else if (text === "decline" && view.pendingDecision)
      await act({
        kind: "reject",
        decision: {
          ownerId: owner,
          decisionId: view.pendingDecision.id,
          proposal: view.pendingDecision.proposal,
          answer: "decline",
        },
      });
    else if (text === "withdraw") await act({ kind: "withdraw" });
    else if (text === "approve" && proposalActive)
      await act({
        kind: "approve",
        proposal: {
          agreementId: a!.id,
          proposalId: p!.id,
          version: p!.version,
          hash: p!.hash,
          ownerId: owner,
          decisionId: p!.decisionIds.final_approval[owner],
          authorization: "final_agreement",
        },
      });
    else if (text === "start after noon" && active)
      await act({
        kind: "update",
        need: { ...view.limits, window: { ...view.limits.window, start: 720 } },
      });
    else {
      setError(
        "Try “find a match”, “start after noon”, “approve”, or “withdraw”. Use Edit constraints for other changes.",
      );
      return;
    }
    setMessage("");
  }
  return (
    <section
      className={`assistant ${owner}`}
      aria-labelledby={`${owner}-title`}
    >
      <header className="assistant-header">
        <div className={`avatar ${owner}`}>{owner === "alice" ? "A" : "B"}</div>
        <div>
          <h2 id={`${owner}-title`}>{view.name}’s assistant</h2>
        </div>
        <LockKeyhole
          size={16}
          className="quiet-icon"
          aria-label="Private session"
        />
      </header>
      <div className="conversation">
        <OpportunityCard view={view} busy={busy} act={act} />
        {view.pendingDecision && (
          <DecisionCard
            key={
              view.pendingDecision.proposal.proposalId +
              view.pendingDecision.stage
            }
            view={view}
            busy={busy}
            act={act}
          />
        )}
        <details
          className="selected-context"
          open={
            editing || (!view.pendingDecision && !view.pendingOpportunity && !p)
          }
        >
          <summary>
            Your requirements
            <ChevronDown size={13} />
          </summary>
          <div className="selected-need">
            <div className="need-heading">
              <span>Selected need</span>
              <Box size={15} />
            </div>
            <h3>Your request</h3>
            <div className="need-line">
              <CalendarDays size={14} />
              <span>
                {day(selected.date)} · {clock(selected.window.start)}–
                {clock(selected.window.end)}
              </span>
            </div>
            <div className="need-line">
              <Cpu size={14} />
              <span>{selected.region}</span>
            </div>
            <div className="need-line">
              <Layers3 size={14} />
              <span>
                {selected.gpuCount} whole GPU(s) · separate device assignment
              </span>
            </div>
            <div className="need-line">
              <Cpu size={14} />
              <span>
                {selected.minVramGb} GB VRAM per GPU · {selected.runtimeMinutes}{" "}
                min runtime
              </span>
            </div>
            <button
              className="text-button edit-button"
              onClick={() => {
                setDraft(view.limits);
                setEditing(!editing);
              }}
              aria-expanded={editing}
            >
              <SlidersHorizontal size={14} />
              {editing ? "Close constraints" : "Edit private constraints"}
              <ChevronDown size={13} />
            </button>
          </div>
          {editing && (
            <form className="constraints" onSubmit={submitEdit}>
              <div className="private-label">
                <LockKeyhole size={13} />
                Your budget stays private to {view.name}’s assistant
              </div>
              <p className="form-hint">
                The selected date, time window, compute region, GPU count, VRAM
                and runtime are shared when you delegate.
              </p>
              <div className="form-grid">
                <label>
                  Start time
                  <input
                    type="time"
                    name="start"
                    required
                    value={timeInput(draft.window.start)}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        window: {
                          ...draft.window,
                          start: minutesFrom(e.target.value),
                        },
                      })
                    }
                  />
                </label>
                <label>
                  End time
                  <input
                    type="time"
                    name="end"
                    required
                    value={timeInput(draft.window.end)}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        window: {
                          ...draft.window,
                          end: minutesFrom(e.target.value),
                        },
                      })
                    }
                  />
                </label>
                <label>
                  Private budget ($)
                  <input
                    name="budget"
                    type="number"
                    min="1"
                    max="2000"
                    step="0.01"
                    required
                    value={draft.maxBudgetCents / 100}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        maxBudgetCents: Math.round(
                          Number(e.target.value) * 100,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  Whole GPU count
                  <input
                    name="gpuCount"
                    type="number"
                    min="1"
                    max="40"
                    required
                    value={draft.gpuCount}
                    onChange={(e) =>
                      setDraft({ ...draft, gpuCount: Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  Minimum VRAM / GPU (GB)
                  <input
                    name="vram"
                    type="number"
                    min="1"
                    max="192"
                    required
                    value={draft.minVramGb}
                    onChange={(e) =>
                      setDraft({ ...draft, minVramGb: Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  Runtime (minutes)
                  <input
                    name="runtime"
                    type="number"
                    min="15"
                    max="120"
                    step="15"
                    required
                    value={draft.runtimeMinutes}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        runtimeMinutes: Number(e.target.value),
                      })
                    }
                  />
                </label>
              </div>
              <label>
                Compute date
                <input
                  type="date"
                  name="date"
                  required
                  value={draft.date}
                  onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                />
              </label>
              <label>
                Compute region
                <select
                  name="region"
                  value={draft.region}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      region: e.target.value as NeedInput["region"],
                    })
                  }
                >
                  <option>US West</option>
                  <option>EU Central</option>
                </select>
              </label>
              <p className="form-hint">
                Saving a change invalidates every existing approval.
              </p>
              <button className="button compact" disabled={busy}>
                {busy ? (
                  <LoaderCircle className="spin" size={14} />
                ) : (
                  <Check size={14} />
                )}{" "}
                {active ? "Save & renegotiate" : "Save & delegate"}
              </button>
            </form>
          )}
        </details>
        <details className="assistant-details">
          <summary>
            Private limits & connections <ChevronDown size={13} />
          </summary>
          {view.watchProfile && (
            <div className="watch-status">
              <CircleDot size={13} />
              <span>
                {view.watchProfile.status === "active"
                  ? "Watching this need"
                  : view.watchProfile.status === "paused"
                    ? "Opportunity watch paused"
                    : "Opportunity watch expired"}
              </span>
              {view.watchProfile.status !== "expired" && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    void act({
                      kind: "pause_watch",
                      paused: view.watchProfile!.status === "active",
                    })
                  }
                >
                  {view.watchProfile.status === "active" ? "Pause" : "Resume"}
                </button>
              )}
            </div>
          )}
          {view.workloadEvidence && (
            <div className="calendar-note">
              <CalendarDays size={14} />
              <div>
                <strong>
                  {view.workloadEvidence.mode === "live"
                    ? "Selected workload manifest checked"
                    : "Synthetic workload manifest"}
                </strong>
                <span>
                  {view.workloadEvidence.mode === "live"
                    ? "Composio · selected sheet read"
                    : "Fixture · synthetic workload constraints"}
                </span>
              </div>
              {active && (
                <button
                  className="icon-button calendar-refresh"
                  aria-label={`Refresh ${view.name}’s selected workload manifest`}
                  disabled={busy}
                  onClick={() => void refreshWorkload()}
                >
                  <RefreshCw size={13} />
                </button>
              )}
            </div>
          )}
          {p && (
            <div
              className={`budget-comparison ${p.shares[owner] <= view.limits.maxBudgetCents ? "within" : "over"}`}
            >
              <ShieldCheck size={14} />
              <span>
                {money(p.shares[owner])} your proposed share ·{" "}
                {p.shares[owner] <= view.limits.maxBudgetCents
                  ? "within"
                  : "over"}{" "}
                your private {money(view.limits.maxBudgetCents)} limit
              </span>
            </div>
          )}
        </details>
        {a?.status === "approved" && (
          <p className="owner-status">
            <CheckCheck size={16} />
            Agreement approved. Booking not authorized.
          </p>
        )}
        {a &&
          ["rejected", "infeasible", "expired", "cancelled"].includes(
            a.status,
          ) && (
            <p className="owner-status">{a.reason ?? statusText[a.status]}</p>
          )}
        {view.request && view.request.status !== "active" && (
          <div className="owner-status">
            <XCircle size={16} />
            {view.request.status === "withdrawn"
              ? "You withdrew this need."
              : "Your request expired."}
          </div>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="owner-actions">
          {!active ? (
            <>
              {!liveReady && (
                <p className="setup-hint">
                  <Unplug size={13} />
                  Complete live setup in Connections & evidence first.
                </p>
              )}
              {!view.watchProfile && (
                <button
                  className="button secondary watch-button"
                  disabled={busy}
                  onClick={() =>
                    void act({
                      kind: "watch",
                      profile: { need: draft, optIn: true },
                    })
                  }
                >
                  <Sparkles size={15} />
                  Watch for matches
                </button>
              )}
              <button
                className="button delegate-button"
                disabled={busy || !liveReady}
                onClick={() => void act({ kind: "delegate", need: draft })}
              >
                {busy ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <ArrowUpRight size={17} />
                )}
                Find a match
              </button>
            </>
          ) : (
            <>
              <details className="more-actions">
                <summary>
                  Change or withdraw <ChevronDown size={13} />
                </summary>
                <div className="secondary-actions">
                  <button
                    className="text-button"
                    disabled={busy || view.limits.window.start >= 720}
                    onClick={() =>
                      void act({
                        kind: "update",
                        need: {
                          ...view.limits,
                          window: { ...view.limits.window, start: 720 },
                        },
                      })
                    }
                  >
                    <Clock3 size={14} />
                    Start after noon
                  </button>
                  <button
                    className="text-button withdraw"
                    disabled={busy}
                    onClick={() => void act({ kind: "withdraw" })}
                  >
                    Withdraw
                  </button>
                </div>
              </details>
            </>
          )}
        </div>
      </div>
      <details className="command-tools">
        <summary>
          Command console <ChevronDown size={13} />
        </summary>
        <form className="composer" onSubmit={sendMessage}>
          <label className="sr-only" htmlFor={`${owner}-command`}>
            Command to {view.name}’s assistant
          </label>
          <input
            id={`${owner}-command`}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Try “start after noon”"
            autoComplete="off"
          />
          <button
            type="submit"
            disabled={busy || !message.trim()}
            aria-label={`Send command to ${view.name}’s assistant`}
          >
            <Send size={17} />
          </button>
        </form>
        <p className="command-disclosure">
          Structured commands · policy agent · no generative chat
        </p>
      </details>
    </section>
  );
}

function Approval({ owner, proposal }: { owner: Owner; proposal: Proposal }) {
  const yes = proposal.approvals[owner]?.hash === proposal.hash;
  const explored = proposal.explorations[owner]?.hash === proposal.hash;
  const bothExplored = (["alice", "bob"] as const).every(
    (o) => proposal.explorations[o]?.hash === proposal.hash,
  );
  return (
    <div className={`approval ${yes ? "yes" : ""}`}>
      <span className={`mini-avatar ${owner}`}>
        {owner === "alice" ? "A" : "B"}
      </span>
      <div>
        <strong>{owner === "alice" ? "Alice" : "Bob"}</strong>
        <span>
          {yes
            ? `Approved v${proposal.version}`
            : bothExplored
              ? "Approval pending"
              : explored
                ? "Exploring"
                : "Response pending"}
        </span>
      </div>
      {yes ? <CircleCheck size={18} /> : <Clock3 size={17} />}
    </div>
  );
}

function AgentNegotiation({ view }: { view: View }) {
  const agreement = view.agreement;
  if (!agreement) return null;
  const all = view.events
    .filter((event) => event.agreementId === agreement.id)
    .sort((a, b) => a.sequence - b.sequence);
  const start = all.findLastIndex(
    (event) => event.type === "agent_negotiation_started",
  );
  const steps = all
    .slice(Math.max(0, start))
    .filter((event) =>
      [
        "agent_offer",
        "agent_rejected",
        "agent_counteroffer",
        "agent_consensus",
      ].includes(event.type),
    );
  if (!steps.length) return null;
  return (
    <section className="agent-negotiation" aria-label="Agent negotiation">
      <div className="agent-negotiation-heading">
        <h3>Agent negotiation</h3>
        <span>Policy agents</span>
      </div>
      <ol>
        {steps.map((event) => (
          <li key={event.id} className={event.type}>
            {event.type === "agent_rejected" ? (
              <XCircle size={15} />
            ) : event.type === "agent_consensus" ? (
              <CheckCheck size={15} />
            ) : (
              <ArrowRight size={15} />
            )}
            <div>
              <strong>
                {event.type === "agent_consensus" ? "Both agents" : event.actor}
              </strong>
              <p>
                {event.type === "agent_consensus"
                  ? "Policy checks passed · owners decide next"
                  : event.title}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function SharedPlan({
  view,
  activeCount,
  onExpire,
}: {
  view: View;
  activeCount: number;
  onExpire: () => void;
}) {
  const a = view.agreement,
    p = a?.proposal;
  const valid =
    p &&
    ["pending", "approved"].includes(p.status) &&
    ["awaiting_response", "awaiting_approval", "approved"].includes(a!.status);
  const remaining = p
    ? Math.max(
        0,
        Math.ceil(
          (Date.parse(p.expiresAt) - Date.parse(view.serverTime)) / 60000,
        ),
      )
    : 0;
  return (
    <section className="shared-plan" aria-labelledby="shared-plan-title">
      <div className="coord-heading">
        <h2 id="shared-plan-title">Shared plan</h2>
        {p && <span className="proposal-version">v{p.version}</span>}
      </div>
      {!a ? (
        <div className="empty-plan">
          <Cpu size={32} />
          <h3>
            {activeCount ? "Looking for a match" : "Find a shared opportunity"}
          </h3>
          <p>
            {activeCount
              ? "Your assistant will bring back a compatible plan."
              : "Choose your requirements to start."}
          </p>
        </div>
      ) : (
        <>
          <div className={`plan-status ${a.status}`}>
            <span>
              {a.status === "approved" ? (
                <CircleCheck size={15} />
              ) : (
                <CircleDot size={15} />
              )}
              {statusText[a.status]}
            </span>
          </div>
          <AgentNegotiation view={view} />
          {!valid ? (
            <div className="inactive-plan">
              <p>{a.reason ?? "This proposal is no longer active."}</p>
            </div>
          ) : (
            <div className="agreement-sheet" key={p.version}>
              <div className="plan-resource">
                <Cpu size={26} />
                <div>
                  <h3>
                    {view.request!.need.gpuCount} GPU · {p.vramPerGpuGb} GB
                  </h3>
                  <p>{view.request!.need.region} · proposed separate device</p>
                </div>
              </div>
              <div className="plan-time">
                <CalendarDays size={20} />
                <div>
                  <strong>{day(view.request!.need.date)}</strong>
                  <span>
                    {clock(p.start)}–{clock(p.end)} Pacific
                  </span>
                </div>
              </div>
              <div className="plan-own-price">
                <div>
                  <span>Your share</span>
                  <strong>{money(p.shares[view.owner])}</strong>
                </div>
                <small>
                  {p.providerMode === "synthetic"
                    ? "Demo price"
                    : "Planning estimate"}{" "}
                  · no booking
                </small>
              </div>
              {p.version > 1 && (
                <p className="revision-notice">
                  Terms changed. Fresh approval required.
                </p>
              )}
              <div className="approval-list">
                <Approval owner="alice" proposal={p} />
                <Approval owner="bob" proposal={p} />
              </div>
              {a.status !== "approved" && (
                <p className="proposal-expiry">Expires in {remaining} min</p>
              )}
              <details className="terms">
                <summary>
                  Plan details <ChevronDown size={13} />
                </summary>
                <Availability view={view} proposal={p} />
                <dl>
                  <div>
                    <dt>Total</dt>
                    <dd>
                      {money(p.totalCents)} · Alice {money(p.shares.alice)} ·
                      Bob {money(p.shares.bob)}
                    </dd>
                  </div>
                  <div>
                    <dt>Provider</dt>
                    <dd>
                      {p.provider}
                      {p.providerMode === "synthetic"
                        ? " (simulated)"
                        : " (research candidate)"}
                    </dd>
                  </div>
                  <div>
                    <dt>Assumptions</dt>
                    <dd>
                      Provider price, availability, tenancy permission and
                      secure isolation are unverified. No GPU is rented or
                      booked.
                    </dd>
                  </div>
                  <div>
                    <dt>Version</dt>
                    <dd>
                      v{p.version}
                      <span className="fingerprint">{p.hash}</span>
                    </dd>
                  </div>
                  <div>
                    <dt>Expires</dt>
                    <dd>{new Date(p.expiresAt).toLocaleTimeString("en-US")}</dd>
                  </div>
                </dl>
                <button className="text-button" onClick={onExpire}>
                  Test expiry
                </button>
              </details>
            </div>
          )}
          {a.history && a.history.length > 1 && (
            <details className="version-history">
              <summary>Version history</summary>
              {a.history.map((h) => (
                <span key={h.version}>
                  v{h.version} · {h.status}
                </span>
              ))}
            </details>
          )}
        </>
      )}
    </section>
  );
}

function Research({
  view,
  session,
  refresh,
  close,
}: {
  view: View;
  session: Session;
  refresh: () => Promise<void>;
  close: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [planningTotal, setPlanningTotal] = useState(12);
  const status = view.integrations;
  async function run() {
    setBusy(true);
    setError("");
    try {
      await api("/api/research", session.token, {});
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function selectCandidate(sourceUrl: string) {
    setBusy(true);
    setError("");
    try {
      await api("/api/provider/select", session.token, {
        sourceUrl,
        planningTotalCents: Math.round(planningTotal * 100),
      });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="research-panel" aria-labelledby="research-title">
      <header>
        <div>
          <h2 id="research-title">Connections & evidence</h2>
          <p>
            Source-backed discovery stays separate from provider commitments.
          </p>
        </div>
        <button
          className="icon-button"
          aria-label="Close connections and evidence"
          onClick={close}
        >
          <X size={20} />
        </button>
      </header>
      <div className="integration-grid">
        <div>
          <div className="integration-title">
            <span className="brand-symbol">P</span>
            <h3>Parallel</h3>
            <span
              className={`mode-tag ${view.research.mode === "live" ? "is-live" : ""}`}
            >
              {view.research.mode === "live"
                ? "LIVE RESULT"
                : status?.requireLive
                  ? "AWAITING LIVE CALL"
                  : "FIXTURE"}
            </span>
          </div>
          <p>
            Research GPU hosts, multi-GPU configuration, device assignment,
            billing and sharing policies. No private workload content or budgets
            are sent.
          </p>
          <p className="integration-blocker">{status?.parallel.blocker}</p>
          <button
            className="button secondary compact"
            onClick={() => void run()}
            disabled={
              busy || (status?.requireLive && status.parallel.mode !== "live")
            }
          >
            {busy ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <RefreshCw size={15} />
            )}{" "}
            {status?.parallel.mode === "live" || status?.requireLive
              ? "Research GPU hosts live"
              : "Load reference fixtures"}
          </button>
        </div>
        <div>
          <div className="integration-title">
            <span className="brand-symbol composio-symbol">
              <Link2 size={17} />
            </span>
            <h3>Composio</h3>
            <span
              className={`mode-tag ${view.workloadEvidence?.mode === "live" ? "is-live" : ""}`}
            >
              {view.workloadEvidence?.mode === "live"
                ? "LIVE READ"
                : status?.requireLive
                  ? "AWAITING LIVE CALL"
                  : "FIXTURE"}
            </span>
          </div>
          <p>
            Read four constraints from each selected demo workload sheet: GPU
            count, minimum VRAM, runtime and public-demo trust class. No code or
            datasets are fetched.
          </p>
          <p className="integration-blocker">{status?.composio.blocker}</p>
          <span className="read-only">
            <LockKeyhole size={14} />
            Only GOOGLESHEETS_BATCH_GET is enabled
          </span>
        </div>
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <p className="research-disclosure">{view.research.status}</p>
      {view.research.mode === "live" && (
        <div className="planning-envelope">
          <label htmlFor="planning-envelope">
            Proposed planning envelope ($)
            <input
              id="planning-envelope"
              type="number"
              min="1"
              max="2000"
              step="1"
              value={planningTotal}
              onChange={(e) => setPlanningTotal(Number(e.target.value))}
            />
          </label>
          <p>
            A budget to negotiate, not a provider price or quote. Selecting or
            changing it invalidates both approvals. Verify that the selected
            source describes a suitable GPU host. Tenancy permission and
            isolation must be verified separately.
          </p>
        </div>
      )}
      <div className="source-list">
        {view.research.sources.map((s, i) => (
          <article key={`${s.url}-${i}`}>
            <a href={s.url} target="_blank" rel="noopener noreferrer">
              <div>
                <strong>{s.title}</strong>
                <ExternalLink size={14} />
              </div>
              <p>{s.excerpt}</p>
              <span>{new URL(s.url).hostname}</span>
            </a>
            {view.research.mode === "live" && (
              <button
                className="button secondary compact"
                disabled={
                  busy ||
                  !Number.isFinite(planningTotal) ||
                  planningTotal < 1 ||
                  planningTotal > 2000
                }
                onClick={() => void selectCandidate(s.url)}
              >
                {view.provider.sourceUrl === s.url ? (
                  <Check size={13} />
                ) : (
                  <ArrowRight size={13} />
                )}{" "}
                {view.provider.sourceUrl === s.url
                  ? "Selected · update planning envelope"
                  : "Select researched candidate"}
              </button>
            )}
          </article>
        ))}
      </div>
      <p className="research-footer">
        Live badges appear only after successful API calls. Workload manifests
        constrain resource needs. Host availability, final price, tenancy
        permission and secure isolation remain unconfirmed.
      </p>
    </section>
  );
}

export default function App() {
  const [sessions, setSessions] = useState<Session[]>([]),
    [resetToken, setResetToken] = useState(""),
    [bootError, setBootError] = useState(""),
    [research, setResearch] = useState(false),
    [resetting, setResetting] = useState(false),
    [activeOwner, setActiveOwner] = useState<Owner>(() =>
      new URLSearchParams(window.location.search).get("owner") === "bob"
        ? "bob"
        : "alice",
    );
  const alice = useOwner(sessions[0]),
    bob = useOwner(sessions[1]);
  useEffect(() => {
    void api<{ sessions: Session[]; resetToken: string }>(
      "/api/demo/sessions",
      undefined,
      {},
    )
      .then((x) => {
        setSessions(x.sessions);
        setResetToken(x.resetToken);
      })
      .catch((e) => setBootError(e.message));
  }, []);
  const refreshBoth = useCallback(async () => {
    await Promise.all([alice.refresh(), bob.refresh()]);
  }, [alice.refresh, bob.refresh]);
  const view = activeOwner === "alice" ? alice.view : bob.view;
  const activeCount = [alice.view, bob.view].filter(
    (v) => v?.request?.status === "active",
  ).length;
  const events = [...(view?.events ?? [])]
    .filter((e) => e.scope === "shared" || e.scope === activeOwner)
    .sort((a, b) => b.sequence - a.sequence);
  async function reset() {
    setResetting(true);
    try {
      await api(
        "/api/demo/reset",
        undefined,
        {},
        { "X-Demo-Capability": resetToken },
      );
      await refreshBoth();
    } catch (e) {
      setBootError((e as Error).message);
    } finally {
      setResetting(false);
    }
  }
  async function expire() {
    try {
      await api("/api/demo/expire", sessions[0].token, {});
      await refreshBoth();
    } catch (e) {
      setBootError((e as Error).message);
    }
  }
  return (
    <>
      <a className="skip-link" href="#workspace">
        Skip to coordination workspace
      </a>
      <div className="app-shell">
        <header className="topbar">
          <a className="wordmark" href="/" aria-label="Concord home">
            <span className="logo">
              <Link2 size={22} strokeWidth={2.3} />
            </span>
            concord<span className="preview-label">Demo</span>
          </a>
          <nav aria-label="Demo tools">
            <button
              className="text-button"
              onClick={() => setResearch(!research)}
              aria-expanded={research}
            >
              <Unplug size={15} />
              Connections
              <span className="fixture-dot" />
            </button>
            <button
              className="button secondary reset-button"
              onClick={() => void reset()}
              disabled={resetting}
            >
              <RotateCcw size={14} />
              {resetting ? "Resetting…" : "Reset demo"}
            </button>
          </nav>
        </header>
        <main>
          <section className="intro">
            <h1>Your shared plan</h1>
          </section>
          {bootError && (
            <p role="alert" className="inline-error">
              {bootError}
            </p>
          )}
          {research && view && sessions[0] && (
            <Research
              view={alice.view!}
              session={sessions[0]}
              refresh={refreshBoth}
              close={() => setResearch(false)}
            />
          )}
          <div
            className="owner-switch"
            role="group"
            aria-label="Synthetic demo identity"
          >
            <span>View as</span>
            {(["alice", "bob"] as const).map((owner) => (
              <button
                key={owner}
                className={activeOwner === owner ? "selected" : ""}
                aria-pressed={activeOwner === owner}
                onClick={() => setActiveOwner(owner)}
              >
                {owner === "alice" ? "Alice" : "Bob"}
              </button>
            ))}
          </div>
          {!alice.view || !bob.view ? (
            <div className="loading-state">
              <LoaderCircle className="spin" size={24} />
              <p>
                {alice.error ||
                  bob.error ||
                  bootError ||
                  "Opening two isolated assistant sessions…"}
              </p>
            </div>
          ) : (
            <div
              className={`workspace single-owner ${view?.pendingOpportunity ? "has-opportunity" : ""}`}
              id="workspace"
            >
              <Assistant
                key={`${activeOwner}-${view!.request?.id ?? "empty"}`}
                session={sessions[activeOwner === "alice" ? 0 : 1]}
                view={view!}
                refresh={activeOwner === "alice" ? alice.refresh : bob.refresh}
                onMutation={
                  activeOwner === "alice" ? bob.refresh : alice.refresh
                }
              />
              <SharedPlan
                view={view!}
                activeCount={activeCount}
                onExpire={() => void expire()}
              />
            </div>
          )}
          <details
            className="activity-section"
            id="activity"
            aria-labelledby="activity-title"
          >
            <summary className="activity-heading">
              <div>
                <h2 id="activity-title">Activity</h2>
              </div>
              <span className="activity-count">
                <GitBranch size={14} />
                {events.length} {events.length === 1 ? "event" : "events"}
              </span>
            </summary>
            {!events.length ? (
              <div className="empty-activity">
                <MessageCircle size={19} />
                <p>
                  The story starts when an owner authorizes a selected need.
                </p>
                <span>Waiting for your first delegation</span>
              </div>
            ) : (
              <ol className="timeline">
                {events.map((e, i) => (
                  <li key={e.id}>
                    <span
                      className={`timeline-icon ${e.type.includes("reject") || e.type === "infeasible" ? "rejected" : e.type.includes("approved") ? "success" : ""}`}
                    >
                      {e.type.includes("reject") || e.type === "infeasible" ? (
                        <X size={13} />
                      ) : e.type.includes("approved") ? (
                        <Check size={13} />
                      ) : e.type === "constraint_changed" ? (
                        <GitBranch size={13} />
                      ) : (
                        <CircleDot size={12} />
                      )}
                    </span>
                    <div>
                      <div className="event-title">
                        <h3>{e.title}</h3>
                        <span>{e.actor}</span>
                      </div>
                      <p>{e.detail}</p>
                    </div>
                    <time dateTime={e.at}>
                      {new Date(e.at).toLocaleTimeString("en-US", {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </time>
                  </li>
                ))}
              </ol>
            )}
          </details>
        </main>
        <footer className="footer">
          <span>Concord · local</span>
        </footer>
        <div className="sr-only" role="status" aria-live="polite">
          {view?.agreement
            ? statusText[view.agreement.status]
            : `${activeCount} of 2 selected needs delegated`}
        </div>
      </div>
    </>
  );
}
