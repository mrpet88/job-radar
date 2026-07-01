import fs from "node:fs/promises";
import path from "node:path";
import type { Board } from "./types.js";

const STORE = path.join(path.resolve("data"), "boards.json");

const key = (b: Pick<Board, "vendor" | "token" | "site">) =>
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

// Merge freshly discovered boards into the registry. Returns the merged list and
// the boards that are new this run (for logging). Existing entries are preserved.
export function mergeBoards(
  existing: Board[],
  candidates: Omit<Board, "firstSeen">[],
): { merged: Board[]; added: Board[] } {
  const now = new Date().toISOString();
  const byKey = new Map(existing.map((b) => [key(b), b]));
  const added: Board[] = [];
  for (const c of candidates) {
    const k = key(c);
    if (byKey.has(k)) continue;
    const b: Board = { ...c, firstSeen: now };
    byKey.set(k, b);
    added.push(b);
  }
  return { merged: [...byKey.values()], added };
}
