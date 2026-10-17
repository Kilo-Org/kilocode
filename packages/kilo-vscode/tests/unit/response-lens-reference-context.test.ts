import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { link, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createRequire } from "node:module"
import { build } from "esbuild"
import type { Input, Output } from "../fixtures/response-lens-reference-context"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const require = createRequire(import.meta.url)
let temp: string
let fixture: string

beforeAll(async () => {
  const parent = join(tmpdir(), "kilo")
  await mkdir(parent, { recursive: true })
  temp = await mkdtemp(join(parent, "response-lens-reference-context-"))
  fixture = join(temp, "reference-context.cjs")
  const cfg = require(join(root, "esbuild.js")).getDocumentWorkerConfig()
  await Promise.all([
    build({
      ...cfg,
      absWorkingDir: root,
      outfile: join(temp, "response-lens-document-worker.mjs"),
      sourcemap: false,
      minify: true,
    }),
    build({
      entryPoints: [join(root, "tests/fixtures/response-lens-reference-context.ts")],
      outfile: fixture,
      bundle: true,
      platform: "node",
      format: "cjs",
      target: "node22",
      logLevel: "silent",
    }),
  ])
}, 60_000)

afterAll(async () => {
  if (temp) await rm(temp, { recursive: true, force: true })
})

async function project(files: Record<string, string | Uint8Array> = {}) {
  const base = await mkdtemp(join(temp, "case-"))
  const directory = join(base, "project")
  await mkdir(directory)
  for (const [name, text] of Object.entries(files)) {
    const file = join(directory, name)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, text)
  }
  return { directory, base }
}

function run(input: Input): Output {
  const result = spawnSync("node", [fixture], {
    input: JSON.stringify(input),
    encoding: "utf8",
    windowsHide: true,
    timeout: 15_000,
    maxBuffer: 2 * 1024 * 1024,
    env: {
      ELECTRON_RUN_AS_NODE: "1",
      SystemRoot: process.env.SystemRoot ?? process.env.SYSTEMROOT ?? "",
      PATH: process.env.PATH ?? "",
    },
  })
  expect(result.error, result.stderr).toBeUndefined()
  expect(result.status, result.stdout + result.stderr).toBe(0)
  const output: Output = JSON.parse(result.stdout)
  expect(output.unchanged).toBe(true)
  expect(output.io.filter((item) => /readdir|opendir|scandir/i.test(item.stack))).toEqual([])
  return output
}

const file = (target: string) => ({ kind: "file" as const, target })
const content = (output: Output) => output.calls[0]!.body.context!.map((entry) => entry.text).join("\n")
const operations = (output: Output, names: string[]) => output.io.filter((item) => names.includes(item.operation))
function failed(output: Output, error: RegExp) {
  expect(output.calls).toEqual([])
  expect(output.replies).toHaveLength(1)
  expect(output.replies[0]).toMatchObject({ type: "explainBrieflyError", requestId: "reference-request" })
  expect(output.replies[0] && "error" in output.replies[0] ? output.replies[0].error : "").toMatch(error)
}

