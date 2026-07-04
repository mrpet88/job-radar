import fs from "node:fs/promises";
import path from "node:path";
import type { Board } from "./types.js";

const DATA_DIR = path.resolve("data");
const STORE = path.join(DATA_DIR, "boards.json");
const DEAD = path.join(DATA_DIR, "dead.json");

export const boardKey = (b: Pick<Board, "vendor" | "token" | "site">) =>
  `${b.vendor}:${b.token.toLowerCase()}:${(b.site ?? "").toLowerCase()}`;

export async function loadBoards(): Promise<Board[]> {
  try {
    return JSON.parse(await fs.readFile(STORE, "utf8")) as Board[];
  } catch { return []; }
}

export async function saveBoards(boards: Board[]): Promise<void> {
  boards.sort((a, b) => a.vendor.localeCompare(b.vendor) || a.token.localeCompare(b.token));
  await fs.writeFile(STORE, JSON.stringify(boards, null, 2));
}

// Denylist of boards that returned 404/410 (gone). Maps boardKey → ISO date they
// died, so we can stop re-discovering them but retry again after a TTL in case a
// company revives its board.
export type DeadList = Record<string, string>;

export async function loadDead(): Promise<DeadList> {
  try {
    return JSON.parse(await fs.readFile(DEAD, "utf8")) as DeadList;
  } catch { return {}; }
}

export async function saveDead(dead: DeadList): Promise<void> {
  await fs.writeFile(DEAD, JSON.stringify(dead, null, 2));
}

// Drop denylist entries older than ttlDays so revived boards can be re-found.
export function pruneExpiredDead(dead: DeadList, ttlDays = 45): DeadList {
  const cutoff = Date.now() - ttlDays * 86_400_000;
  const out: DeadList = {};
  for (const [k, iso] of Object.entries(dead)) {
    const t = Date.parse(iso);
    if (Number.isNaN(t) || t >= cutoff) out[k] = iso;
  }
  return out;
}

// Merge freshly discovered boards into the registry. Returns the merged list and
// the boards that are new this run (for logging). Existing entries are preserved.
// Candidates on the (non-expired) denylist are skipped.
export function mergeBoards(
  existing: Board[],
  candidates: Omit<Board, "firstSeen">[],
  dead: DeadList = {},
): { merged: Board[]; added: Board[] } {
  const now = new Date().toISOString();
  const byKey = new Map(existing.map((b) => [boardKey(b), b]));
  const added: Board[] = [];
  for (const c of candidates) {
    const k = boardKey(c);
    if (byKey.has(k) || dead[k]) continue;
    const b: Board = { ...c, firstSeen: now };
    byKey.set(k, b);
    added.push(b);
  }
  return { merged: [...byKey.values()], added };
}
