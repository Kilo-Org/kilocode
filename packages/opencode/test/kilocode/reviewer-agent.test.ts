import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Agent } from "../../src/agent/agent"
import { REVIEWER_AGENT } from "../../src/kilocode/agent"
import { KiloSessionPrompt } from "../../src/kilocode/session/prompt"
import { Permission } from "../../src/permission"
import { disposeAllInstances, provideInstance, provideTestInstance, tmpdir } from "../fixture/fixture"

function load<A>(dir: string, fn: (svc: Agent.Interface) => Effect.Effect<A>) {
  return Effect.runPromise(provideInstance(dir)(Agent.Service.use(fn)).pipe(Effect.provide(Agent.defaultLayer)))
}

afterEach(async () => {
  await disposeAllInstances()
})

describe("Reviewer agent", () => {
  test("is hidden, native, and subagent-only", async () => {
    await using tmp = await tmpdir()

    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const reviewer = await load(tmp.path, (svc) => svc.get(REVIEWER_AGENT))

        expect(reviewer).toBeDefined()
        expect(reviewer?.name).toBe(REVIEWER_AGENT)
        expect(reviewer?.displayName).toBe("Reviewer")
        expect(reviewer?.native).toBe(true)
        expect(reviewer?.hidden).toBe(true)
        expect(reviewer?.mode).toBe("subagent")
      },
    })
  })

  test("ignores reserved config while preserving custom reviewer", async () => {
    await using tmp = await tmpdir({
      config: {
        agent: {
          [REVIEWER_AGENT]: {
            disable: true,
            prompt: "weakened reviewer",
            permission: {
              bash: "allow",
              edit: "allow",
              question: "allow",
              task: "allow",
            },
          },
          reviewer: {
            prompt: "custom reviewer",
            mode: "subagent",
            permission: {
              bash: "deny",
            },
          },
        },
      },
    })

    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const reviewer = await load(tmp.path, (svc) => svc.get(REVIEWER_AGENT))
        const custom = await load(tmp.path, (svc) => svc.get("reviewer"))

        expect(reviewer).toBeDefined()
        expect(reviewer?.prompt).toContain("Kilo Reviewer")
        expect(Permission.evaluate("bash", "git commit -m test", reviewer?.permission ?? []).action).toBe("deny")
        expect(Permission.evaluate("edit", "src/file.ts", reviewer?.permission ?? []).action).toBe("deny")
        expect(Permission.evaluate("question", "*", reviewer?.permission ?? []).action).toBe("deny")

        expect(custom).toBeDefined()
        expect(custom?.name).toBe("reviewer")
        expect(custom?.native).toBe(false)
        expect(custom?.prompt).toBe("custom reviewer")
        expect(Permission.evaluate("bash", "ls", custom?.permission ?? []).action).toBe("deny")
      },
    })
  })

  test("allows read-only review tools and only Explore delegation", async () => {
    await using tmp = await tmpdir()

    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const reviewer = await load(tmp.path, (svc) => svc.get(REVIEWER_AGENT))
        const rules = reviewer?.permission ?? []

        expect(Permission.evaluate("read", "src/index.ts", rules).action).toBe("allow")
        expect(Permission.evaluate("grep", "*", rules).action).toBe("allow")
        expect(Permission.evaluate("glob", "*", rules).action).toBe("allow")
        expect(Permission.evaluate("list", "*", rules).action).toBe("allow")
        expect(Permission.evaluate("skill", "*", rules).action).toBe("allow")
        expect(Permission.evaluate("bash", "git merge-base HEAD main", rules).action).toBe("allow")
        expect(Permission.evaluate("bash", "git show-ref --verify --quiet refs/heads/main", rules).action).toBe("allow")
        expect(Permission.evaluate("bash", "git show-ref --verify --quiet refs/remotes/origin/main", rules).action).toBe(
          "allow",
        )
        expect(Permission.evaluate("bash", "git -c core.quotepath=false diff HEAD", rules).action).toBe("allow")
        expect(Permission.evaluate("bash", "git -c core.quotepath=false diff", rules).action).toBe("allow")
        expect(Permission.evaluate("bash", "git ls-files --others --exclude-standard", rules).action).toBe("allow")
        expect(Permission.evaluate("bash", "git log origin/main..HEAD --oneline", rules).action).toBe("allow")
        expect(Permission.evaluate("bash", "git rev-parse --abbrev-ref HEAD", rules).action).toBe("allow")
        expect(Permission.evaluate("bash", "git status --short", rules).action).toBe("allow")
        expect(Permission.evaluate("bash", "test -L src/index.ts", rules).action).toBe("allow")
        expect(Permission.evaluate("bash", "readlink src/link", rules).action).toBe("allow")
        expect(Permission.evaluate("bash", "gh pr view 123", rules).action).toBe("allow")
        expect(Permission.evaluate("bash", "gh pr diff 123", rules).action).toBe("allow")

        expect(Permission.evaluate("bash", "cat .env", rules).action).toBe("deny")
        expect(Permission.evaluate("bash", "printenv PATH", rules).action).toBe("deny")
        expect(Permission.evaluate("bash", "grep secret .env", rules).action).toBe("deny")
        expect(Permission.evaluate("bash", "git commit -m test", rules).action).toBe("deny")
        expect(Permission.evaluate("bash", "git diff --output=out.patch HEAD", rules).action).toBe("deny")
        expect(Permission.evaluate("bash", "git show --output=out.patch HEAD", rules).action).toBe("deny")
        expect(Permission.evaluate("bash", "git show HEAD:.env", rules).action).toBe("deny")
        expect(Permission.evaluate("bash", "git log -p -- .env", rules).action).toBe("deny")
        expect(Permission.evaluate("bash", "git -c core.quotepath=false diff HEAD --output=out.patch", rules).action).toBe(
          "deny",
        )
        expect(Permission.evaluate("bash", "git -c core.quotepath=false diff HEAD --ext-diff", rules).action).toBe(
          "deny",
        )
        expect(Permission.evaluate("edit", "src/index.ts", rules).action).toBe("deny")
        expect(Permission.evaluate("question", "*", rules).action).toBe("deny")

        expect(Permission.evaluate("task", "explore", rules).action).toBe("allow")
        expect(Permission.evaluate("task", "general", rules).action).toBe("deny")
        expect(Permission.evaluate("task", REVIEWER_AGENT, rules).action).toBe("deny")
        expect(Permission.disabled(["task"], rules).has("task")).toBe(false)
      },
    })
  })

  test("honors user restrictions without broadening Reviewer", async () => {
    await using tmp = await tmpdir({
      config: {
        permission: {
          "*": "allow",
          bash: "allow",
          read: "allow",
          edit: "allow",
          question: "allow",
          suggest: "allow",
          task: "allow",
          webfetch: "deny",
          skill: "ask",
          external_directory: {
            "*": "deny",
            "/tmp/review-cache": "allow",
          },
        },
      },
    })

    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const reviewer = await load(tmp.path, (svc) => svc.get(REVIEWER_AGENT))
        const rules = reviewer?.permission ?? []

        expect(Permission.evaluate("webfetch", "*", rules).action).toBe("deny")
        expect(Permission.evaluate("skill", "*", rules).action).toBe("ask")
        expect(Permission.evaluate("read", "src/index.ts", rules).action).toBe("allow")
        expect(Permission.evaluate("read", ".env", rules).action).toBe("ask")
        expect(Permission.evaluate("read", ".env.local", rules).action).toBe("ask")
        expect(Permission.evaluate("read", ".env.example", rules).action).toBe("allow")
        expect(Permission.evaluate("external_directory", "/tmp/private", rules).action).toBe("deny")
        expect(Permission.evaluate("external_directory", "/tmp/review-cache", rules).action).toBe("deny")

        expect(Permission.evaluate("bash", "git commit -m test", rules).action).toBe("deny")
        expect(Permission.evaluate("edit", "src/index.ts", rules).action).toBe("deny")
        expect(Permission.evaluate("question", "*", rules).action).toBe("deny")
        expect(Permission.evaluate("suggest", "*", rules).action).toBe("deny")
        expect(Permission.evaluate("task", "general", rules).action).toBe("deny")
        expect(Permission.evaluate("task", "explore", rules).action).toBe("allow")
      },
    })
  })

  test("hard permission guard preserves Reviewer denies after session allows", async () => {
    await using tmp = await tmpdir()

    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const reviewer = await load(tmp.path, (svc) => svc.get(REVIEWER_AGENT))
        const rules = KiloSessionPrompt.guardPermissions({
          agent: reviewer,
          session: {
            permission: [
              { permission: "edit", pattern: "*", action: "allow" },
              { permission: "question", pattern: "*", action: "allow" },
              { permission: "task", pattern: "*", action: "allow" },
            ],
          },
        })
        const hard = KiloSessionPrompt.hardPermissions({ agent: reviewer }) ?? []

        expect(Permission.evaluate("edit", "src/index.ts", rules).action).toBe("deny")
        expect(Permission.evaluate("question", "*", rules).action).toBe("deny")
        expect(Permission.evaluate("task", "general", rules).action).toBe("deny")
        expect(Permission.evaluate("task", "explore", rules).action).toBe("allow")
        expect(Permission.evaluate("edit", "src/index.ts", hard).action).toBe("deny")
        expect(Permission.evaluate("task", "general", hard).action).toBe("deny")
      },
    })
  })
})
