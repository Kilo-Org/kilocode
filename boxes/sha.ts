import { createHash } from "crypto"

export function sha1(input: string | Buffer): string {
  return createHash("sha1").update(input).digest("hex")
}
