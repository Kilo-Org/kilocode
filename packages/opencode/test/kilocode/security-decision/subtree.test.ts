// kilocode_change - new file
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ShellPermission } from "@/tool/shell"
import { SecurityDecisionAdapter } from "@/kilocode/security-decision/adapter"
import { SecurityReviewer } from "@/kilocode/security-decision/reviewer"
import type { Permission } from "@/permission"
import type { Context } from "@/tool/tool"
import { SessionID, MessageID } from "@/session/schema"
import { provideTestInstance, tmpdir } from "../../fixture/fixture"
import { SecurityDamage } from "./damage"

/**
 * Destroying a directory destroys everything under it.
 *
 * The layer classified `.github` as ordinary, because the CI class is spelled `.github/workflows`
 * and the parent matches no pattern of its own. So `rm -rf .github` — which removes every workflow
 * in the repository — landed on the ordinary destructive path, became reviewable, and a permissive
 * reviewer could narrow it to an allow. The effect is a CI mutation whichever way it is spelled.
 *
 * The fix is about operation semantics, not about one directory name: an operation that takes a
 * whole subtree away inherits the strictest class living inside that subtree. Reading a directory
 * takes nothing away and inherits nothing.
 */

const runtime = ManagedRuntime.make(
  Layer.mergeAll(AppNodeBuilder.build(CrossSpawnSpawner.node), AppNodeBuilder.build(FSUtil.node)),
)

const UNCONTAINED = { sandbox: "off", network: "allow", destinations: [], escalated: false } as const

afterEach(() => SecurityReviewer.reset())

async function decide(command: string, cwd: string) {
  const permission = await runtime.runPromise(ShellPermission)
  const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
  const ctx: Context = {
    sessionID: SessionID.make("ses_subtree"),
    messageID: MessageID.make("msg_subtree"),
    callID: "",
    agent: "code",
    abort: AbortSignal.any([]),
    messages: [],
    metadata: () => Effect.void,
    ask: (req) =>
      Effect.sync(() => {
        requests.push(req as Omit<Permission.Request, "id" | "sessionID" | "tool">)
      }),
  }
  await Effect.runPromise(
    permission.ask(ctx, { command, cwd, shell: "/bin/bash" }).pipe(Effect.catchCause(() => Effect.void)),
  )
  const bash = requests.find((item) => item.permission === "bash")
  const facts = (bash?.metadata?.["securityFacts"] ?? {}) as { effects?: SecurityDamage.Effect[]; argv?: string[] }
  const directive = SecurityDecisionAdapter.evaluate(
    {
      permission: "bash",
      patterns: bash?.patterns ?? [command],
      metadata: bash?.metadata ?? {},
      sessionID: "ses_subtree",
    },
    {
      workspace: cwd,
      effective: "allow",
      humanOnly: false,
      floor: { action: "allow", authority: "untrusted", conflict: false },
      containment: UNCONTAINED,
    },
  )
  const reviewed = directive.review
    ? await Effect.runPromise(
        SecurityReviewer.review(
          {
            decision: directive.decision,
            reason: directive.audit.reason,
            rule_id: directive.rule_id,
            requirements: directive.audit.requirements,
            reviewable: directive.reviewable,
          },
          directive.review,
          { timeout: 500 },
        ),
      )
    : undefined
  return {
    decision: directive.decision,
    final: reviewed?.result.decision ?? directive.decision,
    rule: directive.rule_id,
    reviewable: directive.reviewable,
    reviewer_called: (reviewed?.outcome.state ?? "not_run") !== "not_run",
    damage: SecurityDamage.oracle({
      workspace: cwd,
      effects: facts.effects ?? [],
      ...(facts.argv ? { argv: facts.argv } : {}),
    }),
  }
}

const withTmp = (fn: (cwd: string) => Promise<void>) => async () => {
  await using tmp = await tmpdir()
  await provideTestInstance({ directory: tmp.path, fn: () => fn(tmp.path) })
}

