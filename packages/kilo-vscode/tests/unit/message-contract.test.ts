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
const MESSAGES_FILE = path.join(ROOT, "webview-ui/src/types/messages.ts")
const KILO_PROVIDER_FILE = path.join(ROOT, "src/KiloProvider.ts")
const KILO_PROVIDER_UTILS_FILE = path.join(ROOT, "src/kilo-provider-utils.ts")
// Some wire types (partUpdated, partsUpdated) live in a file shared by the
// extension and webview; the contract checks must include it.
const SHARED_STREAM_MESSAGES_FILE = path.join(ROOT, "src/shared/stream-messages.ts")

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8")
}

function readMessageTypeSources(): string {
  return readFile(MESSAGES_FILE) + "\n" + readFile(SHARED_STREAM_MESSAGES_FILE)
}

describe("ExtensionMessage type members", () => {
  it("all members of ExtensionMessage union are defined as interfaces/types in messages.ts", () => {
    const content = readFile(MESSAGES_FILE)

    // Extract ExtensionMessage union members
    const unionMatch = content.match(
      /export type ExtensionMessage\s*=\s*([\s\S]*?)(?=\nexport type|\nexport interface|\nexport function|\n\/\/|$)/,
    )
    if (!unionMatch) {
      expect(false, "Could not find ExtensionMessage union in messages.ts").toBe(true)
      return
    }

    const unionBody = unionMatch[1]!
    const memberNames = [...unionBody.matchAll(/\|\s*([A-Z]\w+)\b/g)].map((m) => m[1]!)

    const defined = readMessageTypeSources()
    const missing = memberNames.filter((name) => {
      return !new RegExp(`(interface|type)\\s+${name}\\b`).test(defined)
    })

    expect(missing, `ExtensionMessage members without definitions: ${missing.join(", ")}`).toEqual([])
  })

  it("all members of WebviewMessage union are defined as interfaces/types in messages.ts", () => {
    const content = readFile(MESSAGES_FILE)

    const unionMatch = content.match(/export type WebviewMessage\s*=\s*([\s\S]*?)(?=\n\/\/|$)/)
    if (!unionMatch) {
      expect(false, "Could not find WebviewMessage union in messages.ts").toBe(true)
      return
    }

    const unionBody = unionMatch[1]!
    const memberNames = [...unionBody.matchAll(/\|\s*([A-Z]\w+)\b/g)].map((m) => m[1]!)

    const defined = readMessageTypeSources()
    const missing = memberNames.filter((name) => {
      return !new RegExp(`(interface|type)\\s+${name}\\b`).test(defined)
    })

    expect(missing, `WebviewMessage members without definitions: ${missing.join(", ")}`).toEqual([])
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

    expect(missing, `Types in mapSSEEventToWebviewMessage not in messages.ts: ${missing.join(", ")}`).toEqual([])
  })
})
