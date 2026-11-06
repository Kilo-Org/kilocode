// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import { SecurityDecisionAdapter } from "@/kilocode/security-decision/adapter"

/**
 * Adversarial cases for the inert allowlist.
 *
 * `inert` has to mean "we can prove this is low risk here", not "the verb sounded read-only". git in
 * particular reads file contents, redirects its own repository and executes configured programs, all
 * under verbs that look harmless, so the allowlist is over verb *and* argument combinations.
 */

const ctx: SecurityDecisionAdapter.Context = {
  workspace: "/w",
  effective: "allow",
  humanOnly: false,
  floor: { action: "allow", authority: "untrusted", conflict: false },
  containment: { sandbox: "unknown", network: "allow", destinations: [], escalated: false },
}

const shell = (command: string, effects: Array<{ operation: string; path?: string }> = []) => {
  const argv = command.split(/\s+/)
  return SecurityDecisionAdapter.evaluate(
    {
      permission: "bash",
      patterns: [command],
      metadata: {
        securityFacts: { complete: true, composed: false, executable: argv[0], argv, effects, classified: false },
      },
      sessionID: "ses_inert",
    },
    ctx,
  )
}

const asks = (command: string) => {
  const out = shell(command)
  expect({ command, rule: out.rule_id, decision: out.decision }).toEqual({
    command,
    rule: "SEC.V1.UNCLASSIFIED_EXEC",
    decision: "ask",
  })
  // kilocode_change - an unknown command is never handed to a reviewer: there is nothing to judge.
  expect(out.reviewable).toBe(false)
}

/** The argument itself is the sensitive thing, so the path rule names the ask rather than the exec one. */
const asksSensitive = (command: string) => {
  const out = shell(command)
  expect({ command, rule: out.rule_id, decision: out.decision }).toEqual({
    command,
    rule: "SEC.V1.SENSITIVE_BOUNDARY",
    decision: "ask",
  })
  expect(out.reviewable).toBe(false)
}

const passes = (command: string) => {
  const out = shell(command)
  expect({ command, rule: out.rule_id, decision: out.decision }).toEqual({
    command,
    rule: "SEC.V1.NO_OPINION",
    decision: "pass",
  })
}

describe("git cannot be used to read content that a direct read would ask for", () => {
  test.each([
    ["git show HEAD:.env"],
    ["git show :0:.env"],
    ["git show HEAD"],
    ["git diff"],
    ["git blame src/a.ts"],
    ["git log -p"],
    ["git log -u"],
    ["git log --patch"],
    ["git log -G secret"],
    ["git log -S secret"],
  ])("%s asks", (command) => asks(command))

  // kilocode_change - the value of a path-valued option is a path: `--output=/tmp/x` names a file
  // outside the workspace exactly as `-C /outside` does, so it reaches the same boundary rule.
  test("git diff --stat --output=/tmp/x asks on the path the option carries", () =>
    asksSensitive("git diff --stat --output=/tmp/x"))

  test.each([["git diff -- .env"], ["git blame .env"], ["git log -p -- .env"]])(
    "%s asks on the path itself",
    (command) => asksSensitive(command),
  )

  test("the direct route asks too, so the two agree", () => {
    const read = SecurityDecisionAdapter.evaluate(
      { permission: "read", patterns: [".env"], metadata: {}, sessionID: "ses_inert" },
      ctx,
    )
    expect(read.decision).toBe("ask")
    expect(shell("git show HEAD:.env").decision).toBe("ask")
  })
})

describe("git flags that move or reprogram the operation are never inert", () => {
  test.each([
    ["git -c core.pager=curl status"],
    ["git -c diff.external=/tmp/x status"],
    ["git --namespace=x status"],
    ["git -P status"],
  ])("%s asks", (command) => asks(command))

  // kilocode_change - same refusal, reached through the option's value rather than through the verb:
  // the path a redirecting flag carries is a path in its own right
  test.each([
    ["git --git-dir=/elsewhere/.git status"],
    ["git --work-tree=/outside status"],
    ["git --exec-path=/tmp status"],
  ])("%s asks on the redirected path itself", (command) => asksSensitive(command))

  test("a redirected working directory is an out-of-workspace path in its own right", () =>
    asksSensitive("git -C /outside status"))
})

describe("unknown or content-bearing arguments fail closed", () => {
  test.each([
    ["git status --unknown-flag"],
    ["git status --ext-diff"],
    ["git rev-parse --unknown"],
    ["git ls-files --textconv"],
    ["git"],
    ["git st"],
  ])("%s asks", (command) => asks(command))
})

