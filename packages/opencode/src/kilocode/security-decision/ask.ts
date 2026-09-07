// kilocode_change - new file
/**
 * Typed provenance for a permission ask the deterministic security layer raised itself.
 *
 * Clients must be able to tell a security-generated ask from an ordinary Kilo ask *structurally* —
 * never from the prompt text and never by guessing at a rule id — because the two carry opposite
 * auto-approval rules: an ordinary ask may be auto-approved by `kilo run --auto`, a security ask
 * never may. The marker rides on the published request metadata and carries nothing but the stable
 * rule id, so it echoes no command, path or content.
 *
 * Kept dependency-free (no Effect, no node) so the TUI can import it too.
 */
export namespace SecurityAsk {
  /** Metadata key holding the marker on a published permission request. */
  export const KEY = "securityAsk" as const

  export type Marker = Readonly<{ rule_id: string }>

  /** What a client must do with a published ask. */
  export type Decision = "prompt" | "block" | "once"

  export function mark<M extends Record<string, unknown>>(metadata: M, marker: Marker) {
    return { ...metadata, [KEY]: { rule_id: marker.rule_id } }
  }

  export function of(metadata: Record<string, unknown> | undefined): Marker | undefined {
    const value = metadata?.[KEY]
    if (!value || typeof value !== "object") return undefined
    const rule_id = (value as { rule_id?: unknown }).rule_id
    if (typeof rule_id !== "string" || rule_id.length === 0) return undefined
    return { rule_id }
  }

  export function is(metadata: Record<string, unknown> | undefined): boolean {
    return of(metadata) !== undefined
  }

  /**
   * How an automated run answers a published ask.
   *
   * Interactive runs never answer machine-side — a human decides, `--auto` included. Headless runs
   * keep auto-approving ordinary asks, and reject a security-generated one: that blocks the single
   * call while leaving the turn free to take another path.
   */
  export function autoDecision(input: { interactive: boolean; metadata?: Record<string, unknown> }): Decision {
    if (input.interactive) return "prompt"
    return is(input.metadata) ? "block" : "once"
  }
}
