import { createHash } from "node:crypto"

export function projectIdFor(canonicalRoot: string): string {
  return createHash("sha256").update(canonicalRoot).digest("hex").slice(0, 16)
}
