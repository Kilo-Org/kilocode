import { describe, it, expect } from "vitest"
import {
  shouldProbeAtomicChat,
  isAtomicChatAutoDetectEnabled,
  hasAtomicChatProviderSection,
} from "../src/utils/should-probe-atomic-chat"
import { ATOMIC_CHAT_PROVIDER_KEY } from "../src/constants"

describe("shouldProbeAtomicChat", () => {
  it("returns false for empty config (no localhost HTTP)", () => {
    expect(shouldProbeAtomicChat({})).toBe(false)
    expect(shouldProbeAtomicChat({ provider: {} })).toBe(false)
  })

  it("returns true when provider.atomic-chat is configured", () => {
    expect(
      shouldProbeAtomicChat({
        provider: { [ATOMIC_CHAT_PROVIDER_KEY]: { options: { baseURL: "http://127.0.0.1:1337/v1" } } },
      }),
    ).toBe(true)
  })

  it("returns true when atomicChat.autoDetect is enabled", () => {
    expect(shouldProbeAtomicChat({ atomicChat: { autoDetect: true } })).toBe(true)
    expect(isAtomicChatAutoDetectEnabled({ atomicChat: { autoDetect: true } })).toBe(true)
  })

  it("returns true when default model uses atomic-chat", () => {
    expect(shouldProbeAtomicChat({ model: "atomic-chat/gemma-4-E4B-it-IQ4_XS" })).toBe(true)
  })

  it("returns true when per-agent model uses atomic-chat", () => {
    expect(
      shouldProbeAtomicChat({
        model: {
          code: { providerID: ATOMIC_CHAT_PROVIDER_KEY, modelID: "gemma-4-E4B-it-IQ4_XS" },
        },
      }),
    ).toBe(true)
  })

  it("hasAtomicChatProviderSection reflects provider block only", () => {
    expect(hasAtomicChatProviderSection({})).toBe(false)
    expect(hasAtomicChatProviderSection({ provider: { [ATOMIC_CHAT_PROVIDER_KEY]: {} } })).toBe(true)
  })
})
