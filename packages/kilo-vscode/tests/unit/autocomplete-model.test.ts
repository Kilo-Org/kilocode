import { describe, it, expect, mock, beforeEach } from "bun:test"

// vscode mock is provided by the shared preload (tests/setup/vscode-mock.ts)
const { AutocompleteModel } = await import("../../src/services/autocomplete/AutocompleteModel")
type KiloConnectionService = import("../../src/services/cli-backend").KiloConnectionService

const fim = mock()

const client = {
  kilo: { fim },
}

function makeConnection(state: "connecting" | "connected" | "disconnected" | "error" = "connected") {
  return {
    getConnectionState: () => state,
    getClient: () => client,
    getClientAsync:
      state === "connected"
        ? () => Promise.resolve(client)
        : () => Promise.reject(new Error(`CLI backend is not connected (state: ${state})`)),
    onStateChange: () => () => {},
  } as unknown as KiloConnectionService
}

describe("AutocompleteModel", () => {
  beforeEach(() => {
    fim.mockReset()
  })

  describe("constructor", () => {
    it("defaults profileName and profileType to null", () => {
      const m = new AutocompleteModel()
      expect(m.profileName).toBeNull()
      expect(m.profileType).toBeNull()
    })
  })

  describe("setConnectionService", () => {
    it("sets the connection service after construction", () => {
      const m = new AutocompleteModel()
      expect(m.hasValidCredentials()).toBe(false)

      m.setConnectionService(makeConnection("connected"))
      expect(m.hasValidCredentials()).toBe(true)
    })
  })

  describe("hasValidCredentials", () => {
    it("returns true when connected", () => {
      const m = new AutocompleteModel(makeConnection("connected"))
      expect(m.hasValidCredentials()).toBe(true)
    })

    it("returns false when disconnected", () => {
      const m = new AutocompleteModel(makeConnection("disconnected"))
      expect(m.hasValidCredentials()).toBe(false)
    })

    it("returns false when connecting", () => {
      const m = new AutocompleteModel(makeConnection("connecting"))
      expect(m.hasValidCredentials()).toBe(false)
    })

    it("returns false when in error state", () => {
      const m = new AutocompleteModel(makeConnection("error"))
      expect(m.hasValidCredentials()).toBe(false)
    })

    it("returns false without connection service", () => {
      const m = new AutocompleteModel()
      expect(m.hasValidCredentials()).toBe(false)
    })
  })

  describe("getModelName", () => {
    it("returns the default model", () => {
      const m = new AutocompleteModel()
      expect(m.getModelName()).toBe("mistralai/codestral-2508")
    })
  })

  describe("getProviderDisplayName", () => {
    it("returns the default provider", () => {
      const m = new AutocompleteModel()
      expect(m.getProviderDisplayName()).toBe("Mistral AI")
    })

    it("returns the selected provider", () => {
      const m = new AutocompleteModel()
      m.setModel("inception/mercury-edit")

      expect(m.getProviderDisplayName()).toBe("Inception")
    })
  })

  describe("generateFimResponse", () => {
    it("throws when connection service is not available", async () => {
      const m = new AutocompleteModel()
      await expect(m.generateFimResponse("prefix", "suffix", mock())).rejects.toThrow(
        "Connection service is not available",
      )
    })

    it("throws when not connected", async () => {
      const m = new AutocompleteModel(makeConnection("disconnected"))
      await expect(m.generateFimResponse("prefix", "suffix", mock())).rejects.toThrow("CLI backend is not connected")
    })

    it("streams chunks and returns metadata", async () => {
      const chunks = [
        { choices: [{ delta: { content: "hello" } }] },
        {
          choices: [{ delta: { content: " world" } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
          cost: 0.001,
        },
      ]

      fim.mockResolvedValue({
        stream: (async function* () {
          for (const chunk of chunks) yield chunk
        })(),
      })

      const m = new AutocompleteModel(makeConnection("connected"))
      const received: string[] = []
      const result = await m.generateFimResponse("prefix", "suffix", (text) => received.push(text))

      expect(received).toEqual(["hello", " world"])
      expect(result).toEqual({
        cost: 0.001,
        inputTokens: 10,
        outputTokens: 5,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
      })
    })

    it("streams text-completion chunks", async () => {
      const chunks = [{ choices: [{ text: "hello" }] }, { choices: [{ text: " world" }] }]

      fim.mockResolvedValue({
        stream: (async function* () {
          for (const chunk of chunks) yield chunk
        })(),
      })

      const m = new AutocompleteModel(makeConnection("connected"))
      const received: string[] = []
      await m.generateFimResponse("prefix", "suffix", (text) => received.push(text))

      expect(received).toEqual(["hello", " world"])
    })

    it("passes model parameters to fim call", async () => {
      fim.mockResolvedValue({
        stream: (async function* () {})(),
      })

      const m = new AutocompleteModel(makeConnection("connected"))
      const signal = new AbortController().signal
      await m.generateFimResponse("pre", "suf", mock(), signal)

      expect(fim).toHaveBeenCalledWith(
        {
          prefix: "pre",
          suffix: "suf",
          model: "mistralai/codestral-2508",
          maxTokens: 256,
          temperature: 0.2,
        },
        expect.objectContaining({ signal }),
      )
    })

    it("passes selected model parameters to fim call", async () => {
      fim.mockResolvedValue({
        stream: (async function* () {})(),
      })

      const m = new AutocompleteModel(makeConnection("connected"))
      m.setModel("inception/mercury-edit")
      await m.generateFimResponse("pre", "suf", mock())

      expect(fim).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "inception/mercury-edit",
          temperature: 0,
        }),
        expect.any(Object),
      )
    })
  })
})
