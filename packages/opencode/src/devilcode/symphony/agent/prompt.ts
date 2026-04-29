import { SymphonyConfigError } from "../errors"
import type { TrackerIssue } from "../tracker/types"

interface PromptVars {
  issue: TrackerIssue
  attempt: number | null
}

const VAR_PATTERN = /\{\{\s*([\w.]+)\s*\}\}/g

function resolvePath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".")
  let current: unknown = obj
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

export function renderPrompt(template: string, vars: PromptVars): string {
  const context: Record<string, unknown> = {
    issue: vars.issue,
    attempt: vars.attempt,
  }

  return template.replace(VAR_PATTERN, (match, path: string) => {
    const value = resolvePath(context, path)
    if (value === undefined) {
      throw new SymphonyConfigError({
        message: `Unknown template variable: ${path}`,
      })
    }
    if (value === null) return ""
    if (Array.isArray(value)) return value.join(", ")
    return String(value)
  })
}
