// kilocode_change - new file

/**
 * Guards the declared scope of the headless Kilo CLI passes: the committed
 * policy exists and is what the scripts and the workflow pass, the gateway
 * credentials sit on the steps that call the CLI, and the checkout keeps no
 * credential on disk.
 *
 * Run: node .github/docs-sync/agent-policy.test.mjs
 */

import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "..", "..")
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8")

const { MODE, configContent, policy } = await import("./agent-policy.mjs")

const workflow = read(".github/workflows/docs-sync.yml")

const failures = []
function check(label, fn) {
  try {
    fn()
    console.log(`ok - ${label}`)
  } catch (err) {
    failures.push(`${label}: ${err.message}`)
    console.error(`not ok - ${label}: ${err.message}`)
  }
}

/** The `sync` job block only: the selftest job must stay out of these checks. */
function syncJob() {
  const start = workflow.indexOf("\n  sync:\n")
  assert.ok(start >= 0, "sync job not found")
  return workflow.slice(start)
}

/** One step block, from its `- name:` line to the next step. */
function step(name) {
  const blocks = syncJob().split("\n      - name: ")
  const block = blocks.find((b) => b.startsWith(name))
  assert.ok(block, `step "${name}" not found`)
  return block.split("\n      - name: ")[0]
}

// 1. The policy is data a reviewer can read, with one mode per call site.
check("agent-permissions.json declares both modes", () => {
  const modes = policy().modes
  assert.deepEqual(Object.keys(modes).sort(), ["docs-write", "tools-denied"])
})

check("tools-denied denies every tool", () => {
  const permission = policy().modes["tools-denied"].permission
  assert.equal(permission["*"], "deny", "tools-denied must deny everything")
})

check("docs-write confines edits to the docs content and the agent summary file", () => {
  const edit = policy().modes["docs-write"].permission.edit
  const keys = Object.keys(edit)
  assert.equal(keys[0], "*", "the catch-all must come first: permission evaluation takes the last matching rule")
  assert.equal(edit["*"], "deny")
  const allowed = keys.filter((k) => edit[k] === "allow")
  assert.deepEqual(
    allowed,
    ["packages/kilo-docs/pages/*", "packages/kilo-docs/lib/nav/*", "docs-sync-out/edit-summary-*.json", "edit-summary-*.json"],
    "only docs pages, navigation files and the agent's own summary file may be written",
  )
  assert.ok(!allowed.includes("packages/kilo-docs/*"), "the package root must stay out: it holds the build and test definitions")
})

check("docs-write denies every tool it does not name", () => {
  const permission = policy().modes["docs-write"].permission
  assert.equal(Object.keys(permission)[0], "*", "the catch-all must come first")
  assert.equal(permission["*"], "deny")
})

check("both modes allow read, which the CLI uses for a -f attachment", () => {
  for (const mode of ["tools-denied", "docs-write"]) {
    assert.equal(policy().modes[mode].permission.read, "allow", `${mode} must allow read`)
  }
})

check("docs-write denies bash by default and allows no interpreter", () => {
  const bash = policy().modes["docs-write"].permission.bash
  assert.equal(Object.keys(bash)[0], "*", "the catch-all must come first")
  assert.equal(bash["*"], "deny")
  for (const cmd of ["python3", "python", "node", "bun", "sh", "bash", "env", "docker"]) {
    const rule = Object.entries(bash).find(([pattern]) => pattern === `${cmd} *` || pattern === cmd)
    assert.ok(!rule || rule[1] !== "allow", `${cmd} must not be allowed`)
  }
})

check("docs-write denies git", () => {
  const bash = policy().modes["docs-write"].permission.bash
  assert.equal(bash["git *"], "deny", "git must be denied for the agent")
})

check("docs-write denies the operator blocklist after the allows", () => {
  const bash = policy().modes["docs-write"].permission.bash
  const keys = Object.keys(bash)
  for (const operator of ["*>*", "*$(*", "*`*", "*<(*"]) {
    assert.ok(keys.includes(operator), `operator rule ${operator} missing`)
    assert.equal(bash[operator], "deny")
    const firstAllow = keys.findIndex((k) => bash[k] === "allow")
    assert.ok(keys.indexOf(operator) > firstAllow, `${operator} must come after the allows (last match wins)`)
  }
})

check("docs-write keeps the docs build and test commands", () => {
  const bash = policy().modes["docs-write"].permission.bash
  for (const cmd of ["bun run --filter @kilocode/kilo-docs build", "bun run --filter @kilocode/kilo-docs test"]) {
    assert.equal(bash[cmd], "allow", `${cmd} must be allowed`)
  }
})

// 2. The exported config is what the CLI reads, and it preserves a caller's
//    provider settings instead of replacing them.
check("configContent returns the mode's permission map as JSON", () => {
  const cfg = JSON.parse(configContent(MODE.docsWrite, undefined))
  assert.deepEqual(cfg.permission, policy().modes["docs-write"].permission)
})

