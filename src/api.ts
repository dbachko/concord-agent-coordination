import type { OwnerView } from "../server/engine";
import type { integrationStatus } from "../server/integrations";
import type { Owner } from "../server/types";
export type View = OwnerView & {
  integrations?: ReturnType<typeof integrationStatus>;
};
export type Session = { owner: Owner; token: string };
export async function api<T>(
  path: string,
  token?: string,
  body?: unknown,
  extra: Record<string, string> = {},
): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok)
    throw new Error(
      data.message || "The server could not complete this command.",
    );
  return data as T;
}
export function command(session: Session, body: unknown) {
  return api<View>("/api/assistant/command", session.token, body, {
    "Idempotency-Key": crypto.randomUUID(),
  });
}
export function money(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 ? 2 : 0,
  }).format(cents / 100);
}
export function clock(minutes: number) {
  const h = Math.floor(minutes / 60);
  return `${h % 12 || 12}${minutes % 60 ? `:${String(minutes % 60).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
}
export const timeInput = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
export const minutesFrom = (time: string) =>
  Number(time.split(":")[0]) * 60 + Number(time.split(":")[1]);
export function day(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
