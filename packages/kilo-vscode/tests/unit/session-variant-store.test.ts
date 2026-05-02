import { describe, expect, it } from "bun:test"
import {
  getStoredVariant,
  legacyVariantKey,
  variantKey,
} from "../../webview-ui/src/context/session-variant-store"
import type { ModelSelection } from "../../webview-ui/src/types/messages"

const qwen: ModelSelection = { providerID: "openrouter", modelID: "qwen/qwen3.6-plus" }
const claude: ModelSelection = { providerID: "anthropic", modelID: "claude-sonnet-4" }

describe("session-variant-store", () => {
  describe("variantKey", () => {
    it("includes the agent so two modes using the same model do not collide", () => {
      expect(variantKey("plan", qwen)).not.toBe(variantKey("code", qwen))
    })

    it("matches the documented shape", () => {
      expect(variantKey("plan", qwen)).toBe("plan:openrouter/qwen/qwen3.6-plus")
    })
  })

  describe("getStoredVariant", () => {
    it("returns undefined when nothing is stored for either key shape", () => {
      expect(getStoredVariant({}, "plan", qwen)).toBeUndefined()
    })

    it("returns the per-mode entry when present", () => {
      const variants = { [variantKey("plan", qwen)]: "thinking" }
      expect(getStoredVariant(variants, "plan", qwen)).toBe("thinking")
    })

    it("does not leak one mode's choice into another mode (regression for #9757)", () => {
      const variants = {
        [variantKey("plan", qwen)]: "thinking",
        [variantKey("code", qwen)]: "instant",
      }
      expect(getStoredVariant(variants, "plan", qwen)).toBe("thinking")
      expect(getStoredVariant(variants, "code", qwen)).toBe("instant")
    })

    it("falls back to a legacy single-model entry when no per-mode entry exists", () => {
      const variants = { [legacyVariantKey(qwen)]: "thinking" }
      expect(getStoredVariant(variants, "plan", qwen)).toBe("thinking")
      expect(getStoredVariant(variants, "code", qwen)).toBe("thinking")
    })

    it("prefers a per-mode entry over a legacy entry for the same model", () => {
      const variants = {
        [variantKey("plan", qwen)]: "thinking",
        [legacyVariantKey(qwen)]: "instant",
      }
      expect(getStoredVariant(variants, "plan", qwen)).toBe("thinking")
      expect(getStoredVariant(variants, "code", qwen)).toBe("instant")
    })

    it("isolates variants by model identity within the same mode", () => {
      const variants = {
        [variantKey("plan", qwen)]: "thinking",
        [variantKey("plan", claude)]: "instant",
      }
      expect(getStoredVariant(variants, "plan", qwen)).toBe("thinking")
      expect(getStoredVariant(variants, "plan", claude)).toBe("instant")
    })
  })
})
