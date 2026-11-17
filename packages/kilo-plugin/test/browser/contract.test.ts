import { describe, expect, test } from "bun:test"
import { BrowserContract } from "../../src/browser/contract"
import { entries } from "../../src/browser/contract-shape"

// The extension vendors the same pin; its header records this SHA-256.
const EXTENSION_SHA256 = "6ee94e2fca227ae0a6304c476e20731acf4650f1f5856c9cf7b734a368fcadda"

const NAMES = [
  "browser_close",
  "browser_resize",
  "browser_console_messages",
  "browser_handle_dialog",
  "browser_evaluate",
  "browser_file_upload",
  "browser_drop",
  "browser_find",
  "browser_fill_form",
  "browser_press_key",
  "browser_type",
  "browser_navigate",
  "browser_navigate_back",
  "browser_network_requests",
  "browser_network_request",
  "browser_run_code_unsafe",
  "browser_take_screenshot",
  "browser_snapshot",
  "browser_click",
  "browser_drag",
  "browser_hover",
  "browser_select_option",
  "browser_tabs",
  "browser_wait_for",
  "browser_webmcp_list",
  "browser_webmcp_call",
]

describe("generated browser contract", () => {
  test("pins the shared Playwright MCP version", () => {
    expect(BrowserContract.upstream).toBe("@playwright/mcp@0.0.81")
  })

  test("matches the extension's contract SHA-256", () => {
    expect(BrowserContract.sha256).toBe(EXTENSION_SHA256)
  })

  test("lists the whole contract, unprefixed and in the pinned order", () => {
    expect(BrowserContract.entries.map((entry) => entry.name)).toEqual(NAMES)
  })

  test("every tool carries an object input schema and a description", () => {
    for (const entry of BrowserContract.entries) {
      expect(entry.inputSchema).toMatchObject({ type: "object" })
      expect(entry.description.length).toBeGreaterThan(0)
    }
  })

  test("normalizes a raw tools/list result back to the same contract and hash", () => {
    const raw = { tools: BrowserContract.entries.map((entry) => ({
      name: entry.name,
      description: entry.description,
      inputSchema: entry.inputSchema,
      annotations: { title: entry.title || undefined, readOnlyHint: entry.readOnly },
    })) }
    expect(entries(raw).map((entry) => entry.name)).toEqual(NAMES)
    expect(entries(raw)).toEqual([...BrowserContract.entries])
  })

  test("rejects a tool list that is not an object schema", () => {
    expect(() => entries({ tools: [{ name: "browser_x", inputSchema: { type: "string" } }] })).toThrow(
      "browser_x has no object input schema",
    )
    expect(() => entries({ tools: [] })).toThrow("empty tool list")
    expect(() => entries({})).toThrow("no tool list")
  })
})
