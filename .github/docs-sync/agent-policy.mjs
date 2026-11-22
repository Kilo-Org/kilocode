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

/**
 * The action literals a permission rule may take; `null` clears a rule.
 *
 * `ask` is not one of them. No client is attached to these runs, so an ask
 * would be auto-rejected mid-pass and end the run; a mode has to state its
 * decision up front instead of leaving one to a prompt that nobody answers.
 */
const ACTIONS = new Set(["allow", "deny"])

/** One accepted rule value: an action literal, or `null`. */
const isAction = (value) => value === null || ACTIONS.has(value)

/**
 * Require every mode to state a usable rule map before it becomes
 * `KILO_CONFIG_CONTENT`: the leading catch-all deny, and an allow or deny for
 * each rule and pattern. `ask` is refused here rather than at the first tool
 * call, because a headless run cannot answer one. A malformed mode stops the
 * run here, so a run always carries the scope its mode declares.
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
      fail(`rule ${JSON.stringify(key)} must be allow, deny, null or a map of patterns to one of them`)
    }
    for (const pattern of Object.keys(rule)) {
      if (!isAction(rule[pattern])) {
        fail(`rule ${JSON.stringify(key)} pattern ${JSON.stringify(pattern)} must be allow, deny or null`)
      }
    }
  }
}

/**
 * `KILO_CONFIG_CONTENT` for one mode, merged over the value already in the
 * environment so a caller's own provider or model settings survive. The mode
 * owns `permission` outright: a rule from the base would otherwise land before
 * the catch-all, and evaluation takes the last matching rule.
 */
export function configContent(mode, base = process.env.KILO_CONFIG_CONTENT) {
  const modes = policy().modes
  const entry = modes[mode]
  if (!entry) throw new Error(`unknown agent policy mode: ${mode} (expected one of ${Object.keys(modes).join(", ")})`)
  validateMode(mode, entry)
  const merged = base ? JSON.parse(base) : {}
  merged.permission = { ...entry.permission }
  return JSON.stringify(merged)
}

/**
 * The git credential-helper definition a step sets for its own git calls. The
 * model never needs it, so `env` withholds it instead of handing a repository
 * token to the CLI.
 */
const STEP_ONLY = /^GIT_CONFIG_(?:COUNT|KEY_[0-9]+|VALUE_[0-9]+)$/

/**
 * Credential-shaped names, matched on the name ending: `KEY`, `TOKEN`,
 * `SECRET`, `CREDENTIAL`, `PASSWORD`, `ORG_ID` and `_PAT`. The environment is
 * filtered rather than rebuilt from a keep-list, so a pass keeps the caller's
 * provider and model settings while a step's credential stays with the step.
 * The match is on the ending alone: a name that ends differently is outside
 * this rule and needs its own entry when a step starts setting it.
 */
const SECRET_NAME = /(?:KEY|TOKEN|SECRET|CREDENTIAL|PASSWORD|ORG_ID|_PAT)$/i

/**
 * The credentials the CLI authenticates with, and the only names the shape
 * rule must not remove.
 */
const GATEWAY = new Set(["KILO_API_KEY", "KILO_ORG_ID"])

/**
 * Child environment for a `kilo run` under `mode`.
 *
 * The child receives the caller's environment without the names the two rules
 * above match, so a step's credential and credential-helper definition stay
 * with the step. The gateway credentials stay, because the CLI authenticates
 * with them.
 */
export function env(mode, base = process.env) {
  const child = { ...base }
  for (const name of Object.keys(child)) {
    if (GATEWAY.has(name)) continue
    if (STEP_ONLY.test(name) || SECRET_NAME.test(name)) delete child[name]
  }
  // `?? ""` keeps an explicit base authoritative: a base without the key means
  // "no caller config", never a re-read of the ambient value.
  child.KILO_CONFIG_CONTENT = configContent(mode, child.KILO_CONFIG_CONTENT ?? "")
  return child
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2]
  if (!mode) {
    console.error(`usage: node ${path.relative(process.cwd(), fileURLToPath(import.meta.url))} <${Object.values(MODE).join("|")}>`)
    process.exit(2)
  }
  process.stdout.write(configContent(mode) + "\n")
}
