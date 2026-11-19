import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  IncompatibleError,
  NeedsPermissionError,
  UNAVAILABLE_MESSAGE,
  UnavailableError,
  UnsupportedError,
} from "../../src/browser/backend"
import { BrowserContract } from "../../src/browser/contract"
import { backend, EXTENSION_HINT, grants, map, needs, STOPPED, UPDATE_HINT } from "../../src/browser/extension"
import { BrowserHub } from "../../src/browser/hub"
import { rememberStep, resetSteps, takeStep } from "../../src/browser/steps"

type Call = {
  sessionHandle: string
  name: string
  arguments: Record<string, unknown>
  authorized: readonly { class: string; origin: string }[]
  sensitive?: readonly string[]
  signal?: AbortSignal
}

type Upload = { uploadId: string; name: string; size: number; mimeType: string }

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

/** A stand-in hub: records what the backend asked for and answers with the scripted result. */
function fake(
  options: {
    protocol?: readonly number[]
    contractSha?: string
    tools?: readonly string[]
    call?: (input: Call) => Promise<BrowserHub.Reply>
    ready?: () => Promise<BrowserHub.Info>
    /** The browser answers every `upload.*` with `unsupported_in_browser`, like one that uploads from the page. */
    refuseUpload?: boolean
  } = {},
) {
  const calls: Call[] = []
  const opened: { sessionId: string; title: string; cwd: string }[] = []
  const closed: string[] = []
  const began: Upload[] = []
  const chunks: { uploadId: string; index: number; data: string }[] = []
  const ended: string[] = []
  const listeners = new Set<(input: { sessionHandle: string; reason: string }) => void>()
  let handles = 0
  const info: BrowserHub.Info = {
    protocol: options.protocol ?? [1],
    contractSha: options.contractSha ?? BrowserContract.sha256,
    extensionVersion: "1.0.0",
    profileLabel: "Fake profile",
  }
  const port: BrowserHub.Port = {
    ready: () => (options.ready ? options.ready() : Promise.resolve(info)),
    reported: () => Promise.resolve(undefined),
    open: (input) => {
      opened.push(input)
      handles += 1
      return Promise.resolve({ sessionHandle: `handle-${handles}` })
    },
    close: (handle) => {
      closed.push(handle)
      return Promise.resolve()
    },
    list: () => Promise.resolve(options.tools ?? BrowserContract.entries.map((entry) => entry.name)),
    call: (input) => {
      calls.push(input)
      if (options.call) return options.call(input)
      return Promise.resolve({
        content: [{ type: "text", text: "- Page URL: http://localhost:3000\n- Page Title: Test page" }],
      })
    },
    begin: (input) => {
      if (options.refuseUpload) {
        return Promise.reject(
          new BrowserHub.Failure({
            kind: "unsupported",
            message: "File upload transfer is not supported by this browser.",
          }),
        )
      }
      began.push(input)
      return Promise.resolve()
    },
    chunk: (input) => {
      chunks.push(input)
      return Promise.resolve()
    },
    end: (uploadId) => {
      ended.push(uploadId)
      return Promise.resolve()
    },
    onRevoked: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return {
    port,
    service: { port: () => port } satisfies BrowserHub.Interface,
    calls,
    opened,
    closed,
    began,
    chunks,
    ended,
    revoke: (input: { sessionHandle: string; reason: string }) => listeners.forEach((listener) => listener(input)),
  }
}

const ctx = (input: { session?: string; authorized?: string[]; sensitive?: string[] } = {}) => ({
  session: input.session ?? "ses_extension",
  ...(input.authorized === undefined ? {} : { authorized: input.authorized }),
  ...(input.sensitive === undefined ? {} : { sensitive: input.sensitive }),
})

describe("extension backend", () => {
  test("a call opens one session, carries the caller identity and reuses its handle", async () => {
    const hub = fake()
    const active = backend({ port: hub.port, directory: "/tmp/project" })
    const first = await active.callTool("browser_navigate", { url: "http://localhost:3000" }, ctx())
    const second = await active.callTool("browser_snapshot", {}, ctx())
    expect(first.isError).toBe(false)
    expect(second.isError).toBe(false)
    expect(hub.opened).toEqual([
      { sessionId: "ses_extension", title: "ses_extension", cwd: "/tmp/project" },
    ])
    expect(hub.calls.map((call) => call.sessionHandle)).toEqual(["handle-1", "handle-1"])
    expect(hub.calls.map((call) => call.name)).toEqual(["browser_navigate", "browser_snapshot"])
  })

  test("concurrent first calls share one session", async () => {
    const hub = fake()
    const active = backend({ port: hub.port, directory: "/tmp/project" })
    await Promise.all([
      active.callTool("browser_snapshot", {}, ctx()),
      active.callTool("browser_find", { query: "a" }, ctx()),
    ])
    expect(hub.opened).toHaveLength(1)
  })

  test("each session opens its own handle", async () => {
    const hub = fake()
    const active = backend({ port: hub.port, directory: "/tmp/project" })
    await active.callTool("browser_snapshot", {}, ctx({ session: "ses_a" }))
    await active.callTool("browser_snapshot", {}, ctx({ session: "ses_b" }))
    expect(hub.opened.map((value) => value.sessionId)).toEqual(["ses_a", "ses_b"])
    expect(hub.calls.map((call) => call.sessionHandle)).toEqual(["handle-1", "handle-2"])
  })

  test("granted pairs and sensitive tokens reach the extension in its own shape", async () => {
    const hub = fake()
    const active = backend({ port: hub.port, directory: "/tmp/project" })
    await active.callTool(
      "browser_type",
      { target: "e1", text: "a" },
      ctx({ authorized: ["read:http://localhost:3000", "act:http://localhost:3000", "not-a-grant"], sensitive: ["tok"] }),
    )
    expect(hub.calls[0]?.authorized).toEqual([
      { class: "read", origin: "http://localhost:3000" },
      { class: "act", origin: "http://localhost:3000" },
    ])
    expect(hub.calls[0]?.sensitive).toEqual(["tok"])
  })

  test("withheld frames and the result meta come back for the tool metadata", async () => {
    const hub = fake({
      call: () =>
        Promise.resolve({
          content: [{ type: "text", text: "- Page URL: https://example.com\n- Page Title: Example" }],
          meta: { url: "https://example.com", origin: "https://example.com", withheldFrames: ["https://ads.example.com"] },
        }),
    })
    const active = backend({ port: hub.port, directory: "/tmp/project" })
    const result = await active.callTool("browser_snapshot", {}, ctx())
    expect(result.meta).toEqual({
      url: "https://example.com",
      origin: "https://example.com",
      withheldFrames: ["https://ads.example.com"],
    })
  })

  test("an image block stays an image and a foreign block is dropped", async () => {
    const hub = fake({
      call: () =>
        Promise.resolve({
          content: [
            { type: "text", text: "- Page URL: https://example.com" },
            { type: "image", data: "AAAA", mimeType: "image/png" },
          ],
        }),
    })
    const active = backend({ port: hub.port, directory: "/tmp/project" })
    const result = await active.callTool("browser_take_screenshot", {}, ctx())
    expect(result.content).toEqual([
      { type: "text", text: "- Page URL: https://example.com" },
      { type: "image", data: "AAAA", mimeType: "image/png" },
    ])
  })

  /** Screenshot answers: the extension's own text and the image it captured, one frame per call, the last repeated. */
  const shot = (...frames: Buffer[]) => {
    let index = 0
    return fake({
      call: () => {
        const data = frames[Math.min(index++, frames.length - 1)] ?? Buffer.alloc(0)
        return Promise.resolve({
          content: [
            { type: "text", text: "Screenshot captured (png, viewport)." },
            { type: "image", data: data.toString("base64"), mimeType: "image/png" },
          ],
        })
      },
    })
  }

  const workspace = async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-shot-"))
    roots.push(directory)
    return fs.realpath(directory)
  }

  test("a screenshot's filename is written under the working directory and linked in the result", async () => {
    const directory = await workspace()
    const png = Buffer.from("png bytes")
    const hub = shot(png)
    const active = backend({ port: hub.port, directory })
    const result = await active.callTool("browser_take_screenshot", { filename: "shots/page.png", type: "png" }, ctx())
    const file = path.join(directory, "shots", "page.png")
    expect(await fs.readFile(file)).toEqual(png)
    // The extension has no file system: it is never handed a name it cannot write.
    expect(hub.calls[0]?.arguments).toEqual({ type: "png" })
    expect(result.content.at(-1)).toEqual({ type: "text", text: `- [Screenshot](${file})` })
    expect(result.content.some((block) => block.type === "image")).toBe(true)
  })

  test("a screenshot name outside the working directory is refused before the browser is asked", async () => {
    const directory = await workspace()
    const hub = shot(Buffer.from("png"))
    const active = backend({ port: hub.port, directory })
    const error = await active
      .callTool("browser_take_screenshot", { filename: "../escape.png" }, ctx())
      .catch((value: unknown) => value)
    expect((error as Error).message).toContain("must stay inside")
    expect(hub.calls).toHaveLength(0)
  })

  test("a screenshot never replaces a file it did not write, and replaces its own", async () => {
    const directory = await workspace()
    const theirs = path.join(directory, "notes.png")
    await fs.writeFile(theirs, "the user's file")
    const active = backend({
      port: shot(Buffer.from("first"), Buffer.from("second"), Buffer.from("third")).port,
      directory,
    })
    const kept = await active.callTool("browser_take_screenshot", { filename: "notes.png" }, ctx())
    expect(await fs.readFile(theirs, "utf8")).toBe("the user's file")
    expect(kept.content.at(-1)).toMatchObject({ type: "text", text: expect.stringContaining("already exists") })
    // The image still reaches the model: only the file was not written.
    expect(kept.content.some((block) => block.type === "image")).toBe(true)

    await active.callTool("browser_take_screenshot", { filename: "mine.png" }, ctx())
    const again = await active.callTool("browser_take_screenshot", { filename: "mine.png" }, ctx())
    expect(again.content.at(-1)).toEqual({ type: "text", text: `- [Screenshot](${path.join(directory, "mine.png")})` })
    expect(await fs.readFile(path.join(directory, "mine.png"), "utf8")).toBe("third")
  })

  test("no hub at all is the model-facing unavailable error with the setup hint", async () => {
    const active = backend({ directory: "/tmp/project" })
    const error = await active.callTool("browser_snapshot", {}, ctx()).catch((value: unknown) => value)
    expect(error).toBeInstanceOf(UnavailableError)
    expect((error as UnavailableError).message).toBe(UNAVAILABLE_MESSAGE)
    expect((error as UnavailableError).hint).toBe(EXTENSION_HINT)
  })

  test("an extension without this protocol is refused with an update hint", async () => {
    const hub = fake({ protocol: [2] })
    const active = backend({ port: hub.port, directory: "/tmp/project" })
    const error = await active.callTool("browser_snapshot", {}, ctx()).catch((value: unknown) => value)
    expect(error).toBeInstanceOf(IncompatibleError)
    expect((error as IncompatibleError).hint).toBe(UPDATE_HINT)
    expect(hub.calls).toHaveLength(0)
  })

  test("a different contract exposes the intersection of both tool lists", async () => {
    const hub = fake({ contractSha: "another", tools: ["browser_navigate", "browser_snapshot"] })
    const active = backend({ port: hub.port, directory: "/tmp/project" })
    expect((await active.listTools()).map((entry) => entry.name)).toEqual(["browser_navigate", "browser_snapshot"])
    const refused = await active.callTool("browser_click", { target: "e1" }, ctx()).catch((value: unknown) => value)
    expect(refused).toBeInstanceOf(UnsupportedError)
    expect(hub.calls).toHaveLength(0)
  })

  test("the same contract keeps the pinned tool list without asking the extension for it", async () => {
    const hub = fake()
    const active = backend({ port: hub.port, directory: "/tmp/project" })
    expect(await active.listTools()).toEqual([...BrowserContract.entries])
    expect(hub.calls).toHaveLength(0)
  })

  test("a pre-action need becomes the permission ask with its step token", async () => {
    const hub = fake({
      call: () =>
        Promise.reject(
          new BrowserHub.Failure({
            kind: "permission",
            message: "unused",
            items: [{ class: "sensitive", origin: "https://example.com", reason: "password field" }],
            stepToken: "token-1",
          }),
        ),
    })
    const active = backend({ port: hub.port, directory: "/tmp/project" })
    const error = await active.callTool("browser_type", { target: "e1", text: "x" }, ctx()).catch((value: unknown) => value)
    expect(error).toBeInstanceOf(NeedsPermissionError)
    expect((error as NeedsPermissionError).items).toEqual([
      { class: "sensitive", origin: "https://example.com", reason: "password field" },
    ])
    expect((error as NeedsPermissionError).stepToken).toBe("token-1")
  })

  test("a post-action need returns the withheld result and never repeats the action", async () => {
    const hub = fake({
      call: () =>
        Promise.reject(
          new BrowserHub.Failure({
            kind: "permission",
            message: "The page moved to https://example.com; its content is withheld until read is granted.",
            items: [{ class: "read", origin: "https://example.com" }],
            stepToken: "tok-9",
            afterAction: true,
            meta: { url: "https://example.com", withheldFrames: ["https://frame.example.com"] },
          }),
        ),
    })
    const active = backend({ port: hub.port, directory: "/tmp/project" })
    const result = await active.callTool("browser_click", { target: "e1" }, ctx())
    expect(hub.calls).toHaveLength(1)
    expect(result.isError).toBe(false)
    expect(result.content).toEqual([
      { type: "text", text: "The page moved to https://example.com; its content is withheld until read is granted." },
    ])
    expect(result.meta?.needs).toEqual([{ class: "read", origin: "https://example.com" }])
    expect(result.meta?.withheldFrames).toEqual(["https://frame.example.com"])
    expect(result.meta?.url).toBe("https://example.com")
    // The step token travels with the pending need; the tool layer remembers it once the user grants.
    expect(result.meta?.stepToken).toBe("tok-9")
  })

  test("a need in a result's _meta is marked after-action, as the wire contract says", async () => {
    const hub = fake({
      call: () =>
        Promise.resolve({
          content: [{ type: "text", text: "The page moved to https://example.com." }],
          meta: { needs: [{ class: "act", origin: "https://example.com" }] },
        }),
    })
    const active = backend({ port: hub.port, directory: "/tmp/project" })
    const result = await active.callTool("browser_click", { target: "e1" }, ctx())
    // A result with needs means the call ran and then asked: `_meta.needs` is post-action by contract.
    expect(result.meta?.afterAction).toBe(true)
    expect(result.meta?.needs).toEqual([{ class: "act", origin: "https://example.com" }])
  })

  test("a need the CLI cannot read is refused instead of half-asked", async () => {
    const hub = fake({
      call: () =>
        Promise.reject(
          new BrowserHub.Failure({ kind: "permission", message: "x", items: [{ class: "sudo", origin: "https://a.b" }] }),
        ),
    })
    const active = backend({ port: hub.port, directory: "/tmp/project" })
    const error = await active.callTool("browser_click", { target: "e1" }, ctx()).catch((value: unknown) => value)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain("cannot describe")
  })

  test("a page with no web origin is refused with the next step, never asked for as an empty origin", async () => {
    for (const origin of ["://", "opaque:null", "file://"]) {
      const hub = fake({
        call: () =>
          Promise.reject(
            new BrowserHub.Failure({ kind: "permission", message: "x", items: [{ class: "read", origin }] }),
          ),
      })
      const active = backend({ port: hub.port, directory: "/tmp/project" })
      const error = await active.callTool("browser_snapshot", {}, ctx()).catch((value: unknown) => value)
      expect(error).not.toBeInstanceOf(NeedsPermissionError)
      expect((error as Error).message).toContain("no web page open")
      expect((error as Error).message).toContain("browser_navigate")
    }
  })

  test("an action that lands on a page with no web origin says it ran and asks for nothing", async () => {
    const after = fake({
      call: () =>
        Promise.reject(
          new BrowserHub.Failure({
            kind: "permission",
            message: "withheld",
            items: [{ class: "read", origin: "://" }],
            afterAction: true,
          }),
        ),
    })
    const clicked = await backend({ port: after.port, directory: "/tmp/project" }).callTool(
      "browser_click",
      { target: "e1" },
      ctx(),
    )
    expect(clicked.isError).toBe(false)
    expect(clicked.meta?.needs).toBeUndefined()
    expect(clicked.content).toHaveLength(1)
    expect(clicked.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("The action ran.") })

    const carried = fake({
      call: () =>
        Promise.resolve({
          content: [{ type: "text", text: "Clicked." }],
          meta: { needs: [{ class: "read", origin: "opaque:null" }] },
        }),
    })
    const result = await backend({ port: carried.port, directory: "/tmp/project" }).callTool(
      "browser_click",
      { target: "e1" },
      ctx(),
    )
    expect(result.meta?.needs).toBeUndefined()
    expect(result.content.at(-1)).toMatchObject({ type: "text", text: expect.stringContaining("no web page open") })
  })

  test("the extension's own error kinds map to tool-layer failures", async () => {
    const cases: {
      failure: ConstructorParameters<typeof BrowserHub.Failure>[0]
      check: (error: unknown) => void
    }[] = [
      {
        failure: { kind: "unavailable", message: "The browser connection dropped: x", uncertain: true },
        check: (error) => {
          expect(error).toBeInstanceOf(UnavailableError)
          expect((error as UnavailableError).message).toBe(UNAVAILABLE_MESSAGE)
          expect((error as UnavailableError).effectsUncertain).toBe(true)
        },
      },
      {
        failure: { kind: "busy", message: "busy" },
        check: (error) => {
          expect((error as Error).message).toContain("tab is busy")
        },
      },
      {
        failure: { kind: "taken", message: "taken" },
        check: (error) => {
          expect((error as Error).message).toContain("took over the tab")
        },
      },
      {
        failure: { kind: "stopped", message: "stopped" },
        check: (error) => {
          expect((error as Error).message).toContain("stopped this browser session")
        },
      },
      {
        failure: { kind: "unsupported", message: "unsupported" },
        check: (error) => expect(error).toBeInstanceOf(UnsupportedError),
      },
      {
        failure: { kind: "blocked", message: "This page blocks browser agents." },
        check: (error) => expect((error as Error).message).toBe("This page blocks browser agents."),
      },
      {
        failure: { kind: "mismatch", message: "protocol_mismatch" },
        check: (error) => {
          expect(error).toBeInstanceOf(IncompatibleError)
          expect((error as IncompatibleError).hint).toBe(UPDATE_HINT)
        },
      },
      {
        failure: { kind: "moved", message: "moved" },
        check: (error) => expect((error as Error).message).toContain("The page changed"),
      },
      {
        failure: { kind: "moved", message: "moved", items: [{ class: "read", origin: "https://example.com" }] },
        check: (error) => {
          expect(error).toBeInstanceOf(NeedsPermissionError)
          expect((error as NeedsPermissionError).items).toEqual([{ class: "read", origin: "https://example.com" }])
        },
      },
      {
        failure: { kind: "unknown", message: "something odd" },
        check: (error) => expect((error as Error).message).toBe("something odd"),
      },
    ]
    for (const entry of cases) {
      const hub = fake({ call: () => Promise.reject(new BrowserHub.Failure(entry.failure)) })
      const active = backend({ port: hub.port, directory: "/tmp/project" })
      const error = await active
        .callTool("browser_click", { target: "e1" }, ctx())
        .catch((value: unknown) => value)
      entry.check(error)
    }
  })

  test("a dropped connection reports the unavailable message and the uncertainty marker", async () => {
    const hub = fake({
      call: () =>
        Promise.reject(
          new BrowserHub.Failure({ kind: "unavailable", message: "the socket closed", uncertain: true }),
        ),
    })
    const active = backend({ port: hub.port, directory: "/tmp/project" })
    const error = await active.callTool("browser_click", { target: "e1" }, ctx()).catch((value: unknown) => value)
    expect(error).toBeInstanceOf(UnavailableError)
    expect((error as UnavailableError).message).not.toContain("socket")
    expect((error as UnavailableError).effectsUncertain).toBe(true)
  })

  test("an unavailable answer names the next step for why no extension answered", () => {
    const hint = (absence?: BrowserHub.Absence) => {
      const error = map(new BrowserHub.Failure({ kind: "unavailable", message: "not connected", absence }))
      expect(error).toBeInstanceOf(UnavailableError)
      expect(error.message).toBe(UNAVAILABLE_MESSAGE)
      return (error as UnavailableError).hint
    }
    // An extension that was connected and left is installed: the step turns its switch back on, never installs it.
    expect(hint({ kind: "disconnected" })).toContain('turn on "Allow local agents"')
    expect(hint({ kind: "disconnected" })).not.toContain("Install")
    expect(hint({ kind: "unpaired" })).toContain("install it")
    expect(hint({ kind: "unpaired" })).toContain("then try again")
    expect(hint({ kind: "no_profile", profile: "Work" })).toContain('"Work"')
    expect(hint({ kind: "no_hub" })).toContain("try again in a moment")
    // Without an explanation the general step stands.
    expect(hint()).toBe(EXTENSION_HINT)
  })

  test("a stop is sticky: the next call fails stopped and opens no session", async () => {
    const hub = fake()
    const active = backend({ port: hub.port, directory: "/tmp/project" })
    await active.callTool("browser_snapshot", {}, ctx())
    hub.revoke({ sessionHandle: "handle-1", reason: "user_stop" })
    const error = await active.callTool("browser_navigate", {}, ctx()).catch((value: unknown) => value)
    expect((error as Error).message).toBe(STOPPED)
    // Refused before opening: no second session.open reaches the extension.
    expect(hub.opened).toHaveLength(1)
    expect(hub.calls.map((call) => call.sessionHandle)).toEqual(["handle-1"])
  })

  test("only the user's own decisions stop a conversation: a disconnect reopens", async () => {
    for (const reason of ["user_stop", "switch_off"] as const) {
      const hub = fake()
      const active = backend({ port: hub.port, directory: "/tmp/project" })
      await active.callTool("browser_snapshot", {}, ctx())
      hub.revoke({ sessionHandle: "handle-1", reason })
      const error = await active.callTool("browser_snapshot", {}, ctx()).catch((value: unknown) => value)
      expect((error as Error).message).toBe(STOPPED)
      expect(hub.opened).toHaveLength(1)
    }
    // A disconnect is the browser going away, not the user: the next call opens a new session.
    const hub = fake()
    const active = backend({ port: hub.port, directory: "/tmp/project" })
    await active.callTool("browser_snapshot", {}, ctx())
    hub.revoke({ sessionHandle: "handle-1", reason: "disconnect" })
    expect((await active.callTool("browser_snapshot", {}, ctx())).isError).toBe(false)
    expect(hub.opened).toHaveLength(2)
    expect(hub.calls.map((call) => call.sessionHandle)).toEqual(["handle-1", "handle-2"])
  })

  test("another conversation and a new one are unaffected by a stop", async () => {
    const hub = fake()
    const active = backend({ port: hub.port, directory: "/tmp/project" })
    await active.callTool("browser_snapshot", {}, ctx({ session: "ses_stopped" }))
    hub.revoke({ sessionHandle: "handle-1", reason: "user_stop" })
    // Another conversation, and the new conversation the user starts next, both work normally.
    expect((await active.callTool("browser_snapshot", {}, ctx({ session: "ses_other" }))).isError).toBe(false)
    expect((await active.callTool("browser_snapshot", {}, ctx({ session: "ses_fresh" }))).isError).toBe(false)
    expect(hub.opened.map((value) => value.sessionId)).toEqual(["ses_stopped", "ses_other", "ses_fresh"])
  })

  test("a deleted session closes its handle and forgets it", async () => {
    const hub = fake()
    const active = backend({ port: hub.port, directory: "/tmp/project" })
    await active.callTool("browser_snapshot", {}, ctx())
    active.forget("ses_extension")
    await Promise.resolve()
    expect(hub.closed).toEqual(["handle-1"])
    await active.callTool("browser_snapshot", {}, ctx())
    expect(hub.opened).toHaveLength(2)
  })

  test("a file upload becomes chunked uploads the extension refers to", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-upload-"))
    roots.push(root)
    const file = path.join(root, "photo.png")
    const payload = Buffer.alloc(600 * 1024, 7)
    await fs.writeFile(file, payload)
    const hub = fake()
    const active = backend({ port: hub.port, directory: "/tmp/project" })
    await active.callTool("browser_file_upload", { paths: [file] }, ctx())
    expect(hub.began.map((upload) => [upload.name, upload.size, upload.mimeType])).toEqual([
      ["photo.png", payload.byteLength, "image/png"],
    ])
    expect(hub.chunks.map((chunk) => chunk.index)).toEqual([0, 1])
    // The largest frame the protocol allows: base64 of 393 216 bytes is exactly its 524 288-character cap.
    expect(hub.chunks[0]!.data.length).toBe(524_288)
    expect(Buffer.from(hub.chunks[0]!.data, "base64").byteLength).toBe(393_216)
    expect(Buffer.from(hub.chunks[1]!.data, "base64").byteLength).toBe(600 * 1024 - 393_216)
    expect(hub.ended).toEqual([hub.began[0]!.uploadId])
    expect(hub.calls[0]?.arguments.uploads).toEqual([hub.began[0]!.uploadId])
    expect(hub.calls[0]?.arguments.paths).toEqual([file])
  })

  test("a superseded open closes its late handle instead of adopting the new attempt's session", async () => {
    const first = Promise.withResolvers<void>()
    const second = Promise.withResolvers<void>()
    const opened = [Promise.withResolvers<void>(), Promise.withResolvers<void>()]
    const closed: string[] = []
    let attempt = 0
    const hub = fake()
    const port: BrowserHub.Port = {
      ...hub.port,
      open: async () => {
        const index = attempt
        attempt += 1
        opened[index].resolve()
        await (index === 0 ? first.promise : second.promise)
        return { sessionHandle: `handle-${index + 1}` }
      },
      close: (handle) => {
        closed.push(handle)
        return Promise.resolve()
      },
    }
    const active = backend({ port, directory: "/tmp/project" })
    const stale = active.callTool("browser_snapshot", {}, ctx({ session: "ses_race" }))
    await opened[0].promise
    // The session ends and a new call starts a second attempt before the first one answers.
    active.forget("ses_race")
    const fresh = active.callTool("browser_snapshot", {}, ctx({ session: "ses_race" }))
    await opened[1].promise
    second.resolve()
    expect((await fresh).content[0]).toEqual({
      type: "text",
      text: "- Page URL: http://localhost:3000\n- Page Title: Test page",
    })
    first.resolve()
    const error = await stale.catch((value: unknown) => value)
    expect((error as Error).message).toContain("ended before its browser session opened")
    // Only the superseded attempt's handle is closed, and the live session keeps its own.
    expect(closed).toEqual(["handle-1"])
  })

  test("an evicted backend opens nothing for a call that was already in flight", async () => {
    const ready = Promise.withResolvers<BrowserHub.Info>()
    const hub = fake()
    const port: BrowserHub.Port = { ...hub.port, ready: () => ready.promise }
    const active = backend({ port, directory: "/tmp/project" })
    const call = active.callTool("browser_snapshot", {}, ctx())
    // The call is waiting on the tool listing when the backend is evicted.
    await Promise.resolve()
    await active.dispose()
    ready.resolve({
      protocol: [1],
      contractSha: BrowserContract.sha256,
      extensionVersion: "1.0.0",
      profileLabel: "Fake profile",
    })
    const error = await call.catch((value: unknown) => value)
    expect((error as Error).message).toContain("was released")
    expect(hub.opened).toHaveLength(0)
    expect(hub.calls).toHaveLength(0)
  })

  test("dispose releases the revocation subscription and closes its browser sessions", async () => {
    let released = 0
    const closed: string[] = []
    const hub = fake()
    const port: BrowserHub.Port = {
      ...hub.port,
      onRevoked: () => () => {
        released += 1
      },
      close: (handle) => {
        closed.push(handle)
        return Promise.resolve()
      },
    }
    const active = backend({ port, directory: "/tmp/project" })
    await active.callTool("browser_snapshot", {}, ctx())
    await active.dispose()
    expect(released).toBe(1)
    // An evicted backend must not leave a browser session behind.
    expect(closed).toEqual(["handle-1"])
  })

  test("a failed tool listing is retried on the next call instead of cached", async () => {
    const hub = fake({ contractSha: "another" })
    let listings = 0
    const port: BrowserHub.Port = {
      ...hub.port,
      list: () => {
        listings += 1
        if (listings === 1) {
          return Promise.reject(new BrowserHub.Failure({ kind: "unavailable", message: "the hub went away" }))
        }
        return Promise.resolve(BrowserContract.entries.map((entry) => entry.name))
      },
    }
    const active = backend({ port, directory: "/tmp/project" })
    const first = await active.callTool("browser_navigate", {}, ctx()).catch((value: unknown) => value)
    expect(first).toBeInstanceOf(UnavailableError)
    const second = await active.callTool("browser_navigate", {}, ctx())
    expect(second.isError).toBe(false)
    expect(listings).toBe(2)
  })

  test("a session that ends while its browser session opens closes the new handle", async () => {
    const gate = Promise.withResolvers<void>()
    const entering = Promise.withResolvers<void>()
    const closed: string[] = []
    const hub = fake()
    const port: BrowserHub.Port = {
      ...hub.port,
      open: async () => {
        entering.resolve()
        await gate.promise
        return { sessionHandle: "late" }
      },
      close: (handle) => {
        closed.push(handle)
        return Promise.resolve()
      },
    }
    const active = backend({ port, directory: "/tmp/project" })
    const call = active.callTool("browser_snapshot", {}, ctx({ session: "ses_late" }))
    // The session ends while the extension is still answering the open.
    await entering.promise
    active.forget("ses_late")
    gate.resolve()
    const error = await call.catch((value: unknown) => value)
    expect((error as Error).message).toContain("ended before its browser session opened")
    expect(closed).toEqual(["late"])
  })

  test("a file that cannot be read fails before the browser sees the call", async () => {
    const hub = fake()
    const active = backend({ port: hub.port, directory: "/tmp/project" })
    const error = await active
      .callTool("browser_file_upload", { paths: ["/tmp/definitely-missing-kilo-file.png"] }, ctx())
      .catch((value: unknown) => value)
    expect((error as Error).message).toContain("Cannot read")
    expect(hub.calls).toHaveLength(0)
  })

  test("a browser that uploads through its own file chooser keeps the paths and is not asked again", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-upload-"))
    roots.push(root)
    const file = path.join(root, "photo.png")
    await fs.writeFile(file, Buffer.from("bytes"))
    const hub = fake({ refuseUpload: true })
    const active = backend({ port: hub.port, directory: "/tmp/project" })
    const first = await active.callTool("browser_file_upload", { paths: [file] }, ctx())
    expect(first.isError).toBe(false)
    expect(hub.calls[0]?.arguments).toEqual({ paths: [file] })
    expect(hub.calls[0]?.arguments.uploads).toBeUndefined()
    await active.callTool("browser_file_upload", { paths: [file] }, ctx())
    // The refusal is remembered: the second call does not try a transfer the browser already turned down.
    expect(hub.began).toHaveLength(0)
    expect(hub.calls[1]?.arguments.uploads).toBeUndefined()
  })
})

