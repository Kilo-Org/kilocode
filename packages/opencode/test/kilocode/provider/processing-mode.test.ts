import { expect, test } from "bun:test"
import { ProviderV2 } from "@opencode-ai/core/provider"
import {
  apply,
  FLEX_REQUEST_TIMEOUT_MS,
  isFlexRequest,
  supportsFlex,
} from "../../../src/kilocode/provider/processing-mode"

const model = {
  id: "gpt-5.6-luna",
  api: { id: "gpt-5.6-luna", npm: "@ai-sdk/openai", url: "https://api.openai.com/v1" },
}
const provider = { id: ProviderV2.ID.make("openai"), options: {}, source: "env" as const }
const auth = { type: "api" as const }

test("allows Flex for direct OpenAI API Responses models", () => {
  expect(supportsFlex({ provider, model, auth })).toBe(true)
})

test("allows the built-in OpenAI endpoint when catalog URL is empty", () => {
  expect(supportsFlex({ provider, model: { ...model, api: { ...model.api, url: "" } }, auth })).toBe(true)
})

test("rejects models outside the initial verified Flex allowlist", () => {
  expect(supportsFlex({ provider, model: { ...model, id: "gpt-5.6-sol" }, auth })).toBe(false)
})

test("recognizes Flex request bodies and uses the extended timeout", () => {
  expect(isFlexRequest('{"service_tier":"flex"}')).toBe(true)
  expect(isFlexRequest('{"service_tier":"default"}')).toBe(false)
  expect(FLEX_REQUEST_TIMEOUT_MS).toBe(900_000)
})

test("rejects Flex for non-OpenAI credentials and endpoints", () => {
  expect(supportsFlex({ provider, model, auth: { type: "oauth" } })).toBe(false)
  expect(supportsFlex({ provider: { ...provider, id: ProviderV2.ID.make("kilo") }, model, auth })).toBe(false)
  expect(supportsFlex({ provider, model: { api: { ...model.api, url: "https://proxy.example/v1" } }, auth })).toBe(
    false,
  )
})

test("applies Flex and clears an inherited service tier for Standard", () => {
  const base = { serviceTier: "flex", reasoningEffort: "high" }
  expect(apply({ mode: "flex", provider, model, auth, options: base })).toEqual({
    serviceTier: "flex",
    reasoningEffort: "high",
  })
  expect(apply({ mode: "standard", provider, model, auth, options: base })).toEqual({ reasoningEffort: "high" })
})

test("does not change non-OpenAI options when Standard is selected", () => {
  const options = { serviceTier: "provider-specific" }
  expect(
    apply({
      mode: "standard",
      provider: { id: ProviderV2.ID.make("anthropic"), options: {}, source: "api" },
      model,
      auth,
      options,
    }),
  ).toBe(options)
})

test("fails closed when Flex is requested for an unsupported model", () => {
  expect(() =>
    apply({
      mode: "flex",
      provider,
      model: { api: { ...model.api, npm: "@ai-sdk/openai-compatible" } },
      auth,
      options: {},
    }),
  ).toThrow("Flex processing is only available")
})
