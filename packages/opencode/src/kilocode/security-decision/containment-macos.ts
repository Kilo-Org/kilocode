import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { backendSupport, prepareCommand, run as runSandbox, type Profile } from "@kilocode/sandbox"
import type { SecurityDecisionTypes as T } from "./types"

/**
 * Operational containment signal for macOS/Seatbelt.
 *
 * `sandbox-exec` merely existing is not proof that confinement applies, so the layer verifies it
 * once per server process by actually launching a confined child through the public sandbox launch
 * abstraction and observing that a write inside a scratch root succeeds while a write outside it,
 * a write to a denied name and a denied environment variable do not.
 *
 * The result — including a failure or a timeout — is cached for the lifetime of the process: a
 * sandbox that could not be proven must never be retried into an allow. The cache says only that
 * Seatbelt *can* confine; the live `enabled`, network mode, exact destinations and escalation flag
 * are still checked on every individual decision.
 */
export namespace ContainmentMacos {
  export type State = "unknown" | "operational" | "failed" | "unavailable"
  export type Runner = () => Promise<Exclude<State, "unknown">>

  const TIMEOUT_MS = 20_000
  const DENIED_ENV = "KILO_SECURITY_PROBE_SECRET"

  let cached: Exclude<State, "unknown"> | undefined
  let pending: Promise<Exclude<State, "unknown">> | undefined

  /** Test seam only: the probe is otherwise a process-lifetime singleton. */
  export function reset() {
    cached = undefined
    pending = undefined
  }

  export function peek(): State {
    return cached ?? "unknown"
  }

  export function supported(platform: NodeJS.Platform = process.platform) {
    if (platform !== "darwin") return false
    return backendSupport({ mode: "deny", allowedHosts: [] }).available
  }

  export function probe(runner: Runner = check): Promise<Exclude<State, "unknown">> {
    if (cached) return Promise.resolve(cached)
    if (pending) return pending
    pending = runner()
      .catch(() => "failed" as const)
      .then((state) => {
        cached = state
        pending = undefined
        return state
      })
    return pending
  }

  export type Live = Readonly<{
    enabled: boolean
    mode: "allow" | "deny" | "proxy"
    destinations: readonly string[]
    escalated: boolean
    /** Whether the live profile adds writable roots beyond the ones it builds itself. */
    widened: boolean
  }>

  /** Assemble the backend-neutral containment facts the core consumes. */
  export async function facts(live: Live, runner?: Runner): Promise<T.Containment> {
    const sandbox = live.enabled ? await probe(runner) : ("off" as const)
    return {
      sandbox,
      network: live.mode,
      destinations: live.destinations,
      escalated: live.escalated,
      widened: live.widened,
    }
  }

  function profile(scratch: string): Profile {
    return {
      filesystem: {
        allowWrite: [{ path: scratch, kind: "subtree" }],
        denyWrite: [],
        denyNames: [".git"],
        temporaryDirectory: scratch,
      },
      network: { mode: "deny", allowedHosts: [] },
      environment: { deny: [DENIED_ENV], set: {} },
    }
  }

  /**
   * Distinct exit codes so a partial failure is never mistaken for a pass: 0 only when the confined
   * child wrote inside the scratch root and was refused everywhere else.
   */
  const SCRIPT = [
    'printf ok > "$PROBE_SCRATCH/inside" || exit 11',
    'printf no > "$PROBE_OUTSIDE/outside" 2>/dev/null && exit 12',
    'mkdir -p "$PROBE_SCRATCH/.git" 2>/dev/null',
    'printf no > "$PROBE_SCRATCH/.git/hook" 2>/dev/null && exit 13',
    `[ -z "$${DENIED_ENV}" ] || exit 14`,
    "exit 0",
  ].join("\n")

  async function check(): Promise<Exclude<State, "unknown">> {
    if (!supported()) return "unavailable"
    const scratch = await mkdtemp(path.join(os.tmpdir(), "kilo-containment-"))
    const outside = await mkdtemp(path.join(os.tmpdir(), "kilo-containment-out-"))
    try {
      const launch = await Effect.runPromise(
        Effect.scoped(
          runSandbox(
            profile(scratch),
            prepareCommand(ChildProcess.make("/bin/sh", ["-c", SCRIPT], { shell: false }), scratch, {
              PATH: "/usr/bin:/bin",
              PROBE_SCRATCH: scratch,
              PROBE_OUTSIDE: outside,
              [DENIED_ENV]: "leaked",
            }),
          ),
        ),
      )
      const child = Bun.spawn([launch.command, ...launch.args], {
        cwd: launch.options.cwd,
        env: launch.options.env as Record<string, string>,
        stdout: "ignore",
        stderr: "ignore",
      })
      const code = await Promise.race([
        child.exited,
        new Promise<number>((resolve) => setTimeout(() => resolve(-1), TIMEOUT_MS)),
      ])
      if (code !== 0) child.kill()
      return code === 0 ? "operational" : "failed"
    } catch {
      return "failed"
    } finally {
      await rm(scratch, { recursive: true, force: true }).catch(() => {})
      await rm(outside, { recursive: true, force: true }).catch(() => {})
    }
  }
}