describe("extension wire helpers", () => {
  test("a remembered step token is spent once, on its own step, and expires", () => {
    resetSteps()
    rememberStep("ses_a", "browser_click", { target: "e1" }, "tok")
    expect(takeStep("ses_a", "browser_click", { target: "e1" })).toBe("tok")
    // The next identical call has no token: the browser consumed it.
    expect(takeStep("ses_a", "browser_click", { target: "e1" })).toBeUndefined()

    rememberStep("ses_a", "browser_click", { target: "e1" }, "tok")
    expect(takeStep("ses_b", "browser_click", { target: "e1" })).toBeUndefined()
    expect(takeStep("ses_a", "browser_type", { target: "e1" })).toBeUndefined()
    expect(takeStep("ses_a", "browser_click", { target: "e2" })).toBeUndefined()
    expect(takeStep("ses_a", "browser_click", { target: "e1" })).toBe("tok")

    rememberStep("ses_a", "browser_click", { target: "e1" }, "tok", -1)
    expect(takeStep("ses_a", "browser_click", { target: "e1" })).toBeUndefined()
  })

  test("grants drop what the CLI cannot parse", () => {
    expect(grants(["read:https://example.com", "bogus", "act:not a url"])).toEqual([
      { class: "read", origin: "https://example.com" },
    ])
  })

  test("needs keeps frames and reasons and refuses an unknown class", () => {
    expect(needs([{ class: "read", origin: "https://example.com", frame: true, reason: "iframe" }])).toEqual([
      { class: "read", origin: "https://example.com", frame: true, reason: "iframe" },
    ])
    expect(needs([{ class: "sudo", origin: "https://example.com" }])).toBeUndefined()
    expect(needs([{ class: "read" }])).toBeUndefined()
    expect(needs("nope")).toBeUndefined()
  })

  test("map leaves an already model-facing failure alone", () => {
    const original = new UnavailableError("hint")
    expect(map(original)).toBe(original)
    expect(map(new NeedsPermissionError([]))).toBeInstanceOf(NeedsPermissionError)
    expect(map("plain")).toBeInstanceOf(Error)
  })
})
