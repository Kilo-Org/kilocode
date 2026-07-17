export * as ConfigVariable from "./variable"

import path from "path"
import os from "os"
import { InvalidError } from "@opencode-ai/core/v1/config/error"
import { ConfigVariableGuard } from "@/kilocode/config/variable" // kilocode_change

type ParseSource =
  | {
      type: "path"
      path: string
    }
  | {
      type: "virtual"
      source: string
      dir: string
    }

// kilocode_change start
export type FileScope = ConfigVariableGuard.FileScope
// kilocode_change end

type SubstituteInput = ParseSource & {
  text: string
  missing?: "error" | "empty"
  escapeJson?: boolean // kilocode_change
  // kilocode_change start - trust gates {env:}; untrusted project config may only read files inside fileScope.root
  trusted?: boolean
  fileScope?: ConfigVariableGuard.FileScope
  // kilocode_change end
  env?: Record<string, string>
}

function source(input: ParseSource) {
  return input.type === "path" ? input.path : input.source
}

function dir(input: ParseSource) {
  return input.type === "path" ? path.dirname(input.path) : input.dir
}

// kilocode_change start - a token is inert when its line is commented out with //
function commented(text: string, index: number) {
  const lineStart = text.lastIndexOf("\n", index - 1) + 1
  return text.slice(lineStart, index).trimStart().startsWith("//")
}
// kilocode_change end

/** Apply {env:VAR} and {file:path} substitutions to config text. */
export async function substitute(input: SubstituteInput) {
  const missing = input.missing ?? "error"
  const escape = input.escapeJson ?? true // kilocode_change
  // kilocode_change start - untrusted (project) config cannot read files without a scope. {file:} needs a
  // fileScope to be bounded to the project root; {env:} is allowed — sensitive vars (KILO_SERVER_PASSWORD,
  // KILO_SERVER_USERNAME) are blocked by ConfigVariableGuard.env() during substitution below.
  const trusted = input.trusted ?? false
  if (!trusted && !input.fileScope) {
    const file = Array.from(input.text.matchAll(/\{file:[^}]+\}/g)).find((m) => !commented(input.text, m.index))
    if (file) {
      throw new InvalidError({
        path: source(input),
        message: `file references cannot be resolved without a project scope: "${file[0]}"`,
      })
    }
  }
  // kilocode_change end
  let text = input.text.replace(/\{env:([^}]+)\}/g, (match, varName, offset: number) => {
    // kilocode_change start - leave commented tokens literal; reject server credentials
    if (commented(input.text, offset)) return match
    if (!ConfigVariableGuard.env(varName)) {
      throw new InvalidError({ path: source(input), message: `blocked environment reference: "{env:${varName}}"` })
    }
    // kilocode_change end
    return (input.env?.[varName] ?? process.env[varName]) || ""
  })

  const fileMatches = Array.from(text.matchAll(/\{file:[^}]+\}/g))
  if (!fileMatches.length) return text

  const configDir = dir(input)
  const configSource = source(input)
  let out = ""
  let cursor = 0

  for (const match of fileMatches) {
    const token = match[0]
    const index = match.index
    out += text.slice(cursor, index)

    // kilocode_change start - skip tokens on commented-out lines
    if (commented(text, index)) {
      out += token
      cursor = index + token.length
      continue
    }
    // kilocode_change end

    let filePath = token.replace(/^\{file:/, "").replace(/\}$/, "")
    if (filePath.startsWith("~/")) {
      filePath = path.join(os.homedir(), filePath.slice(2))
    }

    const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(configDir, filePath)
    // kilocode_change start - validate and read one opened file to prevent credential substitution races;
    // untrusted config passes a fileScope so reads are confined to the project root.
    const fileContent = (
      await ConfigVariableGuard.read(resolvedPath, input.fileScope && { ...input.fileScope, token }).catch(
        (error: NodeJS.ErrnoException) => {
          // kilocode_change - a deliberate scope block must always reject; only genuine missing/IO errors are
          // emptied under missing:"empty", so an out-of-scope {file:} surfaces instead of being silently dropped.
          if (ConfigVariableGuard.isBlocked(error)) {
            throw new InvalidError({ path: configSource, message: error.message }, { cause: error })
          }
          if (missing === "empty") return ""

          const errMsg = `bad file reference: "${token}"`
          if (error.code === "ENOENT") {
            throw new InvalidError(
              {
                path: configSource,
                message: errMsg + ` ${resolvedPath} does not exist`,
              },
              { cause: error },
            )
          }
          throw new InvalidError({ path: configSource, message: errMsg }, { cause: error })
        },
      )
    ).trim()
    // kilocode_change end

    out += escape ? JSON.stringify(fileContent).slice(1, -1) : fileContent // kilocode_change
    cursor = index + token.length
  }

  out += text.slice(cursor)
  return out
}
