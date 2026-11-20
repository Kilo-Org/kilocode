// kilocode_change - new file

/**
 * Tool and path scope for the headless Kilo CLI passes.
 *
 * Every pass that runs a model declares its scope here rather than relying on
 * the prompt: each mode in `agent-permissions.json` is one `KILO_CONFIG_CONTENT`
 * value, `lib.mjs` spawns `kilo run` with it, and the workflow's repair step
 * prints it from this module. The CLI enforces the map, so the permitted tools,
 * commands and write paths are the same for a scheduled run and a manual one.
 *
 * Usage: `node .github/docs-sync/agent-policy.mjs <mode>`
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const POLICY_FILE = path.join(HERE, "agent-permissions.json")

/** Modes the scripts pass to `runKilo`. */
export const MODE = {
  /** Classification and extraction: the answer comes from the attached files. */
  toolsDenied: "tools-denied",
  /** Docs editing and the verify-failure repair pass. */
  docsWrite: "docs-write",
}

export function policy() {
  return JSON.parse(fs.readFileSync(POLICY_FILE, "utf8"))
}

/** The action literals a permission rule may take; `null` clears a rule. */
const ACTIONS = new Set(["allow", "deny", "ask"])

/** One accepted rule value: an action literal, or `null`. */
const isAction = (value) => value === null || ACTIONS.has(value)

/**
 * Require every mode to state a usable rule map before it becomes
 * `KILO_CONFIG_CONTENT`: the leading catch-all deny, and an action literal for
 * each rule and pattern. A malformed mode stops the run here, so a run always
 * carries the scope its mode declares.
 */
export function validateMode(mode, entry) {
  const fail = (message) => {
    throw new Error(`agent policy mode ${mode}: ${message}`)
  }
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail("no mode entry")
  const permission = entry.permission
  if (!permission || typeof permission !== "object" || Array.isArray(permission)) {
    fail("permission must be an object of tool rules")
  }
  const keys = Object.keys(permission)
  if (keys.length === 0) fail("permission is empty")
  if (keys[0] !== "*" || permission["*"] !== "deny") {
    fail('the first rule must be "*": "deny", because permission evaluation takes the last matching rule')
  }
  for (const key of keys) {
    const rule = permission[key]
    if (isAction(rule)) continue
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
      fail(`rule ${JSON.stringify(key)} must be allow, deny, ask, null or a map of patterns to one of them`)
    }
    for (const pattern of Object.keys(rule)) {
      if (!isAction(rule[pattern])) {
        fail(`rule ${JSON.stringify(key)} pattern ${JSON.stringify(pattern)} must be allow, deny, ask or null`)
      }
    }
  }
}

/**
 * `KILO_CONFIG_CONTENT` for one mode, merged over the value already in the
 * environment so a caller's own provider or model settings survive. The policy
 * wins where both define a permission key.
 */
export function configContent(mode, base = process.env.KILO_CONFIG_CONTENT) {
  const modes = policy().modes
  const entry = modes[mode]
  if (!entry) throw new Error(`unknown agent policy mode: ${mode} (expected one of ${Object.keys(modes).join(", ")})`)
  validateMode(mode, entry)
  const merged = base ? JSON.parse(base) : {}
  merged.permission = { ...(merged.permission ?? {}), ...entry.permission }
  return JSON.stringify(merged)
}

/** Child environment for a `kilo run` under `mode`. */
export function env(mode, base = process.env) {
  return { ...base, KILO_CONFIG_CONTENT: configContent(mode, base.KILO_CONFIG_CONTENT) }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2]
  if (!mode) {
    console.error(`usage: node ${path.relative(process.cwd(), fileURLToPath(import.meta.url))} <${Object.values(MODE).join("|")}>`)
    process.exit(2)
  }
  process.stdout.write(configContent(mode) + "\n")
}