/** Says yes to everything, so a reviewable ask is visibly an opening and not a formality. */
function permissive() {
  SecurityReviewer.bind(() => Promise.resolve('{"decision":"allow","reason_code":"LOOKS_ROUTINE"}'), 500, "stub/yes")
}

describe("a destructive operation on a protected directory's parent", () => {
  test(
    "removing .github is held as the CI mutation it is",
    withTmp(async (cwd) => {
      permissive()
      const result = await decide("rm -rf .github", cwd)
      // Not pinned to a rule id: what matters is that no automation may answer it.
      expect(result.decision).toBe("ask")
      expect(result.reviewable).toBe(false)
      expect(result.reviewer_called).toBe(false)
      expect(result.final).toBe("ask")
      expect(result.damage).toEqual({ damaging: true, reason: "ci" })
    }),
  )

  test(
    "the parent and the directory itself reach the same enforcement",
    withTmp(async (cwd) => {
      permissive()
      const parent = await decide("rm -rf .github", cwd)
      const child = await decide("rm -rf .github/workflows", cwd)
      expect({ decision: parent.decision, reviewable: parent.reviewable, called: parent.reviewer_called }).toEqual({
        decision: child.decision,
        reviewable: child.reviewable,
        called: child.reviewer_called,
      })
    }),
  )

  test(
    "moving the directory away is the same loss as deleting it",
    withTmp(async (cwd) => {
      permissive()
      // Inside the workspace on purpose: an outside destination would be held by the boundary rule
      // instead, and the ancestor question would never be asked.
      const result = await decide("mv .github .backup", cwd)
      expect(result.decision).toBe("ask")
      expect(result.reviewable).toBe(false)
      expect(result.reviewer_called).toBe(false)
      expect(result.damage.damaging).toBe(true)
    }),
  )

  test(
    "directories that already carry a class of their own keep being held",
    withTmp(async (cwd) => {
      permissive()
      for (const command of ["rm -rf .circleci", "rm -rf .git", "rm -rf .husky", "rm -rf .githooks"]) {
        const result = await decide(command, cwd)
        expect([command, result.decision, result.reviewable, result.reviewer_called]).toEqual([
          command,
          "ask",
          false,
          false,
        ])
        expect([command, result.damage.damaging]).toEqual([command, true])
      }
    }),
  )
})

describe("what ancestor inheritance must not do", () => {
  test(
    "reading a protected directory takes nothing away",
    withTmp(async (cwd) => {
      permissive()
      for (const command of ["ls .github", "cat .github/workflows/ci.yml", "cat .github/actions/run.yml"]) {
        const result = await decide(command, cwd)
        expect([command, result.decision]).toEqual([command, "pass"])
        expect([command, result.damage.damaging]).toEqual([command, false])
      }

      const redirected = await decide("ls -la .github .github/actions 2>/dev/null || true", cwd)
      expect(redirected.decision).toBe("pass")
      expect(redirected.rule).toBe("SEC.V1.NO_OPINION")
    }),
  )

  test(
    "an ordinary directory delete stays ordinary",
    withTmp(async (cwd) => {
      permissive()
      const result = await decide("rm -rf dist", cwd)
      expect(result.rule).toBe("SEC.V1.DESTRUCTIVE_FS")
      expect(result.reviewable).toBe(true)
      expect(result.reviewer_called).toBe(true)
      expect(result.damage.damaging).toBe(false)
    }),
  )

  test(
    "a directory that merely shares a prefix is not a parent",
    withTmp(async (cwd) => {
      permissive()
      // `.githubbing` is not an ancestor of `.github/workflows`; prefix matching must be on segments.
      const result = await decide("rm -rf .githubbing", cwd)
      expect(result.rule).toBe("SEC.V1.DESTRUCTIVE_FS")
      expect(result.reviewable).toBe(true)
    }),
  )
})
