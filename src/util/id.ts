import crypto from "node:crypto";

// Stable short id from normalized parts. Same scheme every source uses so the
// same posting from different code paths collapses to one row.
export function hashId(parts: string[]): string {
  return crypto.createHash("sha1").update(parts.join("|").toLowerCase()).digest("hex").slice(0, 16);
}