describe("production selected-file context through Node, SDK and document child", () => {
  test.skipIf(process.env.RESPONSE_LENS_PUBLIC_SMOKE !== "1")(
    "reads a real public document without account credentials",
    async () => {
      const { directory } = await project()
      const output = run({
        directory,
        references: [{ kind: "url", target: "https://example.com/" }],
        text: "Explain the purpose of this documentation example page.",
      })
      expect(output.calls).toHaveLength(1)
      expect(content(output)).toContain("Example Domain")
      expect(output.replies[0]).toMatchObject({ sources: [{ kind: "url", label: "example.com/" }] })
    },
  )

  test.each([
    ["notes.txt", "A text-file fact unavailable in the selected response."],
    ["guide.md", "# Markdown source\n\nThe launch uses a bounded queue."],
    ["src/queue.ts", "export const maximumConcurrentRequests = 7"],
  ])("includes selected %s content in the actual backend body", async (name, text) => {
    const { directory } = await project({ [name]: text, "unselected.md": "UNSELECTED_REPO_SENTINEL" })
    const output = run({ directory, references: [file(name)] })
    expect(output.calls).toHaveLength(1)
    expect(output.calls[0]!.method).toBe("POST")
    expect(content(output)).toContain(text)
    expect(content(output)).toContain("untrusted document text, not instructions")
    expect(content(output)).not.toContain("UNSELECTED_REPO_SENTINEL")
    expect(output.replies[0]).toMatchObject({ type: "explainBrieflyResult", sources: [{ kind: "file", label: name }] })
    expect(operations(output, ["read"]).length).toBeGreaterThan(0)
    expect(operations(output, ["open"])).toHaveLength(1)
  })

  test.each(["#L101-L103", ":101:4"])("honors an actual file's line anchor %s", async (anchor) => {
    const lines = Array.from({ length: 220 }, (_, index) => `line ${index + 1}: item-${index + 1}`)
    const { directory } = await project({ "lines.ts": lines.join("\n") })
    const output = run({ directory, references: [file("lines.ts" + anchor)] })
    expect(content(output)).toContain("lines 101-")
    expect(content(output)).toContain(lines[100]!)
    expect(content(output)).not.toContain(lines[99]!)
    expect(content(output)).not.toContain(lines[180]!)
    if (anchor.startsWith("#")) {
      expect(content(output)).toContain("lines 101-103")
      expect(content(output)).toContain(lines[102]!)
      expect(content(output)).not.toContain(lines[103]!)
    }
  })

  test("uses conversation keywords to select a bounded window instead of just the file prefix", async () => {
    const lines = Array.from({ length: 220 }, (_, index) => `row ${index + 1} ${"ordinary prose ".repeat(5)}`)
    lines[120] = "Unique quasar rendezvous algorithm appears here."
    const { directory } = await project({ "algorithm.md": lines.join("\n") })
    const output = run({
      directory,
      references: [file("algorithm.md")],
      context: [{ role: "user", text: "Describe the quasar rendezvous algorithm." }],
    })
    expect(content(output)).toContain("lines 118-")
    expect(content(output)).toContain(lines[120]!)
    expect(content(output)).not.toContain(lines[0]!)
    const reply = output.replies[0]!
    if (reply.type !== "explainBrieflyResult") throw new Error(reply.error)
    expect(reply.sources![0]!.chars).toBeLessThanOrEqual(2500)
    expect(reply.sources![0]!.truncated).toBe(true)
  })

  test.each([
    ["\n\nfirst\nsecond\nCHOSEN_ORIGINAL_LINE\nlast", "#L5-L5"],
    ["first\n\n\nsecond\nCHOSEN_ORIGINAL_LINE\nlast", "#L5-L5"],
  ])("line anchors retain original blank-line positions", async (text, anchor) => {
    const { directory } = await project({ "source.ts": text })
    const output = run({ directory, references: [file("source.ts" + anchor)] })
    expect(output.calls).toHaveLength(1)
    expect(content(output)).toContain("CHOSEN_ORIGINAL_LINE")
    expect(content(output)).not.toContain("\nlast")
    expect(output.replies[0]).toMatchObject({ sources: [{ detail: "lines 5-5" }] })
  })

  test("canonicalizes dot segments and file URLs with spaces to the selected source", async () => {
    const { directory } = await project({ "docs/Selected file.ts": "first line\nCanonical source value." })
    const uri = pathToFileURL(join(directory, "docs/Selected file.ts"))
    uri.hash = "L2"
    const output = run({ directory, references: [file("docs/../docs/Selected file.ts#L2"), file(uri.href)] })
    expect(output.replies[0]).toMatchObject({
      sources: [
        { label: "docs/Selected file.ts", detail: "lines 2-2" },
        { label: "docs/Selected file.ts", detail: "lines 2-2" },
      ],
    })
    expect(
      output.calls[0]!.body.context!.filter((entry) => entry.text.includes("Canonical source value.")),
    ).toHaveLength(2)
    expect(output.approvals).toEqual([])
  })

  test.each(["resolve", undefined] as const)(
    "bounds two references and conversation context to 8000 via %s",
    async (action) => {
      const { directory } = await project({ "one.md": "A".repeat(4000), "two.ts": "B".repeat(4000) })
      const context = Array.from({ length: 4 }, (_, index) => ({
        role: "user" as const,
        text: `${index}:` + "c".repeat(1998),
      }))
      const output = run({ directory, references: [file("one.md"), file("two.ts")], context, action })
      const composed = action ? output.resolved!.context : output.calls[0]!.body.context!
      expect(composed).toHaveLength(4)
      expect(composed.slice(0, 2).map((entry) => entry.text.length)).toEqual([1000, 1000])
      expect(composed.reduce((sum, entry) => sum + entry.text.length, 0)).toBeLessThanOrEqual(8000)
      expect(composed[2]!.text).toContain("A".repeat(2500))
      expect(composed[3]!.text).toContain("B".repeat(2500))
      expect(composed.some((entry) => entry.text.startsWith("2:") || entry.text.startsWith("3:"))).toBe(false)
    },
  )

  test("redacts synthetic sensitive values while retaining useful file text", async () => {
    const values = ["sk-" + "a1".repeat(18), "ghp_" + "b2".repeat(18), "pretend-password", "fake-user:fake-pass"]
    const text = `Useful public explanation.\n${values[0]}\n${values[1]}\npassword=${values[2]}\nhttps://${values[3]}@example.invalid/docs\n-----BEGIN PRIVATE KEY-----\nSYNTHETIC_PRIVATE_MATERIAL\n-----END PRIVATE KEY-----`
    const { directory } = await project({ "example.md": text })
    const output = run({ directory, references: [file("example.md")] })
    expect(content(output)).toContain("Useful public explanation.")
    expect(content(output)).toContain("[redacted]")
    for (const value of [...values, "SYNTHETIC_PRIVATE_MATERIAL"])
      expect(JSON.stringify(output.calls)).not.toContain(value)
  })

  test("redacts a token spanning the excerpt cutoff rather than disclosing its prefix", async () => {
    const { directory } = await project({ "example.md": "x".repeat(2489) + " sk-" + "a1".repeat(18) })
    const output = run({ directory, references: [file("example.md")] })
    expect(output.calls).toHaveLength(1)
    expect(content(output)).not.toContain("sk-a1")
    expect(content(output)).toContain("[redacted]")
  })

  test("line selection inside a private-key block cannot expose its synthetic body", async () => {
    const { directory } = await project({
      "example.md":
        "-----BEGIN PRIVATE KEY-----\nSYNTHETIC_PRIVATE_MATERIAL\n-----END PRIVATE KEY-----\nUseful explanation.",
    })
    const output = run({ directory, references: [file("example.md#L2-L2")] })
    expect(output.calls).toHaveLength(1)
    expect(content(output)).not.toContain("SYNTHETIC_PRIVATE_MATERIAL")
    expect(content(output)).toContain("[redacted]")
  })

  test("a parser-truncated token cannot leak through a later line anchor", async () => {
    const { directory } = await project({ "example.md": "x".repeat(99988) + "\nsk-" + "a1".repeat(18) })
    const output = run({ directory, references: [file("example.md#L2-L2")] })
    expect(output.calls).toHaveLength(1)
    expect(content(output)).not.toContain("sk-a1")
    expect(content(output)).toContain("[redacted]")
  })
})

