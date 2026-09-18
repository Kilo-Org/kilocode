/**
 * AutoGuard: a multi-level policy over the agent's *outgoing* tool calls.
 *
 * What it guarantees always: the Level 0 rules in `level0.ts`. No model sits in
 * their decision path, so no text an attacker controls can talk them into an
 * allow.
 *
 * What it does best-effort: everything Level 1 decides.
 *
 * What it does not do: screen inbound prompt injection, sandbox execution, or
 * analyse what an opaque script will do once started. Those are out of scope
 * and stated as such rather than implied away.
 */

export * from "./types"
export { normalize, splitSegments, tokenize, isOpaque, isPipeToShell, classifyRadius, isCredentialPath, isConfigPersistencePath } from "./normalize"
export type { RawToolCall } from "./normalize"
export { level0, hardDeny, fastAllow, descriptorCovers, withinAuthority } from "./level0"
export { createLevel1Client, buildUserPrompt, parseVerdict, SYSTEM_PROMPT, DEFAULT_LEVEL1_CONFIG } from "./level1"
export type { Level1Client, Level1Config, Level1View } from "./level1"
export { evaluate, DEFAULT_CASCADE_CONFIG } from "./cascade"
export type { CascadeConfig } from "./cascade"
