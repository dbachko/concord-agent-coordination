import { z } from "zod";

export const OwnerSchema = z.enum(["alice", "bob"]);
export type Owner = z.infer<typeof OwnerSchema>;
export const OWNERS: Owner[] = ["alice", "bob"];
export const names = { alice: "Alice", bob: "Bob" } as const;
export const other = (owner: Owner): Owner =>
  owner === "alice" ? "bob" : "alice";
export const WindowSchema = z
  .object({
    start: z.number().int().min(0).max(1439),
    end: z.number().int().min(1).max(1440),
  })
  .strict()
  .refine((x) => x.end > x.start, "End must be after start");
export type Window = z.infer<typeof WindowSchema>;
export const NeedSchema = z
  .object({
    region: z.enum(["US West", "EU Central"]),
    date: z.iso.date(),
    window: WindowSchema,
    gpuCount: z.number().int().min(1).max(8),
    minVramGb: z.number().int().min(1).max(192),
    runtimeMinutes: z.number().int().min(15).max(120),
    trustClass: z.literal("public-demo"),
    maxBudgetCents: z.number().int().min(100).max(200000),
    consent: z.literal(true),
  })
  .strict();
export type NeedInput = z.infer<typeof NeedSchema>;
export type PublicNeed = Omit<NeedInput, "maxBudgetCents" | "consent">;
export type WorkloadSnapshot = {
  mode: "fixture" | "live";
  busy: Window[];
  checkedAt: string;
  label: string;
  date: string;
  manifest?: {
    gpuCount: number;
    minVramGb: number;
    runtimeMinutes: number;
    trustClass: "public-demo";
  };
};
export type OwnerRecord = {
  limits: NeedInput;
  workloadEvidence?: WorkloadSnapshot;
};
export type Request = {
  id: string;
  owner: Owner;
  need: PublicNeed;
  revision: number;
  status: "active" | "withdrawn" | "expired";
  expiresAt: string;
};
export type Provider = {
  name: string;
  totalCents: number;
  capacity: number;
  vramPerGpuGb: number;
  allocation: "exclusive-device";
  isolationStatus: "provider-confirmation-required";
  duration: number;
  start: number;
  end: number;
  mode: "synthetic" | "research-backed";
  sourceUrl?: string;
  sourceTitle?: string;
};
export type Offer = {
  start: number;
  end: number;
  totalCents: number;
  shares: Record<Owner, number>;
  capacity: number;
  provider: string;
  providerMode: Provider["mode"];
  providerSource?: string;
  deviceAssignments: Record<Owner, number[]>;
  vramPerGpuGb: number;
};
export type Proposal = Offer & {
  id: string;
  version: number;
  changes: string[];
  hash: string;
  requestRevisions: Record<Owner, number>;
  createdAt: string;
  expiresAt: string;
  approvals: Partial<Record<Owner, { hash: string; at: string }>>;
  explorations: Partial<Record<Owner, { hash: string; at: string }>>;
  decisionIds: Record<"exploration" | "final_approval", Record<Owner, string>>;
  alternatives: { id: string; label: string; offer: Offer }[];
  status:
    | "pending"
    | "approved"
    | "superseded"
    | "expired"
    | "cancelled"
    | "rejected";
};
export type Agreement = {
  id: string;
  requestIds: Record<Owner, string>;
  proposals: Proposal[];
  status:
    | "negotiating"
    | "awaiting_response"
    | "awaiting_approval"
    | "approved"
    | "infeasible"
    | "expired"
    | "cancelled"
    | "rejected";
  reason?: string;
};
export type Event = {
  id: string;
  sequence: number;
  at: string;
  type: string;
  title: string;
  detail: string;
  scope: "shared" | Owner;
  actor: "Concord" | "Alice’s agent" | "Bob’s agent" | "Alice" | "Bob";
  agreementId?: string;
};
export type Research = {
  mode: "fixture" | "live";
  checkedAt: string;
  status: string;
  sources: { title: string; url: string; excerpt: string }[];
  searchId?: string;
};
export type State = {
  schemaVersion: 4;
  owners: Record<Owner, OwnerRecord>;
  requests: Request[];
  agreements: Agreement[];
  events: Event[];
  research: Research;
  provider: Provider;
  commands: Record<string, { digest: string }>;
  watches: Partial<
    Record<
      Owner,
      {
        id: string;
        owner: Owner;
        need: NeedInput;
        status: "active" | "paused" | "expired";
        createdAt: string;
        expiresAt: string;
      }
    >
  >;
  opportunities: {
    id: string;
    owner: Owner;
    watchId: string;
    requestId: string;
    requestRevision: number;
    status: "pending" | "explored" | "dismissed" | "expired";
    reason: string;
    createdAt: string;
    expiresAt: string;
    delegatedRequestId?: string;
  }[];
};

