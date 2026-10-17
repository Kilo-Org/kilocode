import assert from "node:assert/strict"
import { after, test } from "node:test"
import { mkdtemp, readFile, copyFile, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import childprocess from "node:child_process"
import { build } from "esbuild"
import { strToU8 } from "fflate"
import { docx, pdf, streaming, xml } from "./containers.mjs"

assert.equal(process.release.name, "node", "Production limits must run in Node, not Bun")
const require = createRequire(import.meta.url)
const fixtures = dirname(fileURLToPath(import.meta.url))
const root = resolve(fixtures, "../../..")
const dir = await mkdtemp(join(tmpdir(), "response-lens-document-"))
const worker = join(dir, "response-lens-document-worker.mjs")
const host = join(dir, "host.cjs")
const cfg = require(join(root, "esbuild.js")).getDocumentWorkerConfig()
await build({ ...cfg, absWorkingDir: root, outfile: worker, sourcemap: false, minify: true })
await build({
  entryPoints: [join(root, "src/kilo-provider/response-lens-document.ts")],
  outfile: host,
  bundle: true,
  platform: "node",
  format: "cjs",
  logLevel: "silent",
})
const original = await readFile(worker)
const children = []
const spawn = childprocess.spawn
// Observe real OS child handles; never replace the parser with a Bun worker or fake process.
childprocess.spawn = (...args) => {
  const child = spawn(...args)
  children.push({ child, args })
  return child
}
const { extractDocument } = require(host)
const extract = (bytes, format, fragment, signal = new AbortController().signal) =>
  extractDocument(bytes, format, fragment, signal)
const dead = (child) => {
  assert.notEqual(child.exitCode ?? child.signalCode, null)
  assert.throws(() => process.kill(child.pid, 0), { code: "ESRCH" })
}
after(async () => {
  childprocess.spawn = spawn
  for (const { child } of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
  await rm(dir, { recursive: true, force: true })
})

test("UTF-8 fixture preserves paragraphs, strips BOM, enforces character and input bounds", async () => {
  const bytes = await readFile(join(fixtures, "paragraphs.txt"))
  const result = await extract(Buffer.concat([Buffer.from([239, 187, 191]), bytes]), "text")
  assert.equal(result.text, bytes.toString())
  assert.equal(result.truncated, false)
  const long = await extract(Buffer.from("x".repeat(100_020)), "text")
  assert.equal(long.text.length, 100_000)
  assert.equal(long.truncated, true)
  for (const bytes of [
    Buffer.from([0xff]),
    Buffer.from("binary\0data"),
    Buffer.from("bad\x01data"),
    Buffer.from("   "),
  ]) {
    await assert.rejects(extract(bytes, "text"), /binary|unsupported|extractable/i)
  }
  await assert.rejects(extract(Buffer.alloc(0), "text"), /1 byte/)
  await assert.rejects(extract(Buffer.alloc(1024 * 1024 + 1), "text"), /1 MiB/)
  const exact = await extract(Buffer.from("x".repeat(1024 * 1024)), "text")
  assert.equal(exact.text.length, 100_000)
})

test("real HTML omits executable/resources/chrome and supports fragment/fallback/pre blocks", async () => {
  const bytes = await readFile(join(fixtures, "article.html"))
  const result = await extract(bytes, "html")
  assert.doesNotMatch(result.text, /SENTINEL|https:/)
  assert.match(result.text, /Opening paragraph & useful context\.\n\nSelected heading/)
  assert.match(result.text, /one line\nanother line/)
  assert.match(result.text, /Visible link label/)
  const selected = await extract(bytes, "html", "#chosen%20section")
  assert.equal(selected.text, "Selected heading\n\nFirst important paragraph.\n\nSecond paragraph.")
  assert.equal((await extract(bytes, "html", "missing")).text, result.text)
  assert.equal((await extract(bytes, "html", "%invalid")).text, result.text)
  assert.equal((await extract(Buffer.from("<p>Fragment only</p>"), "html")).text, "Fragment only")
  const long = await extract(Buffer.from(`<p>${"x".repeat(200_000)}</p>`), "html")
  assert.ok(long.text.length <= 100_000 && long.truncated)
  await assert.rejects(extract(Buffer.from("<script>no text</script>"), "html"), /extractable/)
  await assert.rejects(extract(Buffer.from("<div>".repeat(260)), "html"), /nesting/)
})

test("real PDF objects load through minified ESM unpdf without canvas, scripts, or spawned workers", async () => {
  const result = await extract(pdf(["Real PDF paragraph."], { actions: true }), "pdf")
  assert.equal(result.text, "Real PDF paragraph.")
  assert.match(result.detail, /pages 1-1 of 1/)
  assert.equal(result.truncated, false)
  const pages = pdf(Array.from({ length: 6 }, (_, index) => `Page ${index + 1}`))
  const first = await extract(pages, "pdf")
  assert.equal(first.text, Array.from({ length: 6 }, (_, index) => `Page ${index + 1}`).join("\n\n"))
  assert.equal(first.truncated, false)
  const later = await extract(pages, "pdf", "#page=4")
  assert.equal(later.text, "Page 4\n\nPage 5\n\nPage 6")
  assert.equal(later.truncated, false)
  assert.match(later.detail, /pages 4-6/)
  assert.equal((await extract(pdf(Array.from({ length: 7 }, () => "page")), "pdf")).truncated, true)
  await assert.rejects(extract(pages, "pdf", "page=11"), /outside/)
  await assert.rejects(extract(pages, "pdf", "page=wrong"), /invalid/)
})

test("PDF per-page/total character limits and malformed, empty, scanned and encrypted failures", async () => {
  const large = await extract(pdf(Array.from({ length: 6 }, () => "x".repeat(25_000))), "pdf")
  assert.ok(large.text.length <= 100_000)
  assert.ok(large.text.split("\n\n").every((page) => page.length <= 20_000))
  assert.equal(large.truncated, true)
  for (const bytes of [
    Buffer.from("%PDF-broken"),
    pdf([""]),
    pdf([""], { scanned: true }),
    pdf(["secret"], { encrypted: true }),
  ]) {
    await assert.rejects(extract(bytes, "pdf"), /Malformed|extractable|Encrypted/)
  }
})

test("real DOCX ZIP streams read only paragraphs, tabs and breaks in word/document.xml", async () => {
  const result = await extract(
    docx(xml(), {
      "word/header1.xml": strToU8(xml("HEADER_SENTINEL")),
      "word/_rels/document.xml.rels": strToU8("EXTERNAL_RESOURCE_SENTINEL"),
      "word/media/image.bin": new Uint8Array([0, 1, 255]),
    }),
    "docx",
  )
  assert.equal(result.text, "First DOCX paragraph.\n\nSecond paragraph\twith a tab.\nNext line.")
  assert.equal(result.truncated, false)
  assert.match(result.detail, /not a layout/)
  assert.equal((await extract(streaming(xml()), "docx")).text, result.text)
  const long = await extract(docx(xml("x".repeat(150_000))), "docx")
  assert.ok(long.text.length <= 100_000 && long.truncated)
})

test("DOCX rejects declared/actual expansion bombs, archive count and unsafe paths without writes", async () => {
  await assert.rejects(extract(docx(xml("x".repeat(2 * 1024 * 1024))), "docx"), /expansion/)
  const bomb = Buffer.from(streaming(xml("x".repeat(3 * 1024 * 1024))))
  const central = bomb.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  bomb.writeUInt32LE(100, central + 24)
  await assert.rejects(extract(bomb, "docx"), /expansion/)
  for (const name of ["../outside.txt", "/absolute", "C:/absolute", "word\\document.xml", "word/../document.xml"]) {
    await assert.rejects(extract(docx(xml(), { [name]: strToU8("PATH_SENTINEL") }), "docx"), /path/)
  }
  const entries = Object.fromEntries(Array.from({ length: 257 }, (_, index) => [`part${index}`, strToU8("x")]))
  await assert.rejects(extract(docx(xml(), entries), "docx"), /entry limit/)
})

test("DOCX malformed/empty XML, DTD/entities, invalid UTF-8 and truncated containers fail clearly", async () => {
  for (const document of [
    "",
    "<w:document>",
    xml().replace("</w:t>", "</wrong>"),
    xml().replace("<w:body>", "<!DOCTYPE w:body><w:body>"),
    xml().replace("<w:body>", "<!ENTITY x SYSTEM 'file:///private'><w:body>"),
  ]) {
    await assert.rejects(extract(docx(document), "docx"), /Malformed|unsupported/)
  }
  await assert.rejects(extract(docx("<w:document><w:body/></w:document>"), "docx"), /extractable/)
  await assert.rejects(extract(docx().subarray(0, 50), "docx"), /Malformed/)
  await assert.rejects(extract(docx(xml(), { "word/document.xml": new Uint8Array([0xff]) }), "docx"), /Malformed/)
  const corrupt = Buffer.from(streaming(xml()))
  const central = corrupt.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  corrupt.writeUInt32LE(0, central + 16)
  await assert.rejects(extract(corrupt, "docx"), /checksum/)
})

test("plain text preserves leading/repeated newlines, exact whitespace and original line anchors", async () => {
  for (const text of [
    "\n\nfirst\nsecond\nCHOSEN_ORIGINAL_LINE\nlast\n",
    "first\n\n\nsecond\nCHOSEN_ORIGINAL_LINE\nlast",
    "\r\n\r\nfirst\r\nsecond\r\nCHOSEN_ORIGINAL_LINE\r\nlast\t  \r\n",
  ]) {
    const result = await extract(Buffer.from(text), "text", "#L5-L5")
    assert.equal(result.text, text)
    assert.equal(result.text.split(/\r\n|\r|\n/).at(4), "CHOSEN_ORIGINAL_LINE")
  }
  const whitespace = "\n  indentation\t \r\n\r\n\rblank\fpage\r\n  "
  assert.equal((await extract(Buffer.from(whitespace), "text")).text, whitespace)
})

test("full plain text is redacted before the 100000-character boundary and line selection", async () => {
  const key =
    "-----BEGIN PRIVATE KEY-----\r\nSYNTHETIC_PRIVATE_MATERIAL\r\nMORE_PRIVATE_MATERIAL\fLAST_PRIVATE_MATERIAL\r\n-----END PRIVATE KEY-----\r\nUseful explanation."
  const redacted = (await extract(Buffer.from(key), "text", "#L2-L2")).text
  assert.doesNotMatch(redacted, /PRIVATE|SYNTHETIC|MATERIAL/)
  assert.equal(redacted.split("\r\n").at(1), "[redacted]")
  assert.equal(redacted.match(/[\r\n\f]/g).join(""), key.match(/[\r\n\f]/g).join(""))
  const query = `${"context ".repeat(12_490)}https://example.invalid/file?code=QUERY_CREDENTIAL_DO_NOT_SEND`
  assert.doesNotMatch((await extract(Buffer.from(query), "text")).text, /QUERY_CREDENTIAL/)
  const text = `${"x".repeat(99_988)}\nsk-${"a1".repeat(18)}\nUseful explanation.`
  const result = await extract(Buffer.from(text), "text", "#L2-L2")
  assert.doesNotMatch(result.text, /sk-|a1a1/)
  assert.match(result.text, /\[redacted\]/)
})

test("HTML sanitizes complete inline credentials and PEM spans before fragment or presentation filtering", async () => {
  const selected = Buffer.from(
    `<p>api_key=<span id="credential">OPAQUE_CREDENTIAL_DO_NOT_SEND</span></p><p>Useful explanation.</p>`,
  )
  const result = await extract(selected, "html", "credential")
  assert.doesNotMatch(result.text, /OPAQUE|CREDENTIAL/)
  assert.match(result.text, /\[redacted\]/)
  const key = Buffer.from(
    `<aside>-----BEGIN PRIVATE KEY-----</aside><section id="body"><p>PRIVATE_HTML_BODY_DO_NOT_SEND</p></section><footer>-----END PRIVATE KEY-----</footer><p>Useful explanation.</p>`,
  )
  assert.equal((await extract(key, "html", "body")).text, "[redacted]")
  const token = Buffer.from(`<p>${"x".repeat(99_980)} sk-<strong>${"a1".repeat(18)}</strong></p>`)
  assert.doesNotMatch((await extract(token, "html")).text, /sk-|a1a1/)
})

test("DOCX sanitizes complete run/paragraph credentials before extraction truncation", async () => {
  const key = xml(
    "-----BEGIN PRIVATE KEY-----</w:t></w:r></w:p><w:p><w:r><w:t>PRIVATE_DOCX_BODY_DO_NOT_SEND</w:t></w:r></w:p><w:p><w:r><w:t>-----END PRIVATE KEY-----",
  )
  const result = await extract(docx(key), "docx")
  assert.doesNotMatch(result.text, /PRIVATE|DOCX_BODY/)
  assert.match(result.text, /\[redacted\]/)
  const token = xml(`${"x".repeat(99_980)} sk-</w:t><w:t>${"a1".repeat(18)}`)
  assert.doesNotMatch((await extract(docx(token), "docx")).text, /sk-|a1a1/)
})

test("PDF sanitizes every raw page together before per-page and total presentation limits", async () => {
  const token = pdf([`${"x".repeat(19_990)} sk-${"a1".repeat(18)}`])
  assert.doesNotMatch((await extract(token, "pdf")).text, /sk-|a1a1/)
  const key = pdf([
    `${"context ".repeat(3000)}-----BEGIN PRIVATE KEY-----`,
    "PRIVATE_PDF_BODY_DO_NOT_SEND",
    "-----END PRIVATE KEY-----",
    "Useful explanation.",
  ])
  const result = await extract(key, "pdf")
  assert.doesNotMatch(result.text, /PRIVATE|PDF_BODY/)
  assert.match(result.text, /\[redacted\]/)
  assert.match(result.text, /Useful explanation/)
  assert.equal(result.truncated, true)
  const selected = await extract(key, "pdf", "page=2")
  assert.doesNotMatch(selected.text, /PRIVATE|PDF_BODY/)
  assert.match(selected.text, /\[redacted\]/)
})

test("PDF redacts secrets beginning before the selected six-page window and enforces the 30-page ceiling", async () => {
  const pages = Array.from({ length: 30 }, (_, index) => `Page ${index + 1}`)
  const document = pdf(pages)
  const first = await extract(document, "pdf")
  assert.equal(first.text, pages.slice(0, 6).join("\n\n"))
  assert.equal(first.truncated, true)
  const middle = await extract(document, "pdf", "page=20")
  assert.equal(middle.text, pages.slice(19, 25).join("\n\n"))
  assert.match(middle.detail, /pages 20-25 of 30/)
  assert.equal(middle.truncated, true)
  const last = await extract(document, "pdf", "page=28")
  assert.equal(last.text, pages.slice(27).join("\n\n"))
  assert.equal(last.truncated, false)
  const key = pdf([
    "-----BEGIN PRIVATE KEY-----",
    ...Array.from({ length: 8 }, () => "PRIVATE_BODY_BEFORE_AND_INSIDE_WINDOW"),
    "-----END PRIVATE KEY-----",
    ...pages.slice(10, 16),
  ])
  const selected = await extract(key, "pdf", "page=8")
  assert.doesNotMatch(selected.text, /PRIVATE|INSIDE_WINDOW/)
  assert.match(selected.text, /\[redacted\]/)
  assert.match(selected.text, /Page 13$/)
  assert.doesNotMatch(selected.text, /Page 14/)
  assert.match(selected.detail, /pages 8-13 of 16/)
  await assert.rejects(extract(pdf([...pages, "Page 31"]), "pdf", "page=28"), /30-page.*safety limit/)
})

test("over-budget raw document text rejects rather than emitting an unsanitized partial excerpt", async () => {
  await assert.rejects(extract(docx(xml("context ".repeat(150_000))), "docx"), /raw text.*1 MiB/)
  const pages = pdf(
    Array.from({ length: 6 }, () => "context ".repeat(25_000)),
    { compressed: true },
  )
  assert.ok(pages.length < 1024 * 1024)
  await assert.rejects(extract(pages, "pdf"), /raw text.*1 MiB/)
  const later = pdf(
    [
      ...Array.from({ length: 6 }, () => "Small selected page."),
      ...Array.from({ length: 6 }, () => "context ".repeat(25_000)),
    ],
    { compressed: true },
  )
  assert.ok(later.length < 1024 * 1024)
  await assert.rejects(extract(later, "pdf"), /raw text.*1 MiB/)
})

test("actual Node permissions deny unrelated file reads/writes/module loads/children/workers/eval and strip environment", async () => {
  await copyFile(join(fixtures, "process-probe.mjs"), worker)
  process.env.RESPONSE_LENS_TEST_CREDENTIAL = "synthetic-test-secret"
  const previous = process.env.NODE_OPTIONS
  process.env.NODE_OPTIONS = "--throw-deprecation"
  try {
    const result = JSON.parse((await extract(Buffer.from("probe"), "text")).text)
    assert.equal(result.runAsNode, "1")
    assert.deepEqual(result.env, [])
    for (const name of ["self", "read", "write", "load", "child", "worker", "eval"])
      assert.equal(result[name], true, name)
    assert.ok(result.heap <= 180 * 1024 * 1024)
    dead(children.at(-1).child)
  } finally {
    delete process.env.RESPONSE_LENS_TEST_CREDENTIAL
    if (previous === undefined) delete process.env.NODE_OPTIONS
    else process.env.NODE_OPTIONS = previous
    await writeFile(worker, original)
  }
})

test("pre-abort spawns nothing and cancellation reaps an actual bundled parser before rejecting", async () => {
  const controller = new AbortController()
  controller.abort()
  const count = children.length
  await assert.rejects(extract(pdf(), "pdf", undefined, controller.signal), { name: "AbortError" })
  assert.equal(children.length, count)
  const active = new AbortController()
  const pending = extract(pdf(["x".repeat(900_000)]), "pdf", undefined, active.signal)
  const child = children.at(-1).child
  setTimeout(() => active.abort(), 40)
  await assert.rejects(pending, { name: "AbortError" })
  dead(child)
})

test("real Node child fault injection verifies hard timeout, stdout/stderr caps and invalid IPC results", async () => {
  const cases = [
    ["while (true) {}", /time limit/, true],
    ['process.stdout.write("x".repeat(700000)); setInterval(() => {}, 1000)', /output limit/],
    ['process.stderr.write("x".repeat(20000)); setInterval(() => {}, 1000)', /diagnostic limit/],
    ['process.stdin.resume(); process.stdin.on("end", () => process.stdout.write("not json"))', /invalid output/],
    [
      'process.stdin.resume(); process.stdin.on("end", () => process.stdout.write(JSON.stringify({text:"x".repeat(100001),detail:"",truncated:false})))',
      /invalid result/,
    ],
    ["const retained = []; while (true) retained.push(new Array(100000).fill(1))", /resource limit/],
  ]
  try {
    for (const [source, error, timeout] of cases) {
      await writeFile(worker, source)
      const start = performance.now()
      await assert.rejects(extract(Buffer.from("fault injection"), "text"), error)
      if (timeout) assert.ok(performance.now() - start >= 4000 && performance.now() - start < 6000)
      dead(children.at(-1).child)
    }
  } finally {
    await writeFile(worker, original)
  }
})

test("actual bundled worker bounds stdin and terminates a stalled input request", async () => {
  for (const oversized of [true, false]) {
    const child = childprocess.spawn(
      process.execPath,
      [
        "--permission",
        `--allow-fs-read=${worker}`,
        "--max-old-space-size=128",
        "--no-addons",
        "--disallow-code-generation-from-strings",
        worker,
      ],
      { env: { ELECTRON_RUN_AS_NODE: "1" }, windowsHide: true, stdio: "pipe" },
    )
    const chunks = []
    child.stdout.on("data", (chunk) => chunks.push(chunk))
    child.stdin.on("error", () => undefined)
    if (oversized) child.stdin.write("x".repeat(1_460_000))
    const closed = Promise.withResolvers()
    child.once("close", closed.resolve)
    const deadline = setTimeout(() => child.kill("SIGKILL"), 6000)
    await closed.promise
    clearTimeout(deadline)
    const result = JSON.parse(Buffer.concat(chunks).toString())
    assert.match(result.error, oversized ? /input exceeds/ : /time limit/)
    dead(child)
  }
})
