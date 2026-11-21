// kilocode_change - new file
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import path from "path"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ShellPermission } from "@/tool/shell"
import { KiloSecurityGate } from "@/kilocode/security-decision/gate"
import { SecurityReviewer } from "@/kilocode/security-decision/reviewer"
import { SecurityDecisionAdapter } from "@/kilocode/security-decision/adapter"
import type { Permission } from "@/permission"
import { SessionID, MessageID } from "@/session/schema"
import { provideTestInstance, tmpdir } from "../../fixture/fixture"

/**
 * File effects are read off the same tree-sitter scan that produces the permission patterns, so the
 * security layer never runs a second parser. These tests only scan — `ShellPermission.ask` never
 * executes the command, which is what makes `rm -rf /` safe to assert on.
 */

const runtime = ManagedRuntime.make(
  Layer.mergeAll(AppNodeBuilder.build(CrossSpawnSpawner.node), AppNodeBuilder.build(FSUtil.node)),
)

type Effects = Array<{ operation: string; path?: string }>

const facts = async (command: string, cwd: string) => {
  const permission = await runtime.runPromise(ShellPermission)
  const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
  const ctx = {
    sessionID: SessionID.make("ses_effects"),
    messageID: MessageID.make("msg_effects"),
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
  return (bash?.metadata?.["securityFacts"] ?? {}) as {
    effects?: Effects
    argv?: string[]
    executable?: string
    classified?: boolean
    ambient?: boolean
    complete?: boolean
    composed?: boolean
    decomposable?: boolean
    commands?: Array<{ executable?: string; argv?: string[]; classified?: boolean; ambient?: boolean }>
  }
}

const scan = async (command: string, cwd: string) => (await facts(command, cwd)).effects ?? []

/** The permission names one shell action asks for, in the order the tool asks them. */
const order = async (command: string, cwd: string) => {
  const permission = await runtime.runPromise(ShellPermission)
  const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
  const ctx = {
    sessionID: SessionID.make("ses_order"),
    messageID: MessageID.make("msg_order"),
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
  await Effect.runPromise(permission.ask(ctx as never, { command, cwd, shell: "/bin/bash", escalate: true }))
  return requests.map((item) => item.permission)
}

const withTmp = (fn: (cwd: string) => Promise<void>) => async () => {
  await using tmp = await tmpdir()
  await provideTestInstance({ directory: tmp.path, fn: () => fn(tmp.path) })
}

describe.skipIf(process.platform === "win32")("shell file effects", () => {
  test(
    "operational write containment cannot auto-allow an unclassified command",
    withTmp(async (cwd) => {
      const command = `python -c 'open(".github/workflows/pwn.yml", "w").write("x")'`
      const securityFacts = await facts(command, cwd)
      const out = SecurityDecisionAdapter.evaluate(
        {
          permission: "bash",
          patterns: [command],
          metadata: { securityFacts },
          sessionID: "ses_contained",
        },
        {
          workspace: cwd,
          effective: "allow",
          humanOnly: false,
          floor: { action: "allow", authority: "untrusted", conflict: false },
          containment: { sandbox: "operational", network: "deny", destinations: [], escalated: false },
        },
      )
      expect(out.decision).toBe("ask")
      expect(out.rule_id).toBe("SEC.V1.CONTAINED_EXEC")
      expect(out.reviewable).toBe(false)
    }),
  )

  test(
    "an append redirect into a git hook is an update of that hook",
    withTmp(async (cwd) => {
      expect(await scan("echo hi >> .git/hooks/pre-commit", cwd)).toEqual([
        { operation: "update", path: path.join(cwd, ".git/hooks/pre-commit") },
      ])
    }),
  )

  test(
    "a truncating redirect is an update of its destination",
    withTmp(async (cwd) => {
      expect(await scan("echo hi > .github/workflows/ci.yml", cwd)).toEqual([
        { operation: "update", path: path.join(cwd, ".github/workflows/ci.yml") },
      ])
    }),
  )

  test(
    "an input redirect is a read",
    withTmp(async (cwd) => {
      expect(await scan("wc -l < .env", cwd)).toEqual([{ operation: "read", path: path.join(cwd, ".env") }])
    }),
  )

  test(
    "cat reports a read of its argument",
    withTmp(async (cwd) => {
      expect(await scan("cat .env", cwd)).toEqual([{ operation: "read", path: path.join(cwd, ".env") }])
    }),
  )

  test(
    "read-family commands report a read of their argument, the same way cat does",
    withTmp(async (cwd) => {
      for (const command of ["head -50 README.md", "tail -n 5 README.md", "wc -l README.md", "nl README.md"]) {
        expect(await scan(command, cwd)).toEqual([{ operation: "read", path: path.join(cwd, "README.md") }])
      }
    }),
  )

  test(
    "metadata-only readers report a read of their argument",
    withTmp(async (cwd) => {
      expect(await scan("stat src/a.ts", cwd)).toEqual([{ operation: "read", path: path.join(cwd, "src/a.ts") }])
      expect(await scan("file src/a.ts", cwd)).toEqual([{ operation: "read", path: path.join(cwd, "src/a.ts") }])
      expect(await scan("ls -la .github .github/actions", cwd)).toEqual([
        { operation: "read", path: path.join(cwd, ".github") },
        { operation: "read", path: path.join(cwd, ".github/actions") },
      ])
    }),
  )

  test(
    "diff reports a read of both of its operands",
    withTmp(async (cwd) => {
      expect(await scan("diff src/a.ts src/b.ts", cwd)).toEqual([
        { operation: "read", path: path.join(cwd, "src/a.ts") },
        { operation: "read", path: path.join(cwd, "src/b.ts") },
      ])
    }),
  )

  test(
    "a read-family command reaches the sensitive boundary the read tool reaches",
    withTmp(async (cwd) => {
      expect(await scan("head /etc/passwd", cwd)).toEqual([{ operation: "read", path: "/etc/passwd" }])
    }),
  )

  test(
    "commands that can redirect their own output stay outside the effect table",
    withTmp(async (cwd) => {
      expect(await scan("sort -o out.txt in.txt", cwd)).toEqual([])
      expect(await scan("uniq in.txt out.txt", cwd)).toEqual([])
      expect(await scan("find . -exec rm {} ;", cwd)).toEqual([])
    }),
  )

  test(
    "rm reports a delete and mv reports a move",
    withTmp(async (cwd) => {
      expect(await scan("rm -rf build", cwd)).toEqual([{ operation: "delete", path: path.join(cwd, "build") }])
      expect(await scan("mv src/a.ts src/b.ts", cwd)).toEqual([
        { operation: "move", path: path.join(cwd, "src/a.ts") },
        { operation: "move", path: path.join(cwd, "src/b.ts") },
      ])
    }),
  )

  test(
    "an absolute root target survives resolution",
    withTmp(async (cwd) => {
      expect(await scan("rm -rf /", cwd)).toEqual([{ operation: "delete", path: "/" }])
    }),
  )

  test(
    "a dynamic target is reported without a path",
    withTmp(async (cwd) => {
      expect(await scan("rm -rf $TARGET", cwd)).toEqual([{ operation: "delete" }])
      expect(await scan("echo hi > $OUT", cwd)).toEqual([{ operation: "update" }])
    }),
  )

  test(
    "a glob target is reported without a path",
    withTmp(async (cwd) => {
      expect(await scan("rm -rf *", cwd)).toEqual([{ operation: "delete" }])
    }),
  )

  test(
    "commands outside the effect table report nothing",
    withTmp(async (cwd) => {
      expect(await scan("git status", cwd)).toEqual([])
      expect(await scan("npm test", cwd)).toEqual([])
    }),
  )

  test(
    "a descriptor redirect is not a file effect",
    withTmp(async (cwd) => {
      expect(await scan("npm test 2>&1", cwd)).toEqual([])
    }),
  )
})

describe.skipIf(process.platform === "win32")("shell exec facts", () => {
  test(
    "the parsed command line travels with the facts",
    withTmp(async (cwd) => {
      expect(await facts("sed -i s/a/b/ src/a.ts", cwd)).toMatchObject({
        executable: "sed",
        argv: ["sed", "-i", "s/a/b/", "src/a.ts"],
        classified: false,
      })
    }),
  )

  test(
    "an executable whose file effects the scan knows is reported as classified",
    withTmp(async (cwd) => {
      expect(await facts("cat README.md", cwd)).toMatchObject({ executable: "cat", classified: true })
      expect(await facts("git status", cwd)).toMatchObject({ executable: "git", classified: false })
    }),
  )

  test(
    "a read-family executable is reported as classified",
    withTmp(async (cwd) => {
      expect(await facts("head -50 README.md", cwd)).toMatchObject({ executable: "head", classified: true })
      expect(await facts("wc -l README.md", cwd)).toMatchObject({ executable: "wc", classified: true })
    }),
  )

  test(
    "redirect targets are effects, not argv",
    withTmp(async (cwd) => {
      expect((await facts("echo hi > out.txt", cwd)).argv).toEqual(["echo", "hi"])
    }),
  )

  test(
    "a composed command reports no single command line to reason about",
    withTmp(async (cwd) => {
      const out = await facts("echo a && echo b", cwd)
      expect(out.composed).toBe(true)
      expect(out.argv).toBeUndefined()
    }),
  )

  test(
    "marks shell parameter expansion by syntax without depending on credential names",
    withTmp(async (cwd) => {
      expect(await facts('echo "$PROJECT_VALUE"', cwd)).toMatchObject({ executable: "echo", ambient: true })
      expect(await facts("printf '%s\\n' \"${BUILD_CONTEXT}\"", cwd)).toMatchObject({
        executable: "printf",
        ambient: true,
      })
      expect(await facts("echo '${STATIC_TEXT}'", cwd)).toMatchObject({ executable: "echo", ambient: false })
    }),
  )

  test(
    "git show object syntax is not inert even when a metadata flag is present",
    withTmp(async (cwd) => {
      const command = "git show --stat HEAD:.env"
      const securityFacts = await facts(command, cwd)
      const out = SecurityDecisionAdapter.evaluate(
        { permission: "bash", patterns: [command], metadata: { securityFacts }, sessionID: "ses_git_show" },
        {
          workspace: cwd,
          effective: "allow",
          humanOnly: false,
          floor: { action: "allow", authority: "untrusted", conflict: false },
          containment: { sandbox: "off", network: "allow", destinations: [], escalated: false },
        },
      )

      expect(securityFacts.argv).toEqual(["git", "show", "--stat", "HEAD:.env"])
      expect(out.decision).toBe("ask")
      expect(out.rule_id).toBe("SEC.V1.UNCLASSIFIED_EXEC")
    }),
  )
})

describe.skipIf(process.platform === "win32")("ambient environment disclosure", () => {
  test(
    "output commands with parameter expansion cannot pass as inert",
    withTmp(async (cwd) => {
      for (const command of ['echo "$PROJECT_VALUE"', "printf '%s\\n' \"${BUILD_CONTEXT}\""]) {
        const securityFacts = await facts(command, cwd)
        const out = SecurityDecisionAdapter.evaluate(
          { permission: "bash", patterns: [command], metadata: { securityFacts }, sessionID: "ses_ambient" },
          {
            workspace: cwd,
            effective: "allow",
            humanOnly: false,
            floor: { action: "allow", authority: "untrusted", conflict: false },
            containment: { sandbox: "off", network: "allow", destinations: [], escalated: false },
          },
        )

        expect(out.decision).toBe("ask")
        expect(out.rule_id).toBe("SEC.V1.AMBIENT_ENVIRONMENT")
        expect(out.reviewable).toBe(false)
      }
    }),
  )

  test(
    "environment readers are non-reviewable without relying on containment",
    withTmp(async (cwd) => {
      for (const command of ["env", "printenv", "printenv PATH", "set"]) {
        const securityFacts = await facts(command, cwd)
        const out = SecurityDecisionAdapter.evaluate(
          { permission: "bash", patterns: [command], metadata: { securityFacts }, sessionID: "ses_ambient" },
          {
            workspace: cwd,
            effective: "allow",
            humanOnly: false,
            floor: { action: "allow", authority: "untrusted", conflict: false },
            containment: { sandbox: "off", network: "allow", destinations: [], escalated: false },
          },
        )

        expect({ command, ambient: securityFacts.ambient }).toEqual({ command, ambient: true })
        expect(out.decision).toBe("ask")
        expect(out.rule_id).toBe("SEC.V1.AMBIENT_ENVIRONMENT")
        expect(out.reviewable).toBe(false)
      }
    }),
  )

  test(
    "environment declarations cannot bypass the permission decision",
    withTmp(async (cwd) => {
      for (const command of ["export -p", "declare -x", "typeset -x"]) {
        const securityFacts = await facts(command, cwd)
        const out = SecurityDecisionAdapter.evaluate(
          { permission: "bash", patterns: [command], metadata: { securityFacts }, sessionID: "ses_ambient" },
          {
            workspace: cwd,
            effective: "allow",
            humanOnly: false,
            floor: { action: "allow", authority: "untrusted", conflict: false },
            containment: { sandbox: "off", network: "allow", destinations: [], escalated: false },
          },
        )

        expect(out.decision).toBe("ask")
        expect(out.reviewable).toBe(false)
      }
    }),
  )

  test(
    "literal output remains inert",
    withTmp(async (cwd) => {
      for (const command of ["echo hello", "printf '%s\\n' hello", "echo '${STATIC_TEXT}'"]) {
        const securityFacts = await facts(command, cwd)
        const out = SecurityDecisionAdapter.evaluate(
          { permission: "bash", patterns: [command], metadata: { securityFacts }, sessionID: "ses_literal" },
          {
            workspace: cwd,
            effective: "allow",
            humanOnly: false,
            floor: { action: "allow", authority: "untrusted", conflict: false },
            containment: { sandbox: "off", network: "allow", destinations: [], escalated: false },
          },
        )

        expect(out.rule_id).toBe("SEC.V1.NO_OPINION")
        expect(out.decision).toBe("pass")
      }
    }),
  )
})

/**
 * Sequencing is plumbing: `&&`, `;` and `|` only decide the order in which fully parsed commands
 * run, so each element can be judged on its own. Substitutions, subshells and heredocs change *what*
 * runs, so a command carrying one stays opaque and keeps the blanket composed ask.
 */
describe.skipIf(process.platform === "win32")("composed shell commands", () => {
  test(
    "a sequence reports each command it will run",
    withTmp(async (cwd) => {
      const out = await facts("cd app && npm test", cwd)
      expect(out.composed).toBe(true)
      expect(out.decomposable).toBe(true)
      expect(out.commands).toEqual([
        { executable: "cd", argv: ["cd", "app"], classified: false, ambient: false },
        { executable: "npm", argv: ["npm", "test"], classified: false, ambient: false },
      ])
    }),
  )

  test(
    "a sequence longer than the adapter bound fails closed instead of being decided by its prefix",
    withTmp(async (cwd) => {
      const command = Array.from({ length: 33 }, () => "git status").join("; ")
      const securityFacts = await facts(command, cwd)
      const out = SecurityDecisionAdapter.evaluate(
        { permission: "bash", patterns: [command], metadata: { securityFacts }, sessionID: "ses_truncated" },
        {
          workspace: cwd,
          effective: "allow",
          humanOnly: false,
          floor: { action: "allow", authority: "untrusted", conflict: false },
          containment: { sandbox: "off", network: "allow", destinations: [], escalated: false },
        },
      )

      expect(securityFacts.commands).toHaveLength(33)
      expect(out).toMatchObject({
        decision: "ask",
        rule_id: "SEC.V1.METADATA_INCOMPLETE",
        reviewable: false,
        audit: { metadata_complete: true, metadata_truncated: true },
      })
      expect(out.review).toBeUndefined()
    }),
  )

  test(
    "a pipeline reports each command it will run",
    withTmp(async (cwd) => {
      const out = await facts("cat src/a.ts | wc -l", cwd)
      expect(out.decomposable).toBe(true)
      expect(out.commands).toEqual([
        { executable: "cat", argv: ["cat", "src/a.ts"], classified: true, ambient: false },
        { executable: "wc", argv: ["wc", "-l"], classified: true, ambient: false },
      ])
    }),
  )

  test(
    "a single command reports itself as one unit too",
    withTmp(async (cwd) => {
      const out = await facts("npm test", cwd)
      expect(out.composed).toBe(false)
      expect(out.commands).toEqual([{ executable: "npm", argv: ["npm", "test"], classified: false, ambient: false }])
    }),
  )

  test(
    "an ambient expansion in one sequenced command prevents an inert prefix decision",
    withTmp(async (cwd) => {
      const command = 'echo "$PROJECT_VALUE"; pwd'
      const securityFacts = await facts(command, cwd)
      const out = SecurityDecisionAdapter.evaluate(
        { permission: "bash", patterns: [command], metadata: { securityFacts }, sessionID: "ses_sequence_ambient" },
        {
          workspace: cwd,
          effective: "allow",
          humanOnly: false,
          floor: { action: "allow", authority: "untrusted", conflict: false },
          containment: { sandbox: "off", network: "allow", destinations: [], escalated: false },
        },
      )

      expect(securityFacts.commands?.at(0)?.ambient).toBe(true)
      expect(out.decision).toBe("ask")
      expect(out.rule_id).toBe("SEC.V1.AMBIENT_ENVIRONMENT")
      expect(out.reviewable).toBe(false)
    }),
  )

  test.each([["echo $(git rev-parse HEAD)"], ["cat <(ls)"], ["(cd src && rm a.ts)"], ["cat <<EOF\nhi\nEOF"]])(
    "%s stays opaque",
    (command) =>
      withTmp(async (cwd) => {
        expect((await facts(command, cwd)).decomposable).toBe(false)
      })(),
  )

  test(
    "an unrecovered parse is never decomposable",
    withTmp(async (cwd) => {
      const out = await facts("npm test &&", cwd)
      expect(out.complete).toBe(false)
      expect(out.decomposable).toBe(false)
    }),
  )
})

/**
 * A sandbox escalation removes the confinement the `bash` decision may have relied on, so it has to
 * be settled *before* that decision runs. Asking it afterwards lets a call be allowed on the
 * strength of a sandbox and then execute outside it.
 */
describe.skipIf(process.platform === "win32")("escalation is settled before the command is decided", () => {
  test.each([["git push"], ["command git push"], ["env FOO=1 git push"]])(
    "%s asks for escalation before bash",
    (command) =>
      withTmp(async (cwd) => {
        const asked = await order(command, cwd)
        expect(asked.indexOf("sandbox_escalation")).toBeGreaterThanOrEqual(0)
        expect(asked.indexOf("sandbox_escalation")).toBeLessThan(asked.indexOf("bash"))
      })(),
  )

  test(
    "a command that mutates nothing in git asks for bash alone",
    withTmp(async (cwd) => {
      expect(await order("git status", cwd)).toEqual(["bash"])
    }),
  )
})


describe("freeze protected effects", () => {
  const destinations = [
    ".git/modules/sub/hooks/pre-commit", ".git/index", ".git/refs/heads/main",
    "./tmp/../.git/modules/sub/hooks/pre-commit", ".github/workflows/ci.yml",
    ".github/actions/local/action.yml", ".gitlab-ci.yml", ".circleci/config.yml",
    ".buildkite/pipeline.yml", "Jenkinsfile", ".drone.yml", "bitbucket-pipelines.yml", "package.json",
  ]
  for (const target of destinations) {
    test(`protected destination ${target}: direct/copy/redirect/utility and permissive reviewer`, withTmp(async (cwd) => {
      const ctx: SecurityDecisionAdapter.Context = {
        workspace: cwd, effective: "allow", humanOnly: false,
        floor: { action: "allow", authority: "untrusted", conflict: false },
        containment: { sandbox: "operational", network: "deny", destinations: [], escalated: false },
      }
      const direct = SecurityDecisionAdapter.evaluate({ permission: "write", patterns: [target], sessionID: "ses_freeze" }, ctx)
      expect(direct.decision).toBe(target.includes("/hooks/") ? "deny" : "ask")
      expect(direct.reviewable).toBe(false)
      const commands = [
        `cp evil.sh ${target}`, `mv temp ${target}`, `echo evil > ${target}`,
        `sed -i 's/a/b/' ${target}`, `truncate -s 0 ${target}`, `tee ${target}`,
        `dd if=temp of=${target}`, `sort temp -o ${target}`, `install temp ${target}`,
        `rsync temp ${target}`, `tar -xf temp.tar -C ${target}`, `unzip temp.zip -d ${target}`,
      ]
      const previous = process.env.KILO_SECURITY_DECISION
      process.env.KILO_SECURITY_DECISION = "1"
      let calls = 0
      SecurityReviewer.bind(() => { calls++; return Promise.resolve('{"decision":"allow","reason_code":"ORDINARY_DEV_COMMAND"}') })
      try {
        for (const command of commands) {
          const securityFacts = await facts(command, cwd)
          const out = await Effect.runPromise(KiloSecurityGate.evaluate({
            permission: "bash", patterns: [command], metadata: { securityFacts }, sessionID: "ses_freeze",
            workspace: cwd, resolved: [{ pattern: command, action: "allow" }], humanOnly: false,
            config: { getGlobal: () => Effect.succeed({ permission: {} } as never) }, containment: ctx.containment,
          }))
          expect({ command, decision: out?.decision, reviewable: out?.reviewable, calls }).toEqual({ command, decision: direct.decision, reviewable: direct.reviewable, calls: 0 })
        }
      } finally {
        SecurityReviewer.reset()
        if (previous === undefined) delete process.env.KILO_SECURITY_DECISION
        else process.env.KILO_SECURITY_DECISION = previous
      }
    }))
    test(`known read-only ${target}`, withTmp(async (cwd) => {
      const out = SecurityDecisionAdapter.evaluate({ permission: "bash", patterns: [`cat ${target}`], metadata: { securityFacts: await facts(`cat ${target}`, cwd) }, sessionID: "ses_freeze" }, {
        workspace: cwd, effective: "allow", humanOnly: false, floor: { action: "allow", authority: "untrusted", conflict: false },
        containment: { sandbox: "unknown", network: "allow", destinations: [], escalated: false },
      })
      expect(out.decision).toBe("pass")
    }))
  }
  test.each(["unknown", "operational"] as const)("independent exec contributor under %s containment", (sandbox) => withTmp(async (cwd) => {
    for (const executable of ["./scripts/deploy.sh", "sh -c true"]) {
      for (const command of [executable, `rm -rf build && ${executable}`, `${executable} && rm -rf build`]) {
        const out = SecurityDecisionAdapter.evaluate({ permission: "bash", patterns: [command], metadata: { securityFacts: await facts(command, cwd) }, sessionID: "ses_freeze" }, {
          workspace: cwd, effective: "allow", humanOnly: false, floor: { action: "allow", authority: "untrusted", conflict: false },
          containment: { sandbox, network: "deny", destinations: [], escalated: false },
        })
        expect({ command, decision: out.decision, reviewable: out.reviewable }).toEqual({ command, decision: "ask", reviewable: false })
      }
    }
  })())
  test.each(["cat", "truncate -s 0", "rm -rf"])("named home %s stays unknown", (utility) => withTmp(async (cwd) => {
    for (const target of ["~root/file", "~alice/file"]) {
      const command = `${utility} ${target}`
      const out = SecurityDecisionAdapter.evaluate({ permission: "bash", patterns: [command], metadata: { securityFacts: await facts(command, cwd) }, sessionID: "ses_freeze" }, {
        workspace: cwd, effective: "allow", humanOnly: false, floor: { action: "allow", authority: "untrusted", conflict: false },
        containment: { sandbox: "operational", network: "deny", destinations: [], escalated: false },
      })
      expect(out.decision).toBe("ask")
      expect(out.reviewable).toBe(false)
    }
  })())
})


test("unclassified archive extraction syntax never reaches a permissive reviewer", withTmp(async (cwd) => {
  const previous = process.env.KILO_SECURITY_DECISION
  process.env.KILO_SECURITY_DECISION = "1"
  let calls = 0
  SecurityReviewer.bind(() => { calls++; return Promise.resolve('{"decision":"allow","reason_code":"ORDINARY_DEV_COMMAND"}') })
  try {
    for (const command of ["tar -xvfarchive.tar", "tar --get -f archive.tar", "tar xf archive.tar", "tar -xf archive.tar", "tar -czf backup.tgz ."]) {
      const out = await Effect.runPromise(KiloSecurityGate.evaluate({
        permission: "bash", patterns: [command], metadata: { securityFacts: await facts(command, cwd) }, sessionID: "ses_archive",
        workspace: cwd, resolved: [{ pattern: command, action: "allow" }], humanOnly: false,
        config: { getGlobal: () => Effect.succeed({ permission: {} } as never) },
        containment: { sandbox: "operational", network: "deny", destinations: [], escalated: false },
      }))
      expect({ command, decision: out?.decision, reviewable: out?.reviewable, calls }).toEqual({ command, decision: "ask", reviewable: false, calls: 0 })
    }
  } finally {
    SecurityReviewer.reset()
    if (previous === undefined) delete process.env.KILO_SECURITY_DECISION
    else process.env.KILO_SECURITY_DECISION = previous
  }
}))
