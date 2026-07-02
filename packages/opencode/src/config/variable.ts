export * as ConfigVariable from "./variable"

import path from "path"
import os from "os"
import { Filesystem } from "@/util/filesystem"
import { InvalidError } from "./error"
import { ConfigVariableGuard } from "@/kilocode/config/variable" // kilocode_change

export type FileScope = ConfigVariableGuard.FileScope // kilocode_change

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

type SubstituteInput = ParseSource & {
  text: string
  missing?: "error" | "empty"
  escapeJson?: boolean // kilocode_change
  env?: Record<string, string>
  fileScope?: ConfigVariableGuard.FileScope // kilocode_change
}

function source(input: ParseSource) {
  return input.type === "path" ? input.path : input.source
}

function dir(input: ParseSource) {
  return input.type === "path" ? path.dirname(input.path) : input.dir
}

/** Apply {env:VAR} and {file:path} substitutions to config text. */
export async function substitute(input: SubstituteInput) {
  const missing = input.missing ?? "error"
  const escape = input.escapeJson ?? true // kilocode_change
  let text = input.text.replace(/\{env:([^}]+)\}/g, (_, varName) => {
    // kilocode_change start - reject server credentials instead of silently changing config semantics
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

    const lineStart = text.lastIndexOf("\n", index - 1) + 1
    const prefix = text.slice(lineStart, index).trimStart()
    if (prefix.startsWith("//")) {
      out += token
      cursor = index + token.length
      continue
    }

    let filePath = token.replace(/^\{file:/, "").replace(/\}$/, "")
    if (filePath.startsWith("~/")) {
      filePath = path.join(os.homedir(), filePath.slice(2))
    }

    const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(configDir, filePath)
    // kilocode_change start - validate and read one opened file to prevent credential substitution races
    const fileContent = (
      await ConfigVariableGuard.read(resolvedPath, Filesystem.readText, input.fileScope && { ...input.fileScope, token }).catch(
        (error: NodeJS.ErrnoException) => {
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