check("configContent merges over an existing KILO_CONFIG_CONTENT", () => {
  const base = JSON.stringify({ provider: { test: { npm: "@ai-sdk/openai-compatible" } } })
  const cfg = JSON.parse(configContent(MODE.toolsDenied, base))
  assert.ok(cfg.provider.test, "existing provider config must survive")
  assert.deepEqual(cfg.permission, { ...policy().modes["tools-denied"].permission })
})

check("configContent rejects an unknown mode", () => {
  assert.throws(() => configContent("nope"), /unknown agent policy mode/)
})

// 3. Every kilo call site names a mode, and none passes --auto.
check("runKilo requires a mode", () => {
  assert.match(read(".github/docs-sync/lib.mjs"), /if \(!mode\) throw new Error\(`runKilo: mode is required/)
})

for (const file of ["triage.mjs", "edit.mjs", "learn.mjs"]) {
  check(`${file} names its policy mode`, () => {
    assert.match(read(`.github/docs-sync/${file}`), /mode: MODE\.(docsWrite|toolsDenied)/)
  })
  check(`${file} never passes --auto`, () => {
    const src = read(`.github/docs-sync/${file}`)
    assert.ok(!/"--auto"/.test(src), `${file} must not pass --auto`)
  })
}

check("the fix step runs kilo without --auto and with the policy", () => {
  const block = step("Fix verify failures")
  assert.ok(block.includes("agent-policy.mjs docs-write"), "fix step must export the docs-write policy")
  assert.ok(!/\s--auto\b/.test(block), "fix step must not pass --auto")
})

// 4. Gateway credentials live on the steps that call the CLI, nowhere else.
const agentSteps = ["Learn from maintainer corrections", "Triage merged PRs", "Update docs", "Fix verify failures"]
const agentKeys = ["KILO_API_KEY", "KILO_ORG_ID"]

check("no gateway secret sits at job level", () => {
  const job = syncJob()
  const header = job.slice(0, job.indexOf("\n    steps:"))
  for (const key of agentKeys) assert.ok(!new RegExp(`^\\s+${key}:`, "m").test(header), `${key} must not be job-level`)
})

for (const name of agentSteps) {
  check(`step "${name}" carries the gateway credentials it calls with`, () => {
    const block = step(name)
    for (const key of agentKeys) assert.ok(block.includes(key + ": ${{ secrets." + key + " }}"), `${name} must set ${key}`)
  })
}

check("no non-agent step carries a gateway credential", () => {
  const blocks = syncJob().split("\n      - name: ")
  for (const block of blocks) {
    const name = block.split("\n")[0]
    if (!name || agentSteps.some((n) => name.startsWith(n))) continue
    for (const key of agentKeys) assert.ok(!block.includes(key), `step "${name}" must not carry ${key}`)
  }
})

check("the docs build secret stays out of the agent step", () => {
  const block = step("Fix verify failures")
  assert.ok(!block.includes("POSTHOG_API_KEY"), "the agent step must not hold the docs build secret")
  assert.ok(step("Re-verify docs after the fix pass").includes("POSTHOG_API_KEY"), "the rebuild step keeps it")
})

// 5. No git credential is left in the worktree, and the steps that push carry
//    the token only in their own environment.
check("the checkout does not persist credentials", () => {
  const block = step("Checkout repository")
  assert.match(block, /persist-credentials: false/, "checkout must not persist the token")
})

for (const name of ["Learn from maintainer corrections", "Prepare rolling branch", "Upsert rolling PR"]) {
  check(`step "${name}" authenticates git from its own environment`, () => {
    const block = step(name)
    assert.ok(block.includes("GH_TOKEN: ${{ github.token }}"), `${name} needs the token for its git calls`)
    assert.ok(
      block.includes("GIT_CONFIG_VALUE_0: ${{ runner.temp }}/docs-sync-credential.sh"),
      `${name} must use the env credential helper`,
    )
  })
}

check("the helper step writes the credential helper outside the worktree", () => {
  const block = step("Install git credential helper")
  assert.ok(block.includes('"$RUNNER_TEMP/docs-sync-credential.sh"'), "helper must live in RUNNER_TEMP")
  assert.ok(!/git config/.test(block), "helper install must not touch git config")
})

check("the helper reads the token from the calling step's environment", () => {
  const block = step("Install git credential helper")
  assert.match(block, /test -n "\$GH_TOKEN" \|\| exit 0/, "the helper must fail closed without a token")
  assert.match(block, /printf 'username=x-access-token\\npassword=%s\\n' "\$GH_TOKEN"/, "the helper must supply the token")
})

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`)
  process.exit(1)
}
console.log("\nagent-policy: all checks passed")