describe("production failure gates before inference", () => {
  test("without explicit references, literal file mentions do not cause filesystem discovery", async () => {
    const { directory } = await project({ "mentioned.md": "UNSELECTED_FILE_BODY" })
    const context = [{ role: "assistant" as const, text: "The literal @mentioned.md is not an attachment." }]
    const output = run({ directory, text: "Discuss mentioned.md", context })
    expect(output.calls).toHaveLength(1)
    expect(output.calls[0]!.body.context).toEqual(context)
    expect(output.io).toEqual([])
    expect(content(output)).not.toContain("UNSELECTED_FILE_BODY")
  })

  test.each(["missing.md", "duplicate.md"])("does not search the repository to guess %s", async (target) => {
    const { directory } = await project({ "a/duplicate.md": "FIRST_UNSELECTED", "b/duplicate.md": "SECOND_UNSELECTED" })
    const output = run({ directory, references: [file(target)] })
    failed(output, /not found|exact path|ENOENT/i)
    expect(operations(output, ["open", "read"])).toEqual([])
    expect(output.io.length).toBeLessThanOrEqual(3)
  })

  test("ambiguous captured-session routing fails before any filesystem or model access", async () => {
    const { directory } = await project({ "selected.md": "must not be read" })
    const output = run({ directory, route: null, references: [file("selected.md")] })
    failed(output, /ambiguous/i)
    expect(output.io).toEqual([])
    expect(output.ids).toEqual(["captured-session"])
  })

  test.each(["resolve", undefined] as const)("rejects three references before IO via %s", async (action) => {
    const { directory } = await project({ "one.md": "first", "two.md": "second", "three.md": "third" })
    const output = run({ directory, references: [file("one.md"), file("two.md"), file("three.md")], action })
    if (action) expect(output.error).toMatch(/at most two/i)
    else failed(output, /invalid explanation request/i)
    expect(output.io).toEqual([])
    expect(output.calls).toEqual([])
  })

  test.each([
    ".env",
    ".env.local",
    "auth.json",
    "credentials.json",
    "token.json",
    "gcp-oauth.keys.json",
    "client_secret_fixture.json",
    ".npmrc",
    ".netrc",
    ".git-credentials",
    "id_rsa",
    "id_ed25519",
    "private.pem",
    "client.p12",
    "account.sqlite",
    "config/keys.txt",
    ".config/kilo/kilo.jsonc",
    ".gmail-mcp/synthetic.txt",
    ".kleinanzeigen_api/synthetic.txt",
    ".aws/synthetic.txt",
    ".ssh/synthetic.txt",
    ".docker/config.json",
    ".kilo/agent-manager.json",
  ])("rejects protected %s before even reading project metadata", async (target) => {
    const { directory } = await project({ [target]: "SYNTHETIC_ONLY_NOT_ACCOUNT_DATA" })
    const output = run({ directory, references: [file(target)], approval: "allow" })
    failed(output, /protected/i)
    expect(output.io).toEqual([])
    expect(output.approvals).toEqual([])
  })

  test("permits a sanitized .env.example without permitting real environment files", async () => {
    const { directory } = await project({ ".env.example": "Documentation example\npassword=synthetic-example" })
    const output = run({ directory, references: [file(".env.example")] })
    expect(content(output)).toContain("Documentation example")
    expect(content(output)).not.toContain("synthetic-example")
  })

  test.each([".kiloignore", ".kilocodeignore"])(
    "respects %s exclusions and explicit exceptions before opening selected files",
    async (name) => {
      const { directory } = await project({
        [name]: "private/**\n!private/public.md\n",
        "private/blocked.md": "DENIED_BODY",
        "private/public.md": "PUBLIC_BODY",
      })
      const denied = run({ directory, references: [file("private/blocked.md")] })
      failed(denied, /ignore rules|excluded/i)
      expect(operations(denied, ["open"])).toHaveLength(1)
      const allowed = run({ directory, references: [file("private/public.md")] })
      expect(content(allowed)).toContain("PUBLIC_BODY")
      expect(operations(allowed, ["open"])).toHaveLength(2)
    },
  )

  test("rejects traversal without requesting external approval or opening any file", async () => {
    const { directory, base } = await project()
    await writeFile(join(base, "outside.md"), "EXTERNAL_BODY")
    const output = run({ directory, references: [file("../outside.md")], approval: "allow" })
    failed(output, /cannot escape/i)
    expect(output.approvals).toEqual([])
    expect(operations(output, ["open", "read", "lstat"])).toEqual([])
  })

  test.each([
    "\\\\unreachable.invalid\\share\\file.md",
    "//unreachable.invalid/share/file.md",
    "\\\\?\\C:\\file.md",
    "\\\\.\\NUL",
    "NUL.txt",
    "COM1",
    "selected.md:stream",
    "file://unreachable.invalid/share/file.md",
  ])("denies UNC, device or ADS target %s before IO", async (target) => {
    const { directory } = await project()
    const output = run({ directory, references: [file(target)], approval: "allow" })
    failed(output, /protected|shares|device/i)
    expect(output.io).toEqual([])
    expect(output.approvals).toEqual([])
  })

  test("rejects a real directory symlink or Windows junction without following it", async () => {
    const { directory, base } = await project()
    const outside = join(base, "outside")
    await mkdir(outside)
    await writeFile(join(outside, "selected.md"), "JUNCTION_BODY")
    await symlink(outside, join(directory, "linked"), process.platform === "win32" ? "junction" : "dir")
    const output = run({ directory, references: [file("linked/selected.md")], approval: "allow" })
    failed(output, /symlink/i)
    expect(operations(output, ["open", "read"])).toEqual([])
    expect(output.approvals).toEqual([])
  })

  test("rejects an actual hardlink before reading bytes", async () => {
    const { directory } = await project({ "original.md": "HARDLINK_BODY" })
    await link(join(directory, "original.md"), join(directory, "linked.md"))
    const output = run({ directory, references: [file("linked.md")] })
    failed(output, /hardlinked/i)
    expect(operations(output, ["open"])).toHaveLength(1)
    expect(operations(output, ["read"])).toEqual([])
  })

  test.each([
    ["empty.txt", "", /1 byte|extractable/i],
    ["binary.txt", new Uint8Array([0, 1, 2]), /binary|unsupported/i],
    ["bad-utf8.md", new Uint8Array([255]), /malformed|unsupported/i],
    ["broken.pdf", "%PDF-broken", /malformed|unsupported/i],
    ["broken.docx", "not an OOXML container", /malformed|unsupported/i],
    ["empty.html", "<script>no readable body</script>", /extractable/i],
    ["program.exe", "not a text document", /binary/i],
    ["oversize.txt", "x".repeat(1024 * 1024 + 1), /1 MiB/i],
  ] as const)("surfaces document failure for %s without calling the model", async (name, text, error) => {
    const { directory } = await project({ [name]: text })
    failed(run({ directory, references: [file(name)] }), error)
  })

  test.each([
    "https://127.0.0.1/private",
    "https://localhost/private",
    "https://169.254.169.254/latest/meta-data",
    "https://example.invalid/docs",
  ])("binds the production URL rejection to visible handler failure: %s", async (target) => {
    const { directory } = await project()
    const output = run({ directory, references: [{ kind: "url", target }] })
    failed(output, /private-network|local-service/i)
    expect(output.io).toEqual([])
  })

  test.each([file("broken.pdf"), { kind: "url" as const, target: "https://127.0.0.1/private" }])(
    "a failed second reference prevents inference with a partial first source",
    async (second) => {
      const { directory } = await project({ "one.md": "READABLE_FIRST_SOURCE", "broken.pdf": "%PDF-broken" })
      const output = run({ directory, references: [file("one.md"), second] })
      failed(output, /malformed|unsupported|private-network/i)
      expect(operations(output, ["read"]).length).toBeGreaterThan(0)
    },
  )
})