describe("the provable dev flow still passes", () => {
  test.each([
    ["git status"],
    ["git status -s"],
    ["git status -sb"],
    ["git status --short --branch"],
    ["git status --porcelain"],
    ["git status --porcelain=v2"],
    ["git status -uno"],
    ["git status -- src"],
    ["git --no-pager status"],
    ["git rev-parse HEAD"],
    ["git rev-parse --show-toplevel"],
    ["git rev-parse --abbrev-ref HEAD"],
    ["git ls-files"],
    ["git ls-files --others --exclude-standard"],
    ["git ls-files -z"],
  ])("%s passes", (command) => passes(command))
})

/**
 * History and branch names are metadata, not file contents: `git log` prints commit messages and
 * `--stat`-family output prints names and counts. The content-bearing flags of the same verbs
 * (`-p`, `-G`, `-S`) stay outside the allowlist. `diff` requires a name-only flag; `show` is never
 * inert because its object syntax can still address a sensitive blob alongside metadata flags.
 */
describe("history and name-only reporting passes", () => {
  test.each([
    ["git log"],
    ["git log --oneline"],
    ["git log --oneline -20"],
    ["git log -n 5"],
    ["git log --stat"],
    ["git log --name-only"],
    ["git log --pretty=format:%h"],
    ["git log --graph --decorate --oneline"],
    ["git log -- src"],
    ["git diff --stat"],
    ["git diff --name-only"],
    ["git diff --name-status HEAD"],
    ["git branch"],
    ["git branch -a"],
    ["git branch --list"],
    ["git --no-pager log --oneline"],
  ])("%s passes", (command) => passes(command))

  test.each([
    ["git show HEAD"],
    ["git show"],
    ["git show --stat HEAD"],
    ["git show --name-only HEAD"],
    ["git show --stat"],
    ["git show --stat HEAD:.env"],
    ["git show --name-only HEAD:.env"],
    ["git log --ext-diff"],
  ])("%s asks", (command) => asks(command))

  // kilocode_change - `--output=` carries a path, so these two land on the boundary rule instead
  test.each([["git status --output=/tmp/x"], ["git log --output=/tmp/x"]])(
    "%s asks on the path the option carries",
    (command) => asksSensitive(command),
  )
})

/**
 * Confinement is evidence about *reach* — writes and network — and the command's own output still
 * flows back to the model. So it cannot stand in for an allowlist the layer already applied and
 * refused: a git invocation that failed the verb/argument check is a known negative, not an unknown
 * command, and letting containment re-admit it would reopen the exact route this file closes.
 */
describe("containment does not re-admit a refused git invocation", () => {
  const confined: SecurityDecisionAdapter.Context = {
    ...ctx,
    containment: { sandbox: "operational", network: "deny", destinations: [], escalated: false },
  }

  const inConfinement = (command: string) => {
    const argv = command.split(/\s+/)
    return SecurityDecisionAdapter.evaluate(
      {
        permission: "bash",
        patterns: [command],
        metadata: {
          securityFacts: { complete: true, composed: false, executable: argv[0], argv, effects: [], classified: false },
        },
        sessionID: "ses_inert",
      },
      confined,
    )
  }

  test.each([["git show HEAD:.env"], ["git log -p"], ["git diff"]])(
    "%s still asks inside a proven sandbox",
    (command) => {
      const out = inConfinement(command)
      expect({ command, rule: out.rule_id, decision: out.decision }).toEqual({
        command,
        rule: "SEC.V1.UNCLASSIFIED_EXEC",
        decision: "ask",
      })
    },
  )

  // kilocode_change - a redirected repository is a path outside the workspace, and confinement does
  // not make an out-of-workspace target an in-workspace one
  test("git --git-dir=/elsewhere/.git status still asks inside a proven sandbox", () => {
    const out = inConfinement("git --git-dir=/elsewhere/.git status")
    expect(out.rule_id).toBe("SEC.V1.SENSITIVE_BOUNDARY")
    expect(out.decision).toBe("ask")
    expect(out.reviewable).toBe(false)
  })

  test.each([["git config core.hooksPath ./hooks"], ["git push --force"]])(
    "%s stays a deterministic boundary inside a proven sandbox",
    (command) => {
      const out = inConfinement(command)
      expect(out.decision).toBe("ask")
      expect(out.reviewable).toBe(false)
      expect(out.rule_id).not.toBe("SEC.V1.CONTAINED_EXEC")
    },
  )

  test("a git invocation the allowlist accepts still passes", () => {
    expect(inConfinement("git status").rule_id).toBe("SEC.V1.NO_OPINION")
  })

  test("a command the layer has no allowlist for is still contained evidence", () => {
    expect(inConfinement("npm test").rule_id).toBe("SEC.V1.CONTAINED_EXEC")
  })
})

