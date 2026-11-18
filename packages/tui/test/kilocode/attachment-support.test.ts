import { describe, expect, test } from "bun:test"
import { receivingModel, unsupportedAttachments, type Capabilities, type Modality } from "../../src/kilocode/attachment-support"

const all: Capabilities = { image: true, audio: true, video: true, pdf: true }
const none: Capabilities = { image: false, audio: false, video: false, pdf: false }

describe("unsupportedAttachments", () => {
  test.each<{ name: string; mime: string; caps: Capabilities | undefined; expected: Modality[] }>([
    { name: "image on image-capable model", mime: "image/png", caps: all, expected: [] },
    {
      name: "image on model without image input",
      mime: "image/png",
      caps: { ...all, image: false },
      expected: ["image"],
    },
    { name: "pdf unsupported", mime: "application/pdf", caps: { ...all, pdf: false }, expected: ["pdf"] },
    { name: "audio unsupported", mime: "audio/mpeg", caps: { ...all, audio: false }, expected: ["audio"] },
    { name: "video unsupported", mime: "video/mp4", caps: { ...all, video: false }, expected: ["video"] },
    { name: "text file is not an attachment", mime: "text/plain", caps: none, expected: [] },
    { name: "svg is an image attachment", mime: "image/svg+xml", caps: { ...all, image: false }, expected: ["image"] },
    { name: "unknown mime ignored", mime: "application/zip", caps: none, expected: [] },
    { name: "unknown model allowed", mime: "image/png", caps: undefined, expected: [] },
  ])("$name", ({ mime, caps, expected }) => {
    const result = unsupportedAttachments([{ type: "file", mime, filename: "a" }], caps)
    expect(result.map((item) => item.modality)).toEqual(expected)
  })

  test("text parts are ignored and filename is reported", () => {
    const result = unsupportedAttachments(
      [{ type: "text" }, { type: "file", mime: "image/png", filename: "shot.png" }],
      none,
    )
    expect(result).toEqual([{ filename: "shot.png", modality: "image" }])
  })
})

describe("receivingModel", () => {
  const selected = { providerID: "a", modelID: "primary" }
  const parent = { parentID: undefined, agent: undefined, model: undefined }
  const child = { parentID: "p", agent: "general", model: { providerID: "b", id: "child" } }

  test.each<{ name: string; mode: string; session: Parameters<typeof receivingModel>[0]["session"]; expected: { providerID: string; modelID: string } | undefined }>([
    { name: "normal prompt without session", mode: "normal", session: undefined, expected: selected },
    { name: "normal prompt in a root session", mode: "normal", session: parent, expected: selected },
    { name: "shell mode sends no attachments", mode: "shell", session: parent, expected: undefined },
    { name: "shell mode without session", mode: "shell", session: undefined, expected: undefined },
    { name: "steering uses the child model", mode: "normal", session: child, expected: { providerID: "b", modelID: "child" } },
    { name: "child without a model falls back", mode: "normal", session: { ...child, model: undefined }, expected: selected },
  ])("$name", ({ mode, session, expected }) => {
    expect(receivingModel({ mode, session, selected })).toEqual(expected)
  })

  describe("slash commands", () => {
    const agents = [
      { name: "vision", model: { providerID: "v", modelID: "eyes" } },
      { name: "plain" },
    ]
    test.each<{ name: string; command?: { model?: string; agent?: string }; expected: { providerID: string; modelID: string } }>([
      { name: "no command", command: undefined, expected: selected },
      { name: "command model wins", command: { model: "c/m/x", agent: "vision" }, expected: { providerID: "c", modelID: "m/x" } },
      { name: "command agent model", command: { agent: "vision" }, expected: { providerID: "v", modelID: "eyes" } },
      { name: "agent without model", command: { agent: "plain" }, expected: selected },
      { name: "unknown agent", command: { agent: "missing" }, expected: selected },
      { name: "plain command", command: {}, expected: selected },
    ])("$name", ({ command, expected }) => {
      expect(receivingModel({ mode: "normal", session: undefined, selected, command, agents })).toEqual(expected)
    })
  })
})

describe("mcp resources", () => {
  test.each<{ name: string; source: { type: string } | undefined; expected: Modality[] }>([
    { name: "resource parts are skipped", source: { type: "resource" }, expected: [] },
    { name: "file source still checked", source: { type: "file" }, expected: ["image"] },
    { name: "no source still checked", source: undefined, expected: ["image"] },
  ])("$name", ({ source, expected }) => {
    const result = unsupportedAttachments([{ type: "file", mime: "image/svg+xml", source }], none)
    expect(result.map((item) => item.modality)).toEqual(expected)
  })
})
