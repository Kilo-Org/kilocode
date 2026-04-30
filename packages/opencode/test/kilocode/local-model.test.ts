// kilocode_change - new file
// Tests for per-agent model persistence in local.tsx (model.json read/write)
//
// NOTE: The package test preload swaps Solid to the client build so effects
// and memos re-run. Tests assert both in-memory current model state and the
// persisted model.json contents.

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
  {
    name: "code",
    mode: "primary" as const,
    hidden: false,
    model: undefined as any,
    color: undefined as any,
    permission: {},
  },
  {
    name: "plan",
    mode: "primary" as const,
    hidden: false,
    model: undefined as any,
    color: undefined as any,
    permission: {},
  },
]

let mockConfig: { model?: string } = {}
let mockArgs: { model?: string } = {}
let mockWorkspace: string | undefined
let mockDirectory = "mock-project"
let toastMessages: Array<{ variant: string; message: string }> = []

// ── Mocks ────────────────────────────────────────────────────────────────────
// Bun's mock.module() is process-wide and permanent — it replaces the module
// for ALL test files in the same runner process. To avoid breaking other tests
// that import these modules, we spread the real exports and only override the
// specific hooks this test needs.

const realHelper = await import("@tui/context/helper")
const realSync = await import("@tui/context/sync")
const realTheme = await import("@tui/context/theme")
const realArgs = await import("@tui/context/args")
const realSdk = await import("@tui/context/sdk")
const realProject = await import("@tui/context/project")
const realToast = await import("@tui/ui/toast")

let capturedInit: (() => any) | undefined

mock.module("@tui/context/helper", () => ({
  ...realHelper,
  createSimpleContext: (input: { name: string; init: () => any }) => {
    capturedInit = input.init
    return { use: () => {}, provider: () => {} }
  },
}))

mock.module("@tui/context/sync", () => ({
  ...realSync,
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
  ...realTheme,
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
  ...realArgs,
  useArgs: () => mockArgs,
}))

mock.module("@tui/context/sdk", () => ({
  ...realSdk,
  useSDK: () => ({
    client: {
      mcp: {
        disconnect: async () => {},
        connect: async () => {},
      },
    },
  }),
}))

mock.module("@tui/context/project", () => ({
  ...realProject,
  useProject: () => ({
    workspace: {
      current: () => mockWorkspace,
    },
    instance: {
      directory: () => mockDirectory,
    },
  }),
}))

