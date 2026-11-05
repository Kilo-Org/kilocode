import { describe, expect, it } from "bun:test"
import type { PromptAttachment } from "../src/protocol"
import {
  attachmentDrafts,
  attachmentText,
  fileAttachments,
  imageAttachment,
  mergeAttachments,
  pasteDrafts,
  toPromptFiles,
} from "../webview-ui/src/v2/prompt-attachments"

function attachment(kind: PromptAttachment["kind"], uri: string, name: string): PromptAttachment {
  return { id: uri, kind, uri, name }
}

describe("mergeAttachments", () => {
  it("keeps the current order and appends new attachments", () => {
    const first = attachment("file", "file:///a.ts", "a.ts")
    const second = attachment("file", "file:///b.ts", "b.ts")
    expect(mergeAttachments([first], [second])).toEqual([first, second])
  })

  it("drops an attachment with the same kind, uri, and name", () => {
    const first = attachment("selection", "file:///a.ts?start=1&end=2", "a.ts:1-2")
    expect(mergeAttachments([first], [first])).toEqual([first])
  })

  it("keeps attachments that share a uri but differ in kind or name", () => {
    const file = attachment("file", "file:///a.ts", "a.ts")
    const selection = attachment("selection", "file:///a.ts", "a.ts:1-2")
    expect(mergeAttachments([file], [selection])).toEqual([file, selection])
  })
})

describe("imageAttachment", () => {
  it("maps an image read to a data URL attachment", () => {
    expect(
      imageAttachment({ id: "image-1", filename: "shot.png", mime: "image/png", dataUrl: "data:image/png;base64,AA" }),
    ).toEqual({ id: "image-1", kind: "image", uri: "data:image/png;base64,AA", name: "shot.png" })
  })
})

describe("fileAttachments", () => {
  it("builds an absolute file URI and a workspace-relative path", () => {
    expect(fileAttachments(["/work/app/src/a.ts"], "/work/app")).toEqual([
      {
        id: "file:///work/app/src/a.ts",
        kind: "file",
        uri: "file:///work/app/src/a.ts",
        name: "a.ts",
        description: "src/a.ts",
        path: "src/a.ts",
      },
    ])
  })

  it("handles Windows drive letters", () => {
    expect(fileAttachments(["C:\\work\\app\\src\\a.ts"], "C:\\work\\app")).toEqual([
      {
        id: "file:///C:/work/app/src/a.ts",
        kind: "file",
        uri: "file:///C:/work/app/src/a.ts",
        name: "a.ts",
        description: "src/a.ts",
        path: "src/a.ts",
      },
    ])
  })

  it("keeps a file URL as an absolute file URI", () => {
    expect(fileAttachments(["file:///work/app/src/a.ts"], "/work/app")).toEqual([
      {
        id: "file:///work/app/src/a.ts",
        kind: "file",
        uri: "file:///work/app/src/a.ts",
        name: "a.ts",
        description: "src/a.ts",
        path: "src/a.ts",
      },
    ])
  })

  it("drops the authority of a remote URL", () => {
    expect(fileAttachments(["vscode-remote://ssh-remote+host/work/app/src/a.ts"], "/work/app")).toEqual([
      {
        id: "file:///work/app/src/a.ts",
        kind: "file",
        uri: "file:///work/app/src/a.ts",
        name: "a.ts",
        description: "src/a.ts",
        path: "src/a.ts",
      },
    ])
  })

  it("keeps a file outside the workspace at its absolute path", () => {
    expect(fileAttachments(["/other/b.ts"], "/work/app")).toEqual([
      {
        id: "file:///other/b.ts",
        kind: "file",
        uri: "file:///other/b.ts",
        name: "b.ts",
        description: "/other/b.ts",
        path: "/other/b.ts",
      },
    ])
  })

  it("joins a workspace-relative drag path to the workspace root", () => {
    expect(fileAttachments(["src/a.ts"], "/work/app")).toEqual([
      {
        id: "file:///work/app/src/a.ts",
        kind: "file",
        uri: "file:///work/app/src/a.ts",
        name: "a.ts",
        description: "src/a.ts",
        path: "src/a.ts",
      },
    ])
  })

  it("encodes spaces in the URI but not in the chip text", () => {
    const [result] = fileAttachments(["/work/my app/a b.ts"], "/work/my app")
    expect(result?.uri).toBe("file:///work/my%20app/a%20b.ts")
    expect(result?.name).toBe("a b.ts")
    expect(result?.description).toBe("a b.ts")
  })
})

describe("toPromptFiles", () => {
  it("marks a source as a URI so the server keeps the original file", () => {
    const item: PromptAttachment = {
      id: "1",
      kind: "selection",
      uri: "file:///work/app/src/a.ts?start=1&end=2",
      name: "a.ts:1-2",
      description: "src/a.ts",
      source: "file:///work/app/src/a.ts",
    }
    expect(toPromptFiles([item])).toEqual([
      {
        uri: "file:///work/app/src/a.ts?start=1&end=2",
        name: "a.ts:1-2",
        description: "src/a.ts",
        source: { type: "uri", uri: "file:///work/app/src/a.ts" },
      },
    ])
  })

  it("omits optional fields that are not set", () => {
    const image = imageAttachment({ id: "1", filename: "a.png", mime: "image/png", dataUrl: "data:image/png;base64,AA" })
    const [file] = toPromptFiles([image])
    expect(file).toEqual({ uri: "data:image/png;base64,AA", name: "a.png" })
    expect(file?.source).toBeUndefined()
    expect(file?.description).toBeUndefined()
  })
})

describe("attachmentText", () => {
  it("decodes UTF-8 text from a base64 data URL", () => {
    const text = "héllo 😀"
    const uri = `data:text/plain;base64,${Buffer.from(text).toString("base64")}`
    expect(attachmentText(attachment("selection", uri, "a.ts"))).toBe(text)
  })

  it("decodes percent-encoded text from a plain data URL", () => {
    const text = "# héllo 😀"
    const uri = `data:text/markdown,${encodeURIComponent(text)}`
    expect(attachmentText(attachment("selection", uri, "a.md"))).toBe(text)
  })

  it("returns undefined for a non-text data URL and a file URI", () => {
    expect(attachmentText(attachment("image", "data:image/png;base64,AA", "a.png"))).toBeUndefined()
    expect(attachmentText(attachment("file", "file:///work/app/a.ts", "a.ts"))).toBeUndefined()
  })

  it("returns undefined when the payload cannot be decoded", () => {
    expect(attachmentText(attachment("selection", "data:text/plain;base64,!!!", "a.ts"))).toBeUndefined()
  })
})

describe("draft stores", () => {
  it("keeps attachments by draft key and clears an empty list", () => {
    const item = attachment("file", "file:///a.ts", "a.ts")
    attachmentDrafts.set("draft-a", [item])
    expect(attachmentDrafts.get("draft-a")).toEqual([item])
    attachmentDrafts.set("draft-a", [])
    expect(attachmentDrafts.get("draft-a")).toEqual([])
    expect(attachmentDrafts.get(undefined)).toEqual([])
  })

  it("keeps paste backing by draft key and clears an empty list", () => {
    pasteDrafts.set("draft-a", ["one", "two"])
    expect(pasteDrafts.get("draft-a")).toEqual(["one", "two"])
    pasteDrafts.set("draft-a", [])
    expect(pasteDrafts.get("draft-a")).toEqual([])
    expect(pasteDrafts.get(undefined)).toEqual([])
  })
})
