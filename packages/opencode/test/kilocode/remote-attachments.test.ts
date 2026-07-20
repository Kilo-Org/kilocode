import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { RemoteAttachments } from "../../src/kilocode/remote-attachments"
import { SessionID } from "../../src/session/schema"

async function tmpRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "remote-attachments-test-"))
}

const nolog = {
  warn: () => {},
  error: () => {},
}

function okResponse(body: Uint8Array | string, init: ResponseInit = {}): Response {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body
  return new Response(bytes as BodyInit, { status: 200, ...init })
}

function jsonResponse(status: number) {
  return new Response(JSON.stringify({ ok: false }), { status })
}

describe("RemoteAttachments.classify / EXTENSION_MIME", () => {
  test("every table entry classifies to its declared MIME", () => {
    for (const [ext, mime] of Object.entries(RemoteAttachments.EXTENSION_MIME)) {
      const r = RemoteAttachments.classify(`file.${ext}`)
      expect(r.mime).toBe(mime)
      expect(r.extension).toBe(ext)
    }
  })

  test("fallback returns application/octet-stream for unknown extensions", () => {
    const r = RemoteAttachments.classify("file.xyz")
    expect(r.mime).toBe("application/octet-stream")
    expect(r.extension).toBe("xyz")
  })

  test("extensionless file falls back to bin → application/octet-stream", () => {
    const r = RemoteAttachments.classify("README")
    expect(r.extension).toBe("bin")
    expect(r.mime).toBe("application/octet-stream")
  })

  test("undefined filename falls back to bin → application/octet-stream", () => {
    const r = RemoteAttachments.classify(undefined)
    expect(r.extension).toBe("bin")
    expect(r.mime).toBe("application/octet-stream")
  })

  test("dot-suffix file (no extension chars) falls back to bin", () => {
    const r = RemoteAttachments.classify("file.")
    expect(r.extension).toBe("bin")
    expect(r.mime).toBe("application/octet-stream")
  })

  test("case-insensitive extension lookup", () => {
    const r = RemoteAttachments.classify("PHOTO.PNG")
    expect(r.extension).toBe("png")
    expect(r.mime).toBe("image/png")
  })

  test("cross-surface: a valid extension not in the canonical table is the binary fallback", () => {
    // `.weirdo` is a real, safe single-token extension but not in EXTENSION_MIME,
    // so it must classify as the binary fallback (no MIME-based extension inference).
    const r = RemoteAttachments.classify("attachment.weirdo")
    expect(r.extension).toBe("weirdo")
    expect(r.mime).toBe("application/octet-stream")
    expect(RemoteAttachments.mimeFor("weirdo")).toBe("application/octet-stream")
  })

  test("safeExtension rejects path-traversal and oversized tokens", () => {
    expect(RemoteAttachments.safeExtension("../../etc/passwd")).toBe("bin")
    expect(RemoteAttachments.safeExtension("a/b")).toBe("bin")
    expect(RemoteAttachments.safeExtension("a b")).toBe("bin")
    expect(RemoteAttachments.safeExtension("a".repeat(17))).toBe("bin")
    expect(RemoteAttachments.safeExtension("png")).toBe("png")
  })
})

describe("RemoteAttachments.isFetchable", () => {
  test("matches http and https", () => {
    expect(RemoteAttachments.isFetchable("https://r2.example/abc")).toBe(true)
    expect(RemoteAttachments.isFetchable("http://r2.example/abc")).toBe(true)
    expect(RemoteAttachments.isFetchable("HTTPS://r2.example/abc")).toBe(true)
  })

  test("rejects non-http schemes", () => {
    expect(RemoteAttachments.isFetchable("data:text/plain,hi")).toBe(false)
    expect(RemoteAttachments.isFetchable("file:///etc/passwd")).toBe(false)
    expect(RemoteAttachments.isFetchable("ftp://r2.example/abc")).toBe(false)
  })
})

describe("RemoteAttachments.failureText", () => {
  test("uses filename when provided", () => {
    const t = RemoteAttachments.failureText("report.csv", "boom")
    expect(t).toEqual({ type: "text", text: "attachment report.csv could not be retrieved: boom" })
  })

  test("uses generic label when filename is missing", () => {
    const t = RemoteAttachments.failureText(undefined, "boom")
    expect(t.text).toContain("attachment attachment could not be retrieved")
  })
})

