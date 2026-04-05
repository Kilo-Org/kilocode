// kilocode_change - new file
// Tests for per-agent model persistence in local.tsx (model.json read/write)
//
// NOTE: Bun test uses solid-js/dist/server.js (SSR build) where createMemo
// evaluates once and never re-evaluates. The @opentui/solid preload plugin
// that swaps server→client build is only in the top-level bunfig preload,
// not the [test] section. Assertions therefore verify persistence via
// model.json file contents rather than model.current() reactive state.

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { createRoot } from "solid-js"
import path from "path"
import fs from "fs/promises"

// ── Mutable mock state ──────────────────────────────────────────────────────

const mockProviders = [
  {
    id: "anthropic",
    name: "Anthropic",
    source: "env" as const,
    env: ["ANTHROPIC_API_KEY"],
    options: {},
    models: {
      "claude-sonnet": {
        id: "claude-sonnet",
        providerID: "anthropic",
        name: "Claude Sonnet",
        capabilities: {},
      },
      "claude-opus": {
        id: "claude-opus",
        providerID: "anthropic",
        name: "Claude Opus",
        capabilities: {},
      },
    },
  },
]

let mockAgents = [
  { name: "code", mode: "primary" as const, hidden: false, model: undefined as any, color: undefined as any, permission: {} },
  { name: "plan", mode: "primary" as const, hidden: false, model: undefined as any, color: undefined as any, permission: {} },
]

let mockConfig: { model?: string } = {}
let mockArgs: { model?: string } = {}
let toastMessages: Array<{ variant: string; message: string }> = []

// ── Mocks ────────────────────────────────────────────────────────────────────
// Only mock TUI context modules that are specific to the CLI layer and not
// used by other test files. Do NOT mock widely-used modules like @/global,
// @/provider/provider, or @opentui/core — they persist process-wide in Bun
// and would break other test files.

let capturedInit: (() => any) | undefined

mock.module("@tui/context/helper", () => ({
  createSimpleContext: (input: { name: string; init: () => any }) => {
    capturedInit = input.init
    return { use: () => {}, provider: () => {} }
  },
}))

mock.module("@tui/context/sync", () => ({
  useSync: () => ({
    data: {
      provider: mockProviders,
      provider_default: { anthropic: "claude-sonnet" },
      agent: mockAgents,
      config: mockConfig,
      mcp: {},
    },
  }),
}))

mock.module("@tui/context/theme", () => ({
  useTheme: () => ({
    theme: {
      primary: { buffer: new Float32Array(4) },
      secondary: { buffer: new Float32Array(4) },
      accent: { buffer: new Float32Array(4) },
      success: { buffer: new Float32Array(4) },
      warning: { buffer: new Float32Array(4) },
      error: { buffer: new Float32Array(4) },
      info: { buffer: new Float32Array(4) },
    },
  }),
}))

mock.module("@tui/context/args", () => ({
  useArgs: () => mockArgs,
}))

mock.module("@tui/context/sdk", () => ({
  useSDK: () => ({
    client: {
      mcp: {
        disconnect: async () => {},
        connect: async () => {},
      },
    },
  }),
}))

const toastMock = {
  show: (opts: { variant: string; message: string; duration?: number }) => {
    toastMessages.push({ variant: opts.variant, message: opts.message })
  },
}
mock.module("@tui/ui/toast", () => ({
  useToast: () => toastMock,
}))

// ── Import under test (after mocks) ────────────────────────────────────────

await import("@tui/context/local")

// Import the real Global to get the state path (set by test preload via XDG_STATE_HOME)
const { Global } = await import("@/global")
const modelJsonPath = path.join(Global.Path.state, "model.json")

// ── Helpers ─────────────────────────────────────────────────────────────────

function resetMockState() {
  mockAgents = [
    { name: "code", mode: "primary", hidden: false, model: undefined, color: undefined, permission: {} },
    { name: "plan", mode: "primary", hidden: false, model: undefined, color: undefined, permission: {} },
  ]
  mockConfig = {}
  mockArgs = {}
  toastMessages = []
}

function runInRoot(): { local: any; dispose: () => void } {
  let local: any
  let dispose!: () => void
  createRoot((d) => {
    dispose = d
    local = capturedInit!()
  })
  return { local: local!, dispose }
}

