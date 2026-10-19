export * as ConfigVariable from "./variable.js"

import os from "os"
import path from "path"
import { Effect } from "effect"
import { FSUtil } from "@opencode/util/fs-util"
import { InvalidError } from "../v1/config/error.js"

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
  env?: Record<string, string>
}

/** Apply {env:VAR} and {file:path} substitutions to config text. */
export const substitute = Effect.fn("ConfigVariable.substitute")(function* (input: SubstituteInput) {
  const text = input.text.replace(
    /\{env:([^}]+)\}/g,
    (_, varName: string) => (input.env?.[varName] ?? process.env[varName]) || "",
  )
  if (!text.includes("{file:")) return text
  return yield* substituteFiles(input, text)
})

const substituteFiles = Effect.fnUntraced(function* (input: SubstituteInput, text: string) {
  const fs = yield* FSUtil.Service
  const configDir = input.type === "path" ? path.dirname(input.path) : input.dir
  const configSource = input.type === "path" ? input.path : input.source
  let out = ""
  let cursor = 0

  for (const match of text.matchAll(/\{file:[^}]+\}/g)) {
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

    const filePath = token.slice("{file:".length, -1)
    const expandedPath = filePath.startsWith("~/") ? path.join(os.homedir(), filePath.slice(2)) : filePath
    const resolvedPath = path.isAbsolute(expandedPath) ? expandedPath : path.resolve(configDir, expandedPath)
    const fileContent = yield* fs
      .readFileStringSafe(resolvedPath)
      .pipe(
        Effect.mapError(
          (error) =>
            new InvalidError({ path: configSource, message: `bad file reference: "${token}"` }, { cause: error }),
        ),
      )
    // Like a missing {env:VAR}, a missing or unreadable file substitutes empty so one stale secret
    // reference cannot take down every Location that loads this config.
    if (fileContent === undefined)
      yield* Effect.logWarning("config file reference is missing or unreadable", {
        source: configSource,
        reference: token,
        path: resolvedPath,
      })

    out += JSON.stringify((fileContent ?? "").trim()).slice(1, -1)
    cursor = index + token.length
  }

  return out + text.slice(cursor)
})