describe("RemoteAttachments.dataUrl", () => {
  test("encodes bytes as base64 with the right mime prefix", () => {
    const bytes = new TextEncoder().encode("hello world")
    const url = RemoteAttachments.dataUrl("text/plain", bytes)
    expect(url.startsWith("data:text/plain;base64,")).toBe(true)
    const base64 = url.slice("data:text/plain;base64,".length)
    expect(Buffer.from(base64, "base64").toString("utf8")).toBe("hello world")
  })
})

describe("RemoteAttachments.fetchOne safety", () => {
  test("rejects http:// (not https)", async () => {
    let f: any
    try {
      await expect(
        RemoteAttachments.fetchOne("http://r2.example/abc", {
          fetch: (f = async () => okResponse("x")),
        }),
      ).rejects.toMatchObject({ kind: "https" })
    } finally {
      void f
    }
  })

  test("rejects malformed URL", async () => {
    await expect(
      RemoteAttachments.fetchOne("not a url", { fetch: async () => okResponse("x") }),
    ).rejects.toMatchObject({ kind: "https" })
  })

  test("rejects redirects by passing redirect: error", async () => {
    let captured: RequestInit | undefined
    const f = async (_url: string, init?: RequestInit) => {
      captured = init
      // Simulate fetch rejecting when redirect: error + a redirect response
      const err = new TypeError("Failed to fetch: redirect not allowed")
      throw err
    }
    await expect(RemoteAttachments.fetchOne("https://r2.example/abc", { fetch: f })).rejects.toMatchObject({
      kind: "redirect",
    })
    expect(captured?.redirect).toBe("error")
  })

  test("rejects non-2xx responses", async () => {
    const f = async () => jsonResponse(404)
    await expect(RemoteAttachments.fetchOne("https://r2.example/missing", { fetch: f })).rejects.toMatchObject({
      kind: "non-2xx",
      status: 404,
    })
  })

  test("aborts + rejects when body exceeds MAX_BYTES", async () => {
    const oversize = new Uint8Array(RemoteAttachments.MAX_BYTES)
    // Build a stream that yields the entire oversize buffer in one chunk so the
    // bounded reader trips the overflow guard.
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(oversize)
        controller.close()
      },
    })
    const f = async () => new Response(stream, { status: 200 })
    await expect(RemoteAttachments.fetchOne("https://r2.example/big", { fetch: f })).rejects.toMatchObject({
      kind: "overflow",
    })
  })

  test("aborts + rejects on timeout", async () => {
    // A never-resolving fetch should be aborted by the timeout.
    const f = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"))
        })
      })
    await expect(
      RemoteAttachments.fetchOne("https://r2.example/slow", { fetch: f, timeoutMs: 25 }),
    ).rejects.toMatchObject({ kind: "timeout" })
  })

  test("forwards credentials: omit (no cookies on the wire)", async () => {
    let captured: RequestInit | undefined
    const f = async (_url: string, init?: RequestInit) => {
      captured = init
      return okResponse("hi")
    }
    await RemoteAttachments.fetchOne("https://r2.example/abc", { fetch: f })
    expect(captured?.credentials).toBe("omit")
  })
})

