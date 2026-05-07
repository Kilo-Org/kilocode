/**
 * Message contract consistency tests.
 *
 * These tests verify that:
 * 1. Every message type named in ExtensionMessage has a corresponding interface/type definition
 * 2. Every WebviewMessage type handled in KiloProvider has a corresponding member in the WebviewMessage union
 * 3. The message types used by mapSSEEventToWebviewMessage exist in ExtensionMessage
 *
 * These are static analysis tests - they read source files and check consistency.
 */

import { describe, it, expect } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "../..")
const MESSAGES_DIR = path.join(ROOT, "webview-ui/src/types/messages")
const EXTENSION_MESSAGES_FILE = path.join(MESSAGES_DIR, "extension-messages.ts")
const WEBVIEW_MESSAGES_FILE = path.join(MESSAGES_DIR, "webview-messages.ts")
const KILO_PROVIDER_FILE = path.join(ROOT, "src/KiloProvider.ts")
const KILO_PROVIDER_UTILS_FILE = path.join(ROOT, "src/kilo-provider-utils.ts")
// Some wire types (partUpdated, partsUpdated) live in a file shared by the
// extension and webview; the contract checks must include it.
const SHARED_STREAM_MESSAGES_FILE = path.join(ROOT, "src/shared/stream-messages.ts")

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8")
}

function readMessagesDir(): string {
  return fs
    .readdirSync(MESSAGES_DIR)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => readFile(path.join(MESSAGES_DIR, f)))
    .join("\n")
}

function readMessageTypeSources(): string {
  return readMessagesDir() + "\n" + readFile(SHARED_STREAM_MESSAGES_FILE)
}

/**
 * Extract the named union's member names from a single source file.
 *
 * Reads each `  | MemberName` line after `export type Name =`, skipping
 * blank lines and `//` comments, and stops at the first other line.
 */
function extractUnionMembers(src: string, name: string): string[] {
  const lines = src.split("\n")
  const start = lines.findIndex((l) => new RegExp(`^export type ${name}\\s*=\\s*$`).test(l))
  if (start === -1) throw new Error(`Could not find union "${name}"`)
  const members: string[] = []
  for (const line of lines.slice(start + 1)) {
    const m = line.match(/^\s*\|\s*([A-Z]\w+)\b/)
    if (m) {
      members.push(m[1]!)
      continue
    }
    if (line.trim() === "" || /^\s*\/\//.test(line)) continue
    break
  }
  return members
}

describe("ExtensionMessage type members", () => {
  it("all members of ExtensionMessage union are defined in message type sources", () => {
    const memberNames = extractUnionMembers(readFile(EXTENSION_MESSAGES_FILE), "ExtensionMessage")

    const defined = readMessageTypeSources()
    const missing = memberNames.filter((name) => {
      return !new RegExp(`(interface|type)\\s+${name}\\b`).test(defined)
    })

    expect(
      missing,
      `ExtensionMessage members without definitions in message type sources: ${missing.join(", ")}`,
    ).toEqual([])
  })

  it("all members of WebviewMessage union are defined in message type sources", () => {
    const memberNames = extractUnionMembers(readFile(WEBVIEW_MESSAGES_FILE), "WebviewMessage")

    const defined = readMessageTypeSources()
    const missing = memberNames.filter((name) => {
      return !new RegExp(`(interface|type)\\s+${name}\\b`).test(defined)
    })

    expect(
      missing,
      `WebviewMessage members without definitions in message type sources: ${missing.join(", ")}`,
    ).toEqual([])
  })
})

describe("KiloProvider message handler coverage", () => {
  it("all WebviewMessage switch cases in KiloProvider exist in WebviewMessage union", () => {
    const providerContent = readFile(KILO_PROVIDER_FILE)
    const messagesContent = readMessageTypeSources()

    // Extract case labels from handleWebviewMessage switch
    const caseMatches = [...providerContent.matchAll(/case "([a-zA-Z]+)":/g)].map((m) => m[1]!)

    // Get all type values from WebviewMessage members
    const typeValues = [...messagesContent.matchAll(/type:\s*"([a-zA-Z]+)"/g)].map((m) => m[1]!)
    const typeSet = new Set(typeValues)

    const unrecognized = caseMatches.filter((c) => !typeSet.has(c))

    expect(
      unrecognized,
      `KiloProvider switch cases not found in any message type definition: ${unrecognized.join(", ")}`,
    ).toEqual([])
  })
})

describe("mapSSEEventToWebviewMessage output types", () => {
  it("all output types from mapSSEEventToWebviewMessage exist in ExtensionMessage", () => {
    const utilsContent = readFile(KILO_PROVIDER_UTILS_FILE)
    const messagesContent = readMessageTypeSources()

    // Extract type literals used in the return values of mapSSEEventToWebviewMessage
    const typeMatches = [...utilsContent.matchAll(/type:\s*"([a-zA-Z]+)"/g)].map((m) => m[1]!)

    // Get all type values defined across the wire-type sources.
    const allTypes = [...messagesContent.matchAll(/type:\s*"([a-zA-Z]+)"/g)].map((m) => m[1]!)
    const typeSet = new Set(allTypes)

    const missing = typeMatches.filter((t) => !typeSet.has(t))

    expect(
      missing,
      `Types in mapSSEEventToWebviewMessage not found in message type sources: ${missing.join(", ")}`,
    ).toEqual([])
  })
})
