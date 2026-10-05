// kilocode_change - new file

/**
 * Guards the docs-sync model + reasoning-effort wiring.
 *
 * The bot runs DeepSeek V4.1 Flash at maximum reasoning effort on every LLM
 * call. The id and effort are easy to drift (a hand-edited workflow env, a new
 * `kilo run` call site that forgets `--variant`), so this ordinary unit test
 * asserts the wiring from the source of truth: the workflow env defaults, the
 * shared `REASONING_VARIANT` constant, and every `args` array passed to
 * `runKilo` in triage.mjs, edit.mjs, learn.mjs, plus the workflow's fix step.
 *
 * Run: node .github/docs-sync/model-config.test.mjs
 */

import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "..", "..")
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8")

const MODEL = "kilo/deepseek/deepseek-v4.1-flash"
const MAX = "max"

const workflow = read(".github/workflows/docs-sync.yml")
const lib = read(".github/docs-sync/lib.mjs")

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

/** Every `args: [ ... ]` array literal passed to a `runKilo(` call, as source text. */
function runKiloArgArrays(src) {
  const arrays = []
  const marker = "runKilo("
  let i = src.indexOf(marker)
  while (i !== -1) {
    const argsIdx = src.indexOf("args:", i)
    const start = src.indexOf("[", argsIdx)
    assert.ok(argsIdx !== -1 && start !== -1, "runKilo call without an args array")
    let depth = 0
    let j = start
    for (; j < src.length; j++) {
      if (src[j] === "[") depth++
      else if (src[j] === "]") {
        depth--
        if (depth === 0) break
      }
    }
    arrays.push(src.slice(start, j + 1))
    i = src.indexOf(marker, j)
  }
  return arrays
}

/** The workflow step block whose `- name:` line starts with `prefix`. */
function stepBlock(prefix) {
  const blocks = workflow.split("\n      - name: ")
  return blocks.find((b) => b.startsWith(prefix)) ?? null
}

// 1. Model defaults: DeepSeek 4.1 Flash via the kilo provider, vars. override kept.
for (const [key, varName] of [
  ["TRIAGE_MODEL", "DOCS_SYNC_TRIAGE_MODEL"],
  ["EDIT_MODEL", "DOCS_SYNC_EDIT_MODEL"],
]) {
  check(`${key} defaults to ${MODEL} with a vars.${varName} override`, () => {
    const re = new RegExp(`${key}:\\s*\\$\\{\\{\\s*vars\\.${varName}\\s*\\|\\|\\s*'([^']+)'\\s*\\}\\}`)
    const m = workflow.match(re)
    assert.ok(m, `${key} env line with a vars.${varName} override was not found`)
    assert.equal(m[1], MODEL, `${key} default is ${m[1]}, expected ${MODEL}`)
  })
}

// 2. The effort is overridable but defaults to max.
check(`DOCS_SYNC_VARIANT defaults to "${MAX}"`, () => {
  assert.match(workflow, /^\s*DOCS_SYNC_VARIANT:\s*"max"\s*$/m, 'top-level env DOCS_SYNC_VARIANT is not "max"')
})

// 2b. The comment above it cites where the id and variants come from, so a
//     future id/effort change can be re-verified against the live list.
check("workflow comment cites the Kilo gateway model list", () => {
  assert.match(workflow, /api\.kilo\.ai\/api\/openrouter\/models/, "the model source URL is not cited in the workflow")
})

// 3. One shared constant so all call sites agree.
check("lib.mjs exports REASONING_VARIANT defaulting to max", () => {
  assert.match(
    lib,
    /export const REASONING_VARIANT = process\.env\.DOCS_SYNC_VARIANT \|\| "max"/,
    "REASONING_VARIANT constant not found or not defaulting to max",
  )
})

// 3b. The constant actually resolves to max when the workflow env is absent.
delete process.env.DOCS_SYNC_VARIANT
const { REASONING_VARIANT } = await import("./lib.mjs")
check(`REASONING_VARIANT resolves to "${MAX}" by default`, () => {
  assert.equal(REASONING_VARIANT, MAX)
})

// 4. Every script's `kilo run` argv carries -m and --variant REASONING_VARIANT.
for (const file of ["triage.mjs", "edit.mjs", "learn.mjs"]) {
  const src = read(`.github/docs-sync/${file}`)
  const arrays = runKiloArgArrays(src)

  check(`${file} has at least one runKilo call`, () => {
    assert.ok(arrays.length > 0, "no runKilo call found")
  })

  arrays.forEach((args, index) => {
    check(`${file} runKilo args #${index + 1} pass -m and --variant REASONING_VARIANT`, () => {
      assert.ok(args.includes('"run"'), `argv does not start the run command: ${args}`)
      assert.ok(args.includes('"-m"'), `argv is missing -m: ${args}`)
      assert.ok(args.includes('"--variant"'), `argv is missing --variant: ${args}`)
      assert.ok(args.includes("REASONING_VARIANT"), `argv must pass --variant REASONING_VARIANT: ${args}`)
    })
  })
}

// 5. The deliberate --auto difference is preserved: triage/edit grant bash to the
//    agent; the learnings extraction stays tool-free (learn.mjs:694-697).
for (const file of ["triage.mjs", "edit.mjs"]) {
  check(`${file} keeps --auto`, () => {
    const arrays = runKiloArgArrays(read(`.github/docs-sync/${file}`))
    for (const args of arrays) assert.ok(args.includes('"--auto"'), `argv is missing --auto: ${args}`)
  })
}
check("learn.mjs stays without --auto", () => {
  const arrays = runKiloArgArrays(read(".github/docs-sync/learn.mjs"))
  for (const args of arrays) assert.ok(!args.includes('"--auto"'), `learn.mjs must not pass --auto: ${args}`)
})

// 6. The workflow's fix step passes the same effort as the scripts.
check('workflow fix step passes --variant "$DOCS_SYNC_VARIANT"', () => {
  const block = stepBlock("Fix verify failures")
  assert.ok(block, "Fix verify failures step not found")
  assert.ok(block.includes("kilo run"), "fix step no longer runs `kilo run`")
  assert.ok(block.includes('--variant "$DOCS_SYNC_VARIANT"'), 'fix step is missing --variant "$DOCS_SYNC_VARIANT"')
})

// 7. Every `kilo run` in the workflow lives in a step that also passes --variant.
check("every workflow kilo run passes --variant", () => {
  const runs = workflow.split("\n      - name: ").filter((b) => /(^|\s)kilo run(\s|$)/m.test(b))
  assert.ok(runs.length > 0, "no `kilo run` found in the workflow")
  for (const block of runs) {
    const name = block.split("\n")[0]
    assert.ok(block.includes("--variant"), `step "${name}" runs kilo without --variant`)
  }
})

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`)
  process.exit(1)
}
console.log("\nmodel-config: all checks passed")