describe("RemoteAttachments.create().materialize", () => {
  test("returns the input list when it has no file parts", async () => {
    const root = await tmpRoot()
    try {
      const r = RemoteAttachments.create({ sessionID: SessionID.make("ses_a"), tmpRoot: root, log: nolog })
      const out = await r.materialize([{ type: "text", text: "hi" }])
      expect(out).toEqual([{ type: "text", text: "hi" }])
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("passes through non-fetchable URLs unchanged (data:, file:)", async () => {
    const root = await tmpRoot()
    try {
      const r = RemoteAttachments.create({ sessionID: SessionID.make("ses_a"), tmpRoot: root, log: nolog })
      const part = { type: "file" as const, mime: "image/png", filename: "a.png", url: "data:image/png;base64,AAAA" }
      const out = await r.materialize([part])
      expect(out).toEqual([part])
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("fetches a CSV and canonicalizes it to a text/plain data: URL", async () => {
    const root = await tmpRoot()
    try {
      const f = async (url: string) => okResponse("a,b\n1,2\n")
      const r = RemoteAttachments.create({
        sessionID: SessionID.make("ses_csv"),
        tmpRoot: root,
        fetch: f,
        log: nolog,
      })
      const out = await r.materialize([
        { id: "att-csv", type: "file", mime: "text/csv", filename: "report.csv", url: "https://r2.example/report.csv" },
      ])
      expect(out).toHaveLength(1)
      const file = out[0] as any
      expect(file.type).toBe("file")
      expect(file.id).toBe("att-csv")
      expect(file.mime).toBe("text/plain")
      expect(file.filename).toBe("report.csv")
      expect(file.url).toStartWith("data:text/plain;base64,")
      expect(file.source).toEqual({ type: "remote", url: "https://r2.example/report.csv" })
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("fetches a PNG and emits an image/png data: URL file part", async () => {
    const root = await tmpRoot()
    try {
      const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
      const f = async () => okResponse(pngBytes)
      const r = RemoteAttachments.create({
        sessionID: SessionID.make("ses_png"),
        tmpRoot: root,
        fetch: f,
        log: nolog,
      })
      const out = await r.materialize([
        { id: "att-png", type: "file", mime: "image/png", filename: "photo.png", url: "https://r2.example/photo.png" },
      ])
      expect(out).toHaveLength(1)
      const file = out[0] as any
      expect(file.type).toBe("file")
      expect(file.mime).toBe("image/png")
      expect(file.url).toStartWith("data:image/png;base64,")
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("fetches a PDF and emits an application/pdf data: URL file part (NOT generic binary)", async () => {
    const root = await tmpRoot()
    try {
      const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]) // %PDF
      const f = async () => okResponse(pdfBytes)
      const r = RemoteAttachments.create({
        sessionID: SessionID.make("ses_pdf"),
        tmpRoot: root,
        fetch: f,
        log: nolog,
      })
      const out = await r.materialize([
        { id: "att-pdf", type: "file", mime: "application/pdf", filename: "doc.pdf", url: "https://r2.example/doc.pdf" },
      ])
      expect(out).toHaveLength(1)
      const file = out[0] as any
      expect(file.type).toBe("file")
      expect(file.mime).toBe("application/pdf")
      expect(file.url).toStartWith("data:application/pdf;base64,")
      // No text part was emitted — the PDF falls through to the existing resolvePart path.
      const dir = path.join(root, RemoteAttachments.SCRATCH_DIRNAME, "ses_pdf")
      const entries = await fs.readdir(dir).catch(() => [] as string[])
      expect(entries).toEqual([])
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("writes a generic binary attachment to the scratch dir and emits a text part with absolute path", async () => {
    const root = await tmpRoot()
    try {
      const bin = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7])
      const f = async () => okResponse(bin)
      const r = RemoteAttachments.create({
        sessionID: SessionID.make("ses_bin"),
        tmpRoot: root,
        fetch: f,
        log: nolog,
      })
      const out = await r.materialize([
        { id: "att-bin", type: "file", mime: "application/octet-stream", filename: "blob.bin", url: "https://r2.example/blob.bin" },
      ])
      expect(out).toHaveLength(1)
      const text = out[0] as any
      expect(text.type).toBe("text")
      expect(text.text).toContain(path.join(root, RemoteAttachments.SCRATCH_DIRNAME, "ses_bin", "att-bin.bin"))
      expect(text.text).toContain("filename: blob.bin")
      expect(text.text).toContain("mime: application/octet-stream")
      expect(text.text).toContain(`size: ${bin.byteLength} bytes`)

      const dir = path.join(root, RemoteAttachments.SCRATCH_DIRNAME, "ses_bin")
      const entries = await fs.readdir(dir)
      expect(entries).toEqual(["att-bin.bin"])
      const written = await fs.readFile(path.join(dir, "att-bin.bin"))
      expect(Array.from(written)).toEqual(Array.from(bin))
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("basename is derived from attachmentId and validated extension, NOT from the client filename", async () => {
    const root = await tmpRoot()
    try {
      const f = async () => okResponse(new Uint8Array([0]))
      const r = RemoteAttachments.create({
        sessionID: SessionID.make("ses_trav"),
        tmpRoot: root,
        fetch: f,
        log: nolog,
      })
      // Filename contains a path-separator attempt and an extension that
      // safeExtension would sanitize. The actual on-disk basename must use
      // the part's id and the sanitized "bin" extension.
      const out = await r.materialize([
        {
          id: "att-trav",
          type: "file",
          mime: "application/octet-stream",
          filename: "../../../etc/passwd",
          url: "https://r2.example/x.bin",
        },
      ])
      const text = out[0] as any
      expect(text.text).toContain("att-trav.bin")
      // Confirm the file landed in the session scratch dir, NOT somewhere else.
      const dir = path.join(root, RemoteAttachments.SCRATCH_DIRNAME, "ses_trav")
      const entries = await fs.readdir(dir)
      expect(entries).toEqual(["att-trav.bin"])
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("generates a uuid basename when attachmentId is missing", async () => {
    const root = await tmpRoot()
    try {
      const f = async () => okResponse(new Uint8Array([0]))
      const r = RemoteAttachments.create({
        sessionID: SessionID.make("ses_noid"),
        tmpRoot: root,
        fetch: f,
        log: nolog,
      })
      const out = await r.materialize([
        { type: "file", mime: "application/octet-stream", filename: "blob.bin", url: "https://r2.example/blob.bin" },
      ])
      const text = out[0] as any
      const dir = path.join(root, RemoteAttachments.SCRATCH_DIRNAME, "ses_noid")
      const entries = await fs.readdir(dir)
      expect(entries).toHaveLength(1)
      const name = entries[0]!
      expect(name.endsWith(".bin")).toBe(true)
      expect(name).not.toContain("blob")
      expect(text.text).toContain(name)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("replaces a failed attachment with an explanatory text part and keeps the rest of the prompt", async () => {
    const root = await tmpRoot()
    try {
      const f = async (url: string) => {
        if (url.endsWith("good.png")) return okResponse(new Uint8Array([1, 2, 3]))
        return jsonResponse(500)
      }
      const r = RemoteAttachments.create({
        sessionID: SessionID.make("ses_mix"),
        tmpRoot: root,
        fetch: f,
        log: nolog,
      })
      const out = await r.materialize([
        { type: "text", text: "see attached" },
        { type: "file", mime: "image/png", filename: "good.png", url: "https://r2.example/good.png" },
        { type: "file", mime: "image/png", filename: "bad.png", url: "https://r2.example/bad.png" },
      ])
      expect(out).toHaveLength(3)
      expect((out[0] as any).type).toBe("text")
      expect((out[1] as any).type).toBe("file")
      expect((out[2] as any).type).toBe("text")
      expect((out[2] as any).text).toContain("attachment bad.png could not be retrieved")
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("materialize after dispose returns the input list unchanged", async () => {
    const root = await tmpRoot()
    try {
      const r = RemoteAttachments.create({ sessionID: SessionID.make("ses_d"), tmpRoot: root, log: nolog })
      await r.dispose()
      const out = await r.materialize([
        { type: "file", mime: "image/png", filename: "x.png", url: "https://r2.example/x.png" },
      ])
      expect(out).toEqual([
        { type: "file", mime: "image/png", filename: "x.png", url: "https://r2.example/x.png" },
      ])
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})

describe("RemoteAttachments.cleanupSession", () => {
  test("removes the per-session scratch directory", async () => {
    const root = await tmpRoot()
    try {
      const dir = path.join(root, RemoteAttachments.SCRATCH_DIRNAME, "ses_cleanup")
      await fs.mkdir(dir, { recursive: true, mode: 0o700 })
      await fs.writeFile(path.join(dir, "x.bin"), new Uint8Array([1]))
      await RemoteAttachments.cleanupSession(SessionID.make("ses_cleanup"), { tmpRoot: root, log: nolog })
      const exists = await fs
        .stat(path.join(root, RemoteAttachments.SCRATCH_DIRNAME, "ses_cleanup"))
        .then(() => true)
        .catch(() => false)
      expect(exists).toBe(false)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test("is a no-op when the directory does not exist", async () => {
    const root = await tmpRoot()
    try {
      await expect(
        RemoteAttachments.cleanupSession(SessionID.make("ses_missing"), { tmpRoot: root, log: nolog }),
      ).resolves.toBeUndefined()
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
