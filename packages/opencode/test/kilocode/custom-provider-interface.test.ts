import { describe, expect, test } from "bun:test"
import { CustomProviderInterface } from "../../src/kilocode/provider/custom-provider"

type Args = Parameters<typeof CustomProviderInterface.language>

const model = { api: { id: "gpt-5" } } as Args[1]

describe("CustomProviderInterface", () => {
  test("uses OpenAI Responses API when requested", () => {
    const calls: string[] = []
    const sdk = {
      responses(id: string) {
        calls.push(id)
        return { id, type: "responses" }
      },
    } as unknown as Args[0]

    const result = CustomProviderInterface.language(sdk, model, { interfaceType: "openai-responses" }) as unknown

    expect(result).toEqual({
      id: "gpt-5",
      type: "responses",
    })
    expect(calls).toEqual(["gpt-5"])
  })

  test("strips interface metadata from SDK options", () => {
    expect(
      CustomProviderInterface.withoutInterface({
        baseURL: "https://example.com/v1",
        interfaceType: "openai-responses",
      }),
    ).toEqual({ baseURL: "https://example.com/v1" })
  })
})
