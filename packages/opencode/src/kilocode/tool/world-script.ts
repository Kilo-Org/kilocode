import { parseScript, resolvePath } from "@kilocode/world/client"
import type { Action } from "@kilocode/world/types"

export type WorldScript = {
  actions: Action[]
  urls: string[]
  reads: string[]
  writes: string[]
  evaluates: boolean
}

export function inspect(script: string, dir: string): WorldScript {
  const actions = parseScript(script)
  const urls: string[] = []
  const reads: string[] = []
  const writes: string[] = []
  const evaluates = actions.some((action) => action.verb === "evaluate")
  for (const action of actions) {
    if (flag(action, "--session") !== undefined) throw new Error("--session is reserved for Kilo")
    const url = flag(action, "--url")
    if (url && (action.verb === "navigate" || (action.verb === "tabs" && action.args[0] === "open"))) {
      urls.push(url)
    }
    const input = action.verb === "evaluate" ? flag(action, "--js-file") : undefined
    if (input) reads.push(resolvePath(input, dir))
    const output = action.verb === "screenshot" ? flag(action, "--out") : undefined
    if (output) writes.push(resolvePath(output, dir))
  }
  return {
    actions,
    urls: [...new Set(urls)],
    reads: [...new Set(reads)],
    writes: [...new Set(writes)],
    evaluates,
  }
}

function flag(action: Action, name: string): string | undefined {
  for (let i = 0; i < action.args.length; i++) {
    const value = action.args[i]
    if (value === name) return action.args[i + 1]
    if (value?.startsWith(`${name}=`)) return value.slice(name.length + 1)
  }
  return undefined
}