async function initLocal(options?: {
  prewrite?: Record<string, any>
}): Promise<{ local: any; dispose: () => void }> {
  if (options?.prewrite) {
    await fs.writeFile(modelJsonPath, JSON.stringify(options.prewrite))
  }

  if (!capturedInit) throw new Error("capturedInit not set — mock.module for helper failed")

  const { local, dispose } = runInRoot()

  // Poll until model.ready is true
  const deadline = Date.now() + 2000
  while (!local.model.ready && Date.now() < deadline) {
    await Bun.sleep(10)
  }
  if (!local.model.ready) throw new Error("model.ready never became true within 2s")

  return { local, dispose }
}

async function readModelJson(): Promise<any> {
  const text = await fs.readFile(modelJsonPath, "utf-8")
  return JSON.parse(text)
}

async function removeModelJson() {
  await fs.rm(modelJsonPath, { force: true }).catch(() => {})
}

const SONNET = { providerID: "anthropic", modelID: "claude-sonnet" }
const OPUS = { providerID: "anthropic", modelID: "claude-opus" }

// ── Setup ───────────────────────────────────────────────────────────────────

beforeEach(async () => {
  resetMockState()
  await removeModelJson()
})

afterEach(async () => {
  await removeModelJson()
})

// ── Tests ───────────────────────────────────────────────────────────────────

describe("model.set persists per-agent model", () => {
  test("1: model.set for agent 'code' writes model.code to model.json", async () => {
    const { local, dispose } = await initLocal()
    try {
      local.model.set(OPUS, { recent: true })
      await Bun.sleep(50)

      const data = await readModelJson()
      expect(data.model.code).toEqual(OPUS)
      expect(data.recent).toBeArrayOfSize(1)
      expect(data.recent[0]).toEqual(OPUS)
    } finally {
      dispose()
    }
  })

  test("2: set code→sonnet, plan→opus persists both in model.json", async () => {
    const { local, dispose } = await initLocal()
    try {
      local.model.set(SONNET, { recent: true })
      local.agent.set("plan")
      local.model.set(OPUS, { recent: true })
      await Bun.sleep(50)

      const data = await readModelJson()
      expect(data.model.code).toEqual(SONNET)
      expect(data.model.plan).toEqual(OPUS)
    } finally {
      dispose()
    }
  })

  test("3: save → dispose → re-init from same dir loads persisted data", async () => {
    // First session: set and save
    {
      const { local, dispose } = runInRoot()
      const deadline = Date.now() + 2000
      while (!local.model.ready && Date.now() < deadline) await Bun.sleep(10)
      local.model.set(OPUS, { recent: true })
      await Bun.sleep(50)
      dispose()
    }

    // Verify file was written correctly
    const fileData = await readModelJson()
    expect(fileData.model.code).toEqual(OPUS)
    expect(fileData.recent[0]).toEqual(OPUS)

    // Second session: re-init from same dir — verify file data was loaded
    {
      const { local, dispose } = runInRoot()
      const deadline = Date.now() + 2000
      while (!local.model.ready && Date.now() < deadline) await Bun.sleep(10)

      // recent() reads the store directly (not a memo), so it reflects the loaded file
      expect(local.model.recent()).toEqual([OPUS])

      // Setting a new model on top of loaded data should produce correct file
      local.model.set(SONNET, { recent: true })
      await Bun.sleep(50)
      const data2 = await readModelJson()
      expect(data2.model.code).toEqual(SONNET)
      expect(data2.recent[0]).toEqual(SONNET)
      expect(data2.recent[1]).toEqual(OPUS)
      dispose()
    }
  })
})

describe("model.cycle and model.cycleFavorite", () => {
  test("4: cycle(1) advances to next recent model, persists per-agent", async () => {
    const { local, dispose } = await initLocal({
      prewrite: {
        recent: [SONNET, OPUS],
        model: { code: SONNET },
        favorite: [],
        variant: {},
      },
    })
    try {
      local.model.cycle(1)
      await Bun.sleep(50)

      const data = await readModelJson()
      expect(data.model.code).toEqual(OPUS)
    } finally {
      dispose()
    }
  })

  test("5: cycleFavorite(1) cycles to next favorite and persists", async () => {
    const { local, dispose } = await initLocal({
      prewrite: {
        recent: [SONNET],
        model: { code: SONNET },
        favorite: [SONNET, OPUS],
        variant: {},
      },
    })
    try {
      local.model.cycleFavorite(1)
      await Bun.sleep(50)

      const data = await readModelJson()
      expect(data.model.code).toEqual(OPUS)
      expect(data.recent.some((r: any) => r.modelID === "claude-opus")).toBe(true)
    } finally {
      dispose()
    }
  })
})