export const OfferSchema = z
  .object({
    start: z.number().int().min(0).max(1439),
    end: z.number().int().min(1).max(1440),
    totalCents: z.number().int().positive().max(200000),
    shares: z
      .object({
        alice: z.number().int().nonnegative(),
        bob: z.number().int().nonnegative(),
      })
      .strict(),
    capacity: z.number().int().positive().max(100),
    provider: z.string().min(1).max(180),
    providerMode: z.enum(["synthetic", "research-backed"]),
    providerSource: z.url().optional(),
    deviceAssignments: z
      .object({
        alice: z.array(z.number().int().nonnegative()),
        bob: z.array(z.number().int().nonnegative()),
      })
      .strict(),
    vramPerGpuGb: z.number().int().positive(),
  })
  .strict();
export const ProviderSelectionSchema = z
  .object({
    sourceUrl: z.url(),
    planningTotalCents: z.number().int().min(100).max(200000),
  })
  .strict();
export const ApproveSchema = z
  .object({
    agreementId: z.string().uuid(),
    proposalId: z.string().uuid(),
    version: z.number().int().positive(),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type ProposalRef = z.infer<typeof ApproveSchema>;
export const ResponseSchema = z
  .object({
    ownerId: OwnerSchema,
    decisionId: z.string().uuid(),
    proposal: ApproveSchema,
    answer: z.enum(["explore", "decline"]),
  })
  .strict();
export type DecisionResponse = z.infer<typeof ResponseSchema>;
export const FinalApprovalSchema = ApproveSchema.extend({
  ownerId: OwnerSchema,
  decisionId: z.string().uuid(),
  authorization: z.literal("final_agreement"),
}).strict();
export type FinalApproval = z.infer<typeof FinalApprovalSchema>;
export const CounterSchema = z
  .object({
    ownerId: OwnerSchema,
    decisionId: z.string().uuid(),
    proposal: ApproveSchema,
    alternativeId: z.string().uuid().optional(),
    terms: z
      .object({
        start: z.number().int().min(0).max(1439),
        end: z.number().int().min(1).max(1440),
        shares: z
          .object({
            alice: z.number().int().nonnegative(),
            bob: z.number().int().nonnegative(),
          })
          .strict(),
        deviceAssignments: z
          .object({
            alice: z.array(z.number().int().nonnegative()),
            bob: z.array(z.number().int().nonnegative()),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (x) => Boolean(x.alternativeId) !== Boolean(x.terms),
    "Provide exactly one alternativeId or terms",
  );
export type CounterInput = z.infer<typeof CounterSchema>;
export const WatchSchema = z
  .object({ need: NeedSchema, optIn: z.literal(true) })
  .strict();
export const OpportunityResponseSchema = z
  .object({
    ownerId: OwnerSchema,
    opportunityId: z.string().uuid(),
    requestRevision: z.number().int().positive(),
    action: z.enum(["explore", "dismiss"]),
  })
  .strict();
export type OpportunityResponse = z.infer<typeof OpportunityResponseSchema>;
export const AssistantCommandSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("delegate"), need: NeedSchema }).strict(),
  z.object({ kind: z.literal("update"), need: NeedSchema }).strict(),
  z.object({ kind: z.literal("respond"), decision: ResponseSchema }).strict(),
  z
    .object({
      kind: z.literal("reject"),
      decision: ResponseSchema.refine(
        (x) => x.answer === "decline",
        "Reject requires decline",
      ),
    })
    .strict(),
  z.object({ kind: z.literal("counter"), counter: CounterSchema }).strict(),
  z
    .object({ kind: z.literal("approve"), proposal: FinalApprovalSchema })
    .strict(),
  z.object({ kind: z.literal("withdraw") }).strict(),
  z.object({ kind: z.literal("watch"), profile: WatchSchema }).strict(),
  z.object({ kind: z.literal("pause_watch"), paused: z.boolean() }).strict(),
  z
    .object({
      kind: z.literal("opportunity"),
      response: OpportunityResponseSchema,
    })
    .strict(),
]);

export const PROVIDER: Readonly<Provider> = Object.freeze({
  name: "Concord Demo GPU Host",
  totalCents: 1200,
  capacity: 2,
  vramPerGpuGb: 24,
  allocation: "exclusive-device",
  isolationStatus: "provider-confirmation-required",
  duration: 120,
  start: 9 * 60,
  end: 17 * 60,
  mode: "synthetic",
});
export function nextSaturday(now = new Date()) {
  const day = new Date(now);
  day.setUTCDate(day.getUTCDate() + ((6 - day.getUTCDay() + 7) % 7 || 7));
  return day.toISOString().slice(0, 10);
}
export function defaults(date = nextSaturday()): Record<Owner, OwnerRecord> {
  return {
    alice: {
      limits: {
        region: "US West",
        date,
        window: { start: 540, end: 1020 },
        gpuCount: 1,
        minVramGb: 24,
        runtimeMinutes: 60,
        trustClass: "public-demo",
        maxBudgetCents: 500,
        consent: true,
      },
    },
    bob: {
      limits: {
        region: "US West",
        date,
        window: { start: 600, end: 1020 },
        gpuCount: 1,
        minVramGb: 24,
        runtimeMinutes: 120,
        trustClass: "public-demo",
        maxBudgetCents: 900,
        consent: true,
      },
    },
  };
}
