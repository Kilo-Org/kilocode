import { expect, test } from "bun:test"
import type { Provider } from "@/provider/provider"
import { SystemPrompt } from "@/session/system"

test("Muse Spark identifies as Kilo and uses Kilo documentation", () => {
  const prompt = SystemPrompt.provider({ api: { id: "meta/muse-spark-preview" } } as Provider.Model)[0]
  expect(prompt).toContain("You are Kilo")
  expect(prompt).toContain("Muse Spark")
  expect(prompt).toContain("https://kilo.ai/docs")
  expect(prompt).not.toContain("You are OpenCode")
  expect(prompt).not.toContain("identify yourself as OpenCode")
  expect(prompt).not.toContain("https://opencode.ai/docs")
})
