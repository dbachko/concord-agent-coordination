import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { PROVIDER, type State } from "./types.js";
import { freshState } from "./engine.js";

/** Single-process local MVP. Atomic snapshot writes; never use shared network storage. */
export class Store {
  private previous = "";
  constructor(private file?: string) {}
  load(): State {
    if (!this.file || !existsSync(this.file)) return freshState();
    const state = JSON.parse(readFileSync(this.file, "utf8")) as State;
    if (state.schemaVersion !== 4)
      throw new Error(
        "Unsupported state schema. Back up .data and reset the demo.",
      );
    state.provider ??= { ...PROVIDER };
    state.events.forEach((e, i) => {
      e.sequence ??= i + 1;
    });
    return state;
  }
  save(state: State) {
    if (!this.file) return;
    const serialized = JSON.stringify(state, null, 2);
    if (serialized === this.previous) return;
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    writeFileSync(`${this.file}.tmp`, serialized, { mode: 0o600 });
    renameSync(`${this.file}.tmp`, this.file);
    this.previous = serialized;
  }
}