describe("deterministic path rules still outrank the inert allowlist", () => {
  test("an inert command writing a git hook is still denied", () => {
    const out = shell("git status > .git/hooks/pre-commit", [{ operation: "update", path: "/w/.git/hooks/pre-commit" }])
    expect(out.rule_id).toBe("SEC.V1.GIT_HOOK_WRITE")
    expect(out.decision).toBe("deny")
  })

  test("an inert command writing a control-plane file still asks", () => {
    const out = shell("git status > .git/config", [{ operation: "update", path: "/w/.git/config" }])
    expect(out.rule_id).toBe("SEC.V1.CONTROL_PLANE_WRITE")
  })

  test("an inert command discarding output still passes", () => {
    const out = shell("git status > /dev/null", [{ operation: "update", path: "/dev/null" }])
    expect(out.rule_id).toBe("SEC.V1.NO_OPINION")
  })
})

describe("non-git inert commands", () => {
  test.each([["ls -la"], ["pwd"], ["echo hello"], ["which node"], ["basename src/a.ts"], ["true"]])(
    "%s passes",
    (command) => passes(command),
  )

  test.each([["node -e process.exit(0)"], ["sh -c ls"], ["env"], ["printenv"]])("%s asks", (command) => asks(command))
})

/**
 * Git splits three ways, and only the first is autonomous.
 *
 * Names and metadata (`status`, `log`, `ls-files`, `--stat` forms) are already inert. Everything
 * that changes the repository is a deterministic boundary rather than a judgement call, and the
 * verbs that reach a remote hand the work to another machine, which is the same delegation the host
 * control rule names. Content-printing verbs stay where they were: an ask, and never a reviewer's
 * to narrow, because the content they print is exactly what a direct read would ask about.
 */
describe("git that reaches a remote is delegated execution", () => {
  test.each([
    ["git push origin main"],
    ["git push --force"],
    ["git fetch origin"],
    ["git pull"],
    ["git clone https://example.com/x.git"],
    ["git remote add evil https://example.com/x.git"],
    ["git submodule update --init"],
  ])("%s is host control", (command) => {
    const out = shell(command)
    expect({ command, rule: out.rule_id, decision: out.decision, reviewable: out.reviewable }).toEqual({
      command,
      rule: "SEC.V1.HOST_CONTROL",
      decision: "ask",
      reviewable: false,
    })
  })
})

describe("git that changes the repository is a deterministic boundary", () => {
  test.each([
    ["git add -A"],
    ["git commit -m x"],
    ["git stash"],
    ["git checkout -b feature"],
    ["git switch main"],
    ["git restore src/a.ts"],
    ["git reset --hard"],
    ["git clean -fd"],
    ["git rebase main"],
    ["git merge topic"],
    ["git cherry-pick abc"],
    ["git revert abc"],
    ["git tag v1"],
    ["git branch -d topic"],
    ["git branch -D topic"],
    ["git branch -m old new"],
    ["git branch --edit-description"],
    ["git apply patch.diff"],
    ["git config core.hooksPath .githooks"],
  ])("%s is a repository mutation", (command) => {
    const out = shell(command)
    expect({ command, rule: out.rule_id, decision: out.decision, reviewable: out.reviewable }).toEqual({
      command,
      rule: "SEC.V1.REPO_MUTATION",
      decision: "ask",
      reviewable: false,
    })
  })
})

describe("content-printing git is never a reviewer's to narrow", () => {
  test.each([["git diff"], ["git show HEAD"], ["git blame src/a.ts"], ["git log -p"], ["git show HEAD:.env"]])(
    "%s asks without a reviewer",
    (command) => {
      const out = shell(command)
      expect(out.decision).toBe("ask")
      expect(out.reviewable).toBe(false)
    },
  )
})

/**
 * Read-only git that reports counts and names, and nothing else.
 *
 * Each of these is admitted by verb *and* arguments, like the verbs already on the list. `remote -v`
 * stays out: a repository cloned with an embedded token prints it in the URL. `diff`, `show` and
 * `blame` stay out for the reason this whole file exists — they print file contents.
 */
describe("counting and naming git verbs pass", () => {
  test.each([
    ["git stash list"],
    ["git stash list --oneline"],
    ["git describe"],
    ["git describe --tags"],
    ["git describe --tags --always"],
    ["git rev-list --count HEAD"],
    ["git rev-list -n 5 HEAD"],
    ["git tag -l"],
    ["git tag --list"],
    ["git shortlog -sn"],
    ["git count-objects -v"],
    ["git --no-pager tag -l"],
  ])("%s passes", (command) => passes(command))

  test.each([
    ["git stash"],
    ["git stash pop"],
    ["git stash drop"],
    ["git stash show -p"],
    ["git tag v1"],
    ["git tag -d v1"],
    ["git remote -v"],
    ["git remote"],
    ["git describe --dirty=--broken --exec"],
    ["git rev-list --header HEAD"],
  ])("%s does not", (command) => {
    const out = shell(command)
    expect({ command, decision: out.decision }).toEqual({ command, decision: "ask" })
    expect(out.rule_id).not.toBe("SEC.V1.NO_OPINION")
  })
})
