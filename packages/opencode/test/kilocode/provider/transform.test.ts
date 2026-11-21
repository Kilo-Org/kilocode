import { describe, expect, test } from "bun:test"
import { ProviderTransform } from "@/provider/transform"

describe("ProviderTransform.message - unsupported modality parts", () => {
  const baseMockModel = {
    id: "custom/vision-model",
    providerID: "custom",
    api: {
      id: "vision-model",
      url: "https://api.example.com/v1",
      npm: "@ai-sdk/openai-compatible",
    },
    name: "Vision Model",
    cost: {
      input: 0.003,
      output: 0.015,
      cache: { read: 0.0003, write: 0.00375 },
    },
    limit: {
      context: 200000,
      output: 8192,
    },
    status: "active",
    options: {},
    headers: {},
  } as any

  // attachment:true intentionally disagrees with input.image:false to prove
  // the runtime guard reads capabilities.input, not the attachment flag.
  const noImageModel = {
    ...baseMockModel,
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
  } as any

  const visionModel = {
    ...baseMockModel,
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
  } as any

  test("replaces image parts with an error text when input.image is false", () => {
    const msgs = [
      {
        role: "user",
        content: [{ type: "image", image: "data:image/png;base64,abcd" }],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, noImageModel, {}) as any[]

    expect(result[0].content).toHaveLength(1)
    expect(result[0].content[0].type).toBe("text")
    expect(result[0].content[0].text).toContain("does not support image input")
  })

  test("keeps image parts unchanged when input.image is true", () => {
    const imagePart = { type: "image", image: "data:image/png;base64,abcd" }
    const msgs = [
      {
        role: "user",
        content: [imagePart],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, visionModel, {}) as any[]

    expect(result[0].content).toHaveLength(1)
    expect(result[0].content[0]).toEqual(imagePart)
  })

  test("replaces pdf file parts with an error text when input.pdf is false", () => {
    const filePart = {
      type: "file",
      mediaType: "application/pdf",
      filename: "a.pdf",
      data: new Uint8Array([1]),
    } as any
    const msgs = [
      {
        role: "user",
        content: [filePart],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, noImageModel, {}) as any[]

    expect(result[0].content).toHaveLength(1)
    expect(result[0].content[0].type).toBe("text")
    expect(result[0].content[0].text).toContain('Cannot read "a.pdf"')
    expect(result[0].content[0].text).toContain("does not support pdf input")
  })
})
