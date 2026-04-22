import { describe, it, expect, vi, beforeEach } from "vitest"
import { AutocompleteModel } from "../AutocompleteModel"
import type { KiloConnectionService } from "../../cli-backend"

const mockClient = {
  kilo: {
    fim: vi.fn(),
  },
}

function createMockConnectionService(state: "connecting" | "connected" | "disconnected" | "error" = "connected") {
  return {
    getConnectionState: vi.fn().mockReturnValue(state),
    getClient: vi.fn().mockReturnValue(mockClient),
    getClientAsync:
      state === "connected"
        ? vi.fn().mockResolvedValue(mockClient)
        : vi.fn().mockRejectedValue(new Error(`CLI backend is not connected (state: ${state})`)),
    onStateChange: vi.fn().mockReturnValue(() => {}),
  } as unknown as KiloConnectionService
}

describe("AutocompleteModel", () => {
  beforeEach(() => {
    mockClient.kilo.fim.mockReset()
  })

  describe("constructor", () => {
    it("defaults profileName and profileType to null", () => {
      const model = new AutocompleteModel()
      expect(model.profileName).toBeNull()
      expect(model.profileType).toBeNull()
    })
  })

  describe("setConnectionService", () => {
    it("sets the connection service after construction", () => {
      const model = new AutocompleteModel()
      expect(model.hasValidCredentials()).toBe(false)

      const connection = createMockConnectionService("connected")
      model.setConnectionService(connection)
      expect(model.hasValidCredentials()).toBe(true)
    })
  })

  describe("hasValidCredentials", () => {
    it("returns true when connected", () => {
      const connection = createMockConnectionService("connected")
      const model = new AutocompleteModel(connection)
      expect(model.hasValidCredentials()).toBe(true)
    })

    it("returns false when disconnected", () => {
      const connection = createMockConnectionService("disconnected")
      const model = new AutocompleteModel(connection)
      expect(model.hasValidCredentials()).toBe(false)
    })

    it("returns false when connecting", () => {
      const connection = createMockConnectionService("connecting")
      const model = new AutocompleteModel(connection)
      expect(model.hasValidCredentials()).toBe(false)
    })

    it("returns false when in error state", () => {
      const connection = createMockConnectionService("error")
      const model = new AutocompleteModel(connection)
      expect(model.hasValidCredentials()).toBe(false)
    })

    it("returns false without connection service", () => {
      const model = new AutocompleteModel()
      expect(model.hasValidCredentials()).toBe(false)
    })
  })

  describe("getModelName", () => {
    it("returns the default model", () => {
      const model = new AutocompleteModel()
      expect(model.getModelName()).toBe("mistralai/codestral-2508")
    })
  })

  describe("getProviderDisplayName", () => {
    it("returns Kilo Gateway", () => {
      const model = new AutocompleteModel()
      expect(model.getProviderDisplayName()).toBe("Kilo Gateway")
    })
  })

  describe("generateFimResponse", () => {
    it("throws when connection service is not available", async () => {
      const model = new AutocompleteModel()
      await expect(model.generateFimResponse("prefix", "suffix", vi.fn())).rejects.toThrow(
        "Connection service is not available",
      )
    })

    it("throws when not connected", async () => {
      const connection = createMockConnectionService("disconnected")
      const model = new AutocompleteModel(connection)
      await expect(model.generateFimResponse("prefix", "suffix", vi.fn())).rejects.toThrow(
        "CLI backend is not connected",
      )
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

      const connection = createMockConnectionService("connected")
      mockClient.kilo.fim.mockResolvedValue({
        stream: (async function* () {
          for (const chunk of chunks) yield chunk
        })(),
      })

      const model = new AutocompleteModel(connection)
      const received: string[] = []
      const result = await model.generateFimResponse("prefix", "suffix", (text) => received.push(text))

      expect(received).toEqual(["hello", " world"])
      expect(result).toEqual({
        cost: 0.001,
        inputTokens: 10,
        outputTokens: 5,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
      })
    })

    it("passes model parameters to fim call", async () => {
      const connection = createMockConnectionService("connected")
      mockClient.kilo.fim.mockResolvedValue({
        stream: (async function* () {})(),
      })

      const model = new AutocompleteModel(connection)
      const signal = new AbortController().signal
      await model.generateFimResponse("pre", "suf", vi.fn(), signal)

      expect(mockClient.kilo.fim).toHaveBeenCalledWith(
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
  })
})