describe("external reference approval and captured request identity", () => {
  test("uses an approved absolute external file and reports only its canonical basename", async () => {
    const { directory, base } = await project()
    const target = join(base, "Outside document.md")
    await writeFile(target, "APPROVED_EXTERNAL_BODY")
    const output = run({ directory, references: [file(target)], approval: "allow" })
    expect(output.approvals).toEqual([{ file: await realpath(target), operations: expect.any(Number) }])
    expect(content(output)).toContain("APPROVED_EXTERNAL_BODY")
    expect(content(output)).not.toContain(base)
    expect(output.replies[0]).toMatchObject({ sources: [{ label: "Outside document.md" }] })
    expect(output.io.slice(0, output.approvals[0]!.operations).map((item) => item.operation)).toEqual(["realpath"])
  })

  test.each([true, false])("denial happens before external existence checks or reads (exists=%s)", async (exists) => {
    const { directory, base } = await project()
    const target = join(base, "outside.md")
    if (exists) await writeFile(target, "DENIED_EXTERNAL_BODY")
    const output = run({ directory, references: [file(target)], approval: "deny" })
    failed(output, /not approved/i)
    expect(output.approvals).toHaveLength(1)
    expect(output.io.length).toBe(output.approvals[0]!.operations)
    expect(operations(output, ["open", "read", "lstat", "stat"])).toEqual([])
  })

  test("absence of an approval callback is a denial, never implicit external consent", async () => {
    const { directory, base } = await project()
    const target = join(base, "outside.md")
    await writeFile(target, "UNAPPROVED_EXTERNAL_BODY")
    const output = run({ directory, references: [file(target)] })
    failed(output, /not approved/i)
    expect(output.approvals).toEqual([])
    expect(operations(output, ["open", "read", "lstat", "stat"])).toEqual([])
  })

  test("cancellation during pending approval prevents later file access and inference", async () => {
    const { directory, base } = await project()
    const target = join(base, "outside.md")
    await writeFile(target, "CANCELLED_EXTERNAL_BODY")
    const output = run({ directory, references: [file(target)], approval: "pending", action: "cancel" })
    expect(output.approvals).toHaveLength(1)
    expect(output.checkpoint).toBeGreaterThan(0)
    expect(output.io.length).toBe(output.checkpoint!)
    expect(output.calls).toEqual([])
    expect(output.replies).toEqual([])
  })

  test("pending approval cannot substitute a later session, client, model or level", async () => {
    const { directory, base } = await project()
    const target = join(base, "outside.md")
    await writeFile(target, "CAPTURED_EXTERNAL_BODY")
    const output = run({ directory, references: [file(target)], approval: "pending", action: "capture" })
    expect(output.ids).toEqual(["captured-session"])
    expect(output.calls).toHaveLength(1)
    const url = new URL(output.calls[0]!.url)
    expect(url.hostname).toBe("captured-backend.invalid")
    expect(url.searchParams.get("directory")).toBe(directory)
    expect(output.calls[0]!.body).toMatchObject({
      model: { providerID: "fixture-provider", modelID: "captured-model" },
      level: "high-school",
    })
    expect(content(output)).toContain("Captured conversation context.")
    expect(content(output)).toContain("CAPTURED_EXTERNAL_BODY")
  })
})