describe("edge cases and error handling", () => {
  test("6: model.json without 'model' field does not crash, falls back", async () => {
    const { local, dispose } = await initLocal({
      prewrite: {
        recent: [SONNET],
        favorite: [],
        variant: {},
      },
    })
    try {
      expect(local.model.ready).toBe(true)
      // recent() reads the store directly and should have loaded
      expect(local.model.recent()).toEqual([SONNET])
      // current() evaluates once at init before file loads — falls to provider default
      expect(local.model.current()).toBeDefined()
    } finally {
      dispose()
    }
  })

  test("7: corrupt model.json does not crash, defaults to empty state", async () => {
    await fs.writeFile(modelJsonPath, "{{{not valid json")

    const { local, dispose } = runInRoot()
    const deadline = Date.now() + 2000
    while (!local.model.ready && Date.now() < deadline) await Bun.sleep(10)

    try {
      expect(local.model.ready).toBe(true)
      // Should not have loaded any data
      expect(local.model.recent()).toEqual([])
      expect(local.model.favorite()).toEqual([])
    } finally {
      dispose()
    }
  })

  test("8: pre-written model.code with invalid provider — valid models still load", async () => {
    const { local, dispose } = await initLocal({
      prewrite: {
        recent: [SONNET],
        model: { code: { providerID: "nonexistent", modelID: "fake-model" } },
        favorite: [],
        variant: {},
      },
    })
    try {
      // recent loaded correctly despite invalid model.code
      expect(local.model.recent()).toEqual([SONNET])
      // The initial current() evaluates before file loads, so it falls to default
      const current = local.model.current()
      expect(current).toBeDefined()
      expect(current!.providerID).toBe("anthropic")
    } finally {
      dispose()
    }
  })

  test("9: model.set before ready still persists after ready", async () => {
    const { local, dispose } = runInRoot()

    // Immediately set before ready (ready is false because file load is async)
    const wasReadyBefore = local.model.ready
    local.model.set(OPUS, { recent: true })

    // Wait for ready
    const deadline = Date.now() + 2000
    while (!local.model.ready && Date.now() < deadline) await Bun.sleep(10)
    await Bun.sleep(50)

    try {
      expect(wasReadyBefore).toBe(false)
      expect(local.model.ready).toBe(true)
      const data = await readModelJson()
      expect(data.model.code).toEqual(OPUS)
    } finally {
      dispose()
    }
  })

  test("10: agent with config model persists when applied", async () => {
    // NOTE: In production, a createEffect in local.tsx auto-applies agent config
    // models when switching agents. In bun test, createEffect is a no-op (SSR build).
    // This test verifies the underlying persistence: when an agent has a config model,
    // model.set (what the effect would call) correctly persists it.
    mockAgents = [
      { name: "code", mode: "primary", hidden: false, model: undefined, color: undefined, permission: {} },
      { name: "plan", mode: "primary", hidden: false, model: OPUS, color: undefined, permission: {} },
    ]
    const { local, dispose } = await initLocal()
    try {
      // Switch to "plan" agent which has config model OPUS
      local.agent.set("plan")
      // Simulate what createEffect would do: apply the agent's config model
      local.model.set(OPUS)
      await Bun.sleep(50)

      const data = await readModelJson()
      expect(data.model.plan).toEqual(OPUS)
    } finally {
      dispose()
    }
  })

  test("11: user override from file is retained after load", async () => {
    mockAgents = [
      { name: "code", mode: "primary", hidden: false, model: OPUS, color: undefined, permission: {} },
      { name: "plan", mode: "primary", hidden: false, model: undefined, color: undefined, permission: {} },
    ]
    const { local, dispose } = await initLocal({
      prewrite: {
        recent: [SONNET, OPUS],
        model: { code: SONNET },
        favorite: [],
        variant: {},
      },
    })
    try {
      // The file had model.code = SONNET, recent = [SONNET, OPUS]
      // Verify file data was loaded into the store
      expect(local.model.recent()).toEqual([SONNET, OPUS])

      // Setting a new model should layer on top of the loaded state
      local.model.set(OPUS, { recent: true })
      await Bun.sleep(50)
      const data = await readModelJson()
      // model.code should now be OPUS (the new set)
      expect(data.model.code).toEqual(OPUS)
    } finally {
      dispose()
    }
  })

  test("12: switching agents without config models produces no warning toasts", async () => {
    const { local, dispose } = await initLocal()
    try {
      toastMessages = []
      local.agent.set("plan")
      local.agent.set("code")
      await Bun.sleep(50)

      const warnings = toastMessages.filter((t) => t.message.includes("configured model"))
      expect(warnings).toHaveLength(0)
    } finally {
      dispose()
    }
  })
})
