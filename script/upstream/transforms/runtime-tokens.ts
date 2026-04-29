#!/usr/bin/env bun

import { debug } from "../utils/logger"

export interface TokenReplacement {
  pattern: RegExp
  replacement: string
  description: string
}

export const RUNTIME_TOKEN_REPLACEMENTS: TokenReplacement[] = [
  {
    pattern: /\bFlag\.OPENCODE_/g,
    replacement: "Flag.KILO_",
    description: "Flag runtime token",
  },
  {
    pattern: /\bOPENCODE_(?!API_KEY\b)/g,
    replacement: "KILO_",
    description: "Environment variable prefix",
  },
  {
    pattern: /\bx-opencode-directory\b/g,
    replacement: "x-kilo-directory",
    description: "Instance directory header",
  },
]

export function applyRuntimeTokenTransforms(
  content: string,
  verbose = false,
): { result: string; replacements: number } {
  const data = content.split("\n").reduce(
    (state, line) => {
      const token = RUNTIME_TOKEN_REPLACEMENTS.reduce(
        (next, item) => {
          item.pattern.lastIndex = 0
          if (!item.pattern.test(next.result)) return next

          item.pattern.lastIndex = 0
          const before = next.result
          const result = next.result.replace(item.pattern, item.replacement)

          if (before === result) return next
          if (verbose) debug(`  ${item.description}: "${before.trim()}" -> "${result.trim()}"`)

          return { result, replacements: next.replacements + 1 }
        },
        { result: line, replacements: 0 },
      )

      state.lines.push(token.result)
      return { lines: state.lines, replacements: state.replacements + token.replacements }
    },
    { lines: [] as string[], replacements: 0 },
  )

  return { result: data.lines.join("\n"), replacements: data.replacements }
}
