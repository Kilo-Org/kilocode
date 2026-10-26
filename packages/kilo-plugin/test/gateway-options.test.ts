import { expect, test } from "bun:test"
import { GatewayOptions } from "../src/gateway/options"

test.each([
  {
    name: "an effort-only model keeps provider thinking enabled",
    layers: [{ reasoning: { enabled: true } }, { reasoning: { effort: "low" } }],
    thinking: "adaptive",
  },
  {
    name: "an effort-only variant keeps earlier thinking enabled",
    layers: [{ reasoning: { enabled: true } }, {}, { reasoning: { effort: "low" } }],
    thinking: "adaptive",
  },
  {
    name: "explicit false still disables thinking",
    layers: [{ reasoning: { enabled: true } }, { reasoning: { enabled: false, effort: "low" } }],
    thinking: "disabled",
  },
  {
    name: "native thinking remains authoritative in its layer",
    layers: [{ reasoning: { enabled: true }, thinking: { type: "disabled" } }],
    thinking: "disabled",
  },
  {
    name: "effort alone does not opt out of native thinking defaults",
    layers: [{ reasoning: { effort: "low" } }],
    thinking: undefined,
  },
])("Anthropic shared options: $name", ({ layers, thinking }) => {
  expect(GatewayOptions.request("anthropic", layers).thinking).toEqual(thinking ? { type: thinking } : undefined)
})