const toastMock = {
  show: (opts: { variant: string; message: string; duration?: number }) => {
    toastMessages.push({ variant: opts.variant, message: opts.message })
  },
}
mock.module("@tui/ui/toast", () => ({
  ...realToast,
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
  mockWorkspace = undefined
  mockDirectory = "mock-project"
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

async function initLocal(options?: { prewrite?: Record<string, any> }): Promise<{ local: any; dispose: () => void }> {
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
  const until = Date.now() + 2000
  while (true) {
    try {
      const text = await fs.readFile(modelJsonPath, "utf-8")
      return JSON.parse(text)
    } catch (err) {
      if (Date.now() >= until) throw err
      await Bun.sleep(10)
    }
  }
}

async function readModelJsonMaybe(): Promise<any | undefined> {
  try {
    const text = await fs.readFile(modelJsonPath, "utf-8")
    return JSON.parse(text)
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? err.code : undefined
    if (code === "ENOENT") return undefined
    throw err
  }
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

  test("10: model.set for configured agent is in-process only", async () => {
    mockAgents = [
      { name: "code", mode: "primary", hidden: false, model: undefined, color: undefined, permission: {} },
      { name: "plan", mode: "primary", hidden: false, model: OPUS, color: undefined, permission: {} },
    ]
    const { local, dispose } = await initLocal()
    try {
      local.agent.set("plan")
      await Bun.sleep(50)

      local.model.set(SONNET, { recent: true })
      await Bun.sleep(50)

      expect(local.model.current()).toEqual(SONNET)
      expect(local.model.saved("plan")).toBeUndefined()
      const data = await readModelJson()
      expect(data.model.plan).toBeUndefined()
      expect(data.recent[0]).toEqual(SONNET)
    } finally {
      dispose()
    }
  })

  test("11: stale persisted model is ignored when agent has config model", async () => {
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
      expect(local.model.recent()).toEqual([SONNET, OPUS])
      expect(local.model.current()).toEqual(OPUS)

      local.model.set(OPUS, { recent: true })
      await Bun.sleep(50)
      const data = await readModelJson()
      expect(data.model.code).toBeUndefined()
      expect(data.recent[0]).toEqual(OPUS)
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

// ── Regression tests for #9050 follow-up ────────────────────────────────────
// Configured agent defaults should win on restart/project switch, while manual
// selections for those agents remain active only in the current process.

describe("#9050: configured agent defaults beat stale persisted picks", () => {
  test("13: fresh start - config model resolves without persistence", async () => {
    mockAgents = [
      { name: "plan", mode: "primary", hidden: false, model: OPUS, color: undefined, permission: {} },
      { name: "code", mode: "primary", hidden: false, model: undefined, color: undefined, permission: {} },
    ]
    const { local, dispose } = await initLocal()
    try {
      await Bun.sleep(50)

      expect(local.model.current()).toEqual(OPUS)
      expect(local.model.saved("plan")).toBeUndefined()
      const data = await readModelJsonMaybe()
      expect(data?.model?.plan).toBeUndefined()
    } finally {
      dispose()
    }
  })

  test("14: configured model wins over stale persisted model", async () => {
    mockAgents = [
      { name: "plan", mode: "primary", hidden: false, model: OPUS, color: undefined, permission: {} },
      { name: "code", mode: "primary", hidden: false, model: undefined, color: undefined, permission: {} },
    ]
    const { local, dispose } = await initLocal({
      prewrite: {
        recent: [SONNET],
        model: { plan: SONNET },
        favorite: [],
        variant: {},
      },
    })
    try {
      expect(local.model.saved("plan")).toEqual(SONNET)
      expect(local.model.current()).toEqual(OPUS)
      const data = await readModelJson()
      expect(data.model.plan).toEqual(SONNET)
    } finally {
      dispose()
    }
  })

  test("15: user override of a config-model agent resets after re-init", async () => {
    mockAgents = [
      { name: "plan", mode: "primary", hidden: false, model: OPUS, color: undefined, permission: {} },
      { name: "code", mode: "primary", hidden: false, model: undefined, color: undefined, permission: {} },
    ]

    {
      const { local, dispose } = await initLocal()
      try {
        expect(local.model.current()).toEqual(OPUS)

        local.model.set(SONNET, { recent: true })
        await Bun.sleep(50)
        expect(local.model.current()).toEqual(SONNET)
        expect(local.model.saved("plan")).toBeUndefined()

        local.agent.set("code")
        await Bun.sleep(50)
        local.agent.set("plan")
        await Bun.sleep(50)
        expect(local.model.current()).toEqual(SONNET)

        const data = await readModelJson()
        expect(data.model.plan).toBeUndefined()
        expect(data.recent[0]).toEqual(SONNET)
      } finally {
        dispose()
      }
    }

    {
      const { local, dispose } = await initLocal()
      try {
        expect(local.model.current()).toEqual(OPUS)
        expect(local.model.saved("plan")).toBeUndefined()
      } finally {
        dispose()
      }
    }
  })

  test("16: invalid config model still emits a warning toast", async () => {
    mockAgents = [
      { name: "code", mode: "primary", hidden: false, model: undefined, color: undefined, permission: {} },
      {
        name: "plan",
        mode: "primary",
        hidden: false,
        model: { providerID: "nonexistent", modelID: "fake-model" },
        color: undefined,
        permission: {},
      },
    ]
    const { local, dispose } = await initLocal()
    try {
      toastMessages = []
      local.agent.set("plan")
      await Bun.sleep(50)

      const warnings = toastMessages.filter((t) => t.variant === "warning" && t.message.includes("not valid"))
      expect(warnings.length).toBeGreaterThan(0)
      expect(local.model.saved("plan")).toBeUndefined()
      const data = await readModelJsonMaybe()
      expect(data?.model?.plan).toBeUndefined()
    } finally {
      dispose()
    }
  })
})
