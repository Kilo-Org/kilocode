import { expect, test } from "bun:test"
import { SessionExport } from "@/kilocode/session-export"

test("agent info export omits prompt options and permissions", () => {
  const info = SessionExport.agentInfo({
    name: "code",
    displayName: "Code",
    description: "writes code",
    mode: "primary",
    native: true,
    prompt: "custom proprietary prompt",
    options: { apiKey: "secret" },
    permission: { bash: "allow" },
    model: { providerID: "kilo", modelID: "free" },
    variant: "fast",
  } as never)

  expect(info).toEqual({
    name: "code",
    displayName: "Code",
    description: "writes code",
    mode: "primary",
    native: true,
    model: { providerID: "kilo", modelID: "free" },
    variant: "fast",
  })
})
