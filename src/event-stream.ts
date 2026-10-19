import type { Event } from "../server/types";

export type StreamFrame = { type: string; data: string; id?: string };
export class SSEParser {
  private buffer = "";
  push(chunk: string): StreamFrame[] {
    this.buffer = (this.buffer + chunk).replaceAll("\r\n", "\n");
    if (this.buffer.length > 1048576)
      throw new Error("Event frame exceeds supported size");
    const frames: StreamFrame[] = [];
    let boundary: number;
    while ((boundary = this.buffer.indexOf("\n\n")) >= 0) {
      const raw = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);
      let type = "message",
        id: string | undefined;
      const data: string[] = [];
      for (const line of raw.split("\n")) {
        if (line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon < 0 ? line : line.slice(0, colon);
        let value = colon < 0 ? "" : line.slice(colon + 1);
        if (value.startsWith(" ")) value = value.slice(1);
        if (field === "event") type = value;
        else if (field === "id" && !value.includes("\0")) id = value;
        else if (field === "data") data.push(value);
      }
      if (data.length)
        frames.push({ type, data: data.join("\n"), ...(id ? { id } : {}) });
    }
    return frames;
  }
}
export function mergeEvents(previous: Event[], incoming: Event[]) {
  return [
    ...new Map(
      [...previous, ...incoming].map((event) => [event.id, event]),
    ).values(),
  ]
    .sort((a, b) => a.sequence - b.sequence)
    .slice(-100);
}
export async function readEvents(
  response: Response,
  receive: (frame: StreamFrame) => void,
) {
  if (
    !response.ok ||
    !response.body ||
    !response.headers.get("content-type")?.startsWith("text/event-stream")
  )
    throw new Error("Event stream unavailable");
  const reader = response.body.getReader(),
    decoder = new TextDecoder(),
    parser = new SSEParser();
  try {
    while (true) {
      const { value, done } = await reader.read();
      for (const frame of parser.push(
        done ? decoder.decode() : decoder.decode(value, { stream: true }),
      ))
        receive(frame);
      if (done) return;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
