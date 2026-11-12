import { describe, expect, test } from "bun:test"
import { ConfigModelCapabilities } from "../../../src/kilocode/provider/model-capabilities"

const resolve = ConfigModelCapabilities.resolve

describe("ConfigModelCapabilities.resolve", () => {
  test("attachment:true without modalities enables image input while keeping other defaults", () => {
    const caps = resolve({ attachment: true })

    expect(caps.attachment).toBe(true)
    expect(caps.input.image).toBe(true)
    expect(caps.input.pdf).toBe(false)
    expect(caps.input.audio).toBe(false)
    expect(caps.input.video).toBe(false)
    expect(caps.input.text).toBe(true)
    expect(caps.output.text).toBe(true)
    expect(caps.output.audio).toBe(false)
  })

  test("modalities alone derive attachment from visual input modalities", () => {
    const caps = resolve({
      modalities: { input: ["text", "image"], output: ["text", "audio"] },
    })

    expect(caps.attachment).toBe(true)
    expect(caps.input.image).toBe(true)
    expect(caps.input.text).toBe(true)
    expect(caps.input.pdf).toBe(false)
    expect(caps.output.audio).toBe(true)
    expect(caps.output.text).toBe(true)
  })

  test("pdf-only input modality does not derive attachment", () => {
    const caps = resolve({ modalities: { input: ["text", "pdf"] } })

    expect(caps.attachment).toBe(false)
    expect(caps.input.pdf).toBe(true)
    expect(caps.input.image).toBe(false)
  })

  test("image and pdf input modalities derive attachment with both enabled", () => {
    const caps = resolve({
      modalities: { input: ["text", "image", "pdf"], output: ["text"] },
    })

    expect(caps.attachment).toBe(true)
    expect(caps.input.image).toBe(true)
    expect(caps.input.pdf).toBe(true)
  })

  test("attachment and modalities together match the explicit configuration", () => {
    const caps = resolve({
      attachment: true,
      modalities: { input: ["text", "image"], output: ["text"] },
    })

    expect(caps.attachment).toBe(true)
    expect(caps.input).toEqual({ text: true, audio: false, image: true, video: false, pdf: false })
    expect(caps.output).toEqual({ text: true, audio: false, image: false, video: false, pdf: false })
  })

  test("explicit attachment:false stays false even when modalities include image", () => {
    const caps = resolve({
      attachment: false,
      modalities: { input: ["text", "image"], output: ["text"] },
    })

    expect(caps.attachment).toBe(false)
    expect(caps.input.image).toBe(true)
  })

  test("explicit modalities take precedence over attachment derivation for image", () => {
    const caps = resolve({
      attachment: true,
      modalities: { input: ["text"], output: ["text"] },
    })

    expect(caps.attachment).toBe(true)
    expect(caps.input.image).toBe(false)
    expect(caps.input.text).toBe(true)
  })

  test("an explicit empty input array turns every input modality off, including text", () => {
    const caps = resolve({
      attachment: true,
      modalities: { input: [], output: ["text"] },
    })

    expect(caps.input).toEqual({ text: false, audio: false, image: false, video: false, pdf: false })
    // explicit attachment still wins; modalities derivation is not consulted
    expect(caps.attachment).toBe(true)
  })

  test("empty input array without attachment flag derives attachment false", () => {
    const caps = resolve({ modalities: { input: [] } })

    expect(caps.attachment).toBe(false)
    expect(caps.input.image).toBe(false)
  })

  test("inherits existing capabilities when no config flags are present", () => {
    const existing = {
      capabilities: {
        attachment: true,
        input: { text: true, audio: true, image: false, video: false, pdf: true },
        output: { text: false, audio: true, image: false, video: false, pdf: false },
      },
    }

    const caps = resolve({}, existing)

    expect(caps).toEqual(existing.capabilities)
  })

  test("defaults to text-only capabilities without config flags or existing values", () => {
    const caps = resolve({})

    expect(caps.attachment).toBe(false)
    expect(caps.input).toEqual({ text: true, audio: false, image: false, video: false, pdf: false })
    expect(caps.output).toEqual({ text: true, audio: false, image: false, video: false, pdf: false })
  })

  test("output-only modalities inherit attachment and input from existing capabilities", () => {
    const existing = {
      capabilities: {
        attachment: true,
        input: { text: true, audio: false, image: true, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
      },
    }

    const caps = resolve({ modalities: { output: ["audio"] } }, existing)

    // Without an explicit modalities.input array, attachment and input are
    // inherited from the catalog model instead of being re-derived from output.
    expect(caps.attachment).toBe(true)
    expect(caps.input).toEqual(existing.capabilities.input)
    expect(caps.output.audio).toBe(true)
    expect(caps.output.text).toBe(false)
  })

  test("attachment:true with output-only modalities still backfills image input", () => {
    const caps = resolve({ attachment: true, modalities: { output: ["text"] } })

    expect(caps.attachment).toBe(true)
    expect(caps.input.image).toBe(true)
    expect(caps.input.pdf).toBe(false)
    expect(caps.output.text).toBe(true)
  })

  test("output-only modalities keep existing attachment and input while overriding output", () => {
    const existing = {
      capabilities: {
        attachment: true,
        input: { text: true, audio: false, image: true, video: false, pdf: false },
        output: { text: false, audio: false, image: false, video: false, pdf: false },
      },
    }

    const caps = resolve({ modalities: { output: ["audio"] } }, existing)

    expect(caps.attachment).toBe(true)
    expect(caps.input).toEqual(existing.capabilities.input)
    expect(caps.output.audio).toBe(true)
    expect(caps.output.text).toBe(false)
  })

  test("empty modalities object inherits attachment and input from existing capabilities", () => {
    const existing = {
      capabilities: {
        attachment: true,
        input: { text: true, audio: true, image: true, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
      },
    }

    const caps = resolve({ modalities: {} }, existing)

    expect(caps.attachment).toBe(true)
    expect(caps.input).toEqual(existing.capabilities.input)
  })

  test("modalities with only an output key and no existing model keep text input defaults", () => {
    const caps = resolve({ modalities: { output: ["text"] } })

    expect(caps.attachment).toBe(false)
    expect(caps.input).toEqual({ text: true, audio: false, image: false, video: false, pdf: false })
    expect(caps.output.text).toBe(true)
  })

  test("null attachment and null modalities are treated like missing values", () => {
    const caps = resolve({ attachment: null, modalities: null })

    expect(caps.attachment).toBe(false)
    expect(caps.input.text).toBe(true)
    expect(caps.input.image).toBe(false)
  })
})
