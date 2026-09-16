import { expect, test } from "bun:test"
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { compare, parse, prune, scan, type Exception, type Finding } from "../../../script/check-kilocode-duplication"

const source = `export function summarize(input: readonly number[]) {
  const positive = input.filter((value) => Number.isFinite(value) && value > 0)
  const negative = input.filter((value) => Number.isFinite(value) && value < 0)
  const total = positive.reduce((sum, value) => sum + value, 0)
  const sorted = positive.toSorted((left, right) => left - right)
  const first = sorted.at(0) ?? 0
  const last = sorted.at(-1) ?? 0
  const average = positive.length ? total / positive.length : 0
  const result = {
    count: input.length,
    positive: positive.length,
    negative: negative.length,
    total,
    first,
    last,
    average,
    range: last - first,
    valid: input.every((value) => Number.isFinite(value)),
  }
  return Object.freeze(result)
}
`
const first = "packages/kilo-example/src/first.ts"
const second = "packages/kilo-example/src/second.tsx"

async function fixture(files: Record<string, string>, run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "kilo-duplication-test-"))
  try {
    for (const [name, content] of Object.entries(files)) {
      const file = join(root, name)
      await mkdir(dirname(file), { recursive: true })
      await Bun.write(file, content)
    }
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function allowance(finding: Finding): Exception {
  return {
    files: finding.files,
    fingerprint: finding.fingerprint,
    maxMatches: finding.matches,
    maxTokens: finding.tokens,
    kind: "intentional",
    owner: "scanner-tests",
    reason: "Copied fixture verifies bounded exceptions against the real detector.",
  }
}

function exception(findings: Finding[]) {
  const finding = findings.at(0)
  if (!finding) throw new Error("Expected the real scanner to find the copied fixture")
  return allowance(finding)
}

const timeout = 60_000

test(
  "detects cross-format copies despite comments and spacing and requires a bounded exception",
  async () => {
    await fixture(
      { [first]: source, [second]: source.replace("  const total", "  /* ignored comment */\n    const total") },
      async (root) => {
        const result = await scan(root)
        expect(result.pairs).toBe(1)
        expect(result.findings.at(0)?.files).toEqual([first, second])
        const exceptions = parse({ version: 1, scanner: result.scanner, exceptions: [exception(result.findings)] })
        expect(compare(result.findings, [])).toEqual([expect.stringContaining("Unclassified duplication")])
        expect(compare(result.findings, exceptions)).toEqual([])
        const finding = result.findings.at(0)!
        expect(compare([{ ...finding, matches: finding.matches + 1 }], exceptions)).toEqual([
          expect.stringContaining("Duplication grew"),
        ])
        expect(compare([{ ...finding, tokens: finding.tokens + 1 }], exceptions)).toEqual([
          expect.stringContaining("Duplication grew"),
        ])
        const replacement = compare([{ ...finding, fingerprint: "ffffffffffffffff" }], exceptions)
        expect(replacement).toContainEqual(expect.stringContaining("Unclassified duplication"))
        expect(replacement).toContainEqual(expect.stringContaining("Stale exception"))
      },
    )
  },
  timeout,
)

test(
  "line shifts preserve identity but a third copy fails",
  async () => {
    await fixture({ [first]: source, [second]: source }, async (root) => {
      const initial = await scan(root)
      const exceptions = initial.findings.map(allowance)
      await Bun.write(join(root, first), `\n\n\n${source}`)
      const shifted = await scan(root)
      expect(compare(shifted.findings, exceptions)).toEqual([])
      const third = "packages/kilo-example/src/third.ts"
      await Bun.write(join(root, third), source)
      const copied = await scan(root)
      expect(compare(copied.findings, exceptions)).toContainEqual(expect.stringContaining("Unclassified duplication"))
      expect(copied.findings.some((finding) => finding.files.includes(third))).toBe(true)
      expect(compare(copied.findings, prune(copied.findings, exceptions))).toContainEqual(
        expect.stringContaining("Unclassified duplication"),
      )
    })
  },
  timeout,
)

test(
  "detects duplicated blocks within one file",
  async () => {
    await fixture({ [first]: `${source}\n${source.replace("summarize", "describe")}` }, async (root) => {
      const result = await scan(root)
      expect(result.pairs).toBeGreaterThan(0)
      expect(result.findings.at(0)?.files).toEqual([first, first])
      expect(compare(result.findings, [])).toContainEqual(expect.stringContaining("Unclassified duplication"))
    })
  },
  timeout,
)

test(
  "cleanup requires removing stale debt and pruning never raises limits",
  async () => {
    await fixture({ [first]: source, [second]: source }, async (root) => {
      const initial = await scan(root)
      const exceptions = initial.findings.map(allowance)
      await rm(join(root, second))
      const cleaned = await scan(root)
      expect(cleaned.pairs).toBe(0)
      expect(compare(cleaned.findings, exceptions)).toContainEqual(expect.stringContaining("Stale exception"))
      expect(prune(cleaned.findings, exceptions)).toEqual([])
      expect(compare(cleaned.findings, prune(cleaned.findings, exceptions))).toEqual([])
      const finding = initial.findings.at(0)!
      const smaller = { ...finding, tokens: finding.tokens - 1 }
      expect(prune([smaller], exceptions).at(0)?.maxTokens).toBe(smaller.tokens)
      expect(prune([{ ...finding, tokens: finding.tokens + 1 }], exceptions).at(0)?.maxTokens).toBe(finding.tokens)
    })
  },
  timeout,
)

test(
  "includes new Kilo packages without counting JetBrains, upstream, generated, locale or fixture files",
  async () => {
    await fixture(
      {
        [first]: source,
        "packages/ui/src/upstream.ts": source,
        "packages/kilo-example/src/fixtures/copy.ts": source,
        "packages/kilo-example/src/i18n/en.ts": source,
        "packages/kilo-example/src/copy.test.ts": source,
        "packages/kilo-example/src/copy.gen.ts": source,
        "packages/kilo-example/src/copy.d.ts": source,
        "packages/kilo-i18n/src/en.ts": source,
        "packages/kilo-docs/src/copy.ts": source,
        "packages/kilo-jetbrains/src/first.ts": source,
        "packages/kilo-jetbrains/src/second.tsx": source,
        "packages/kilo-vscode/src/services/autocomplete/continuedev/copy.ts": source,
      },
      async (root) => {
        const result = await scan(root)
        expect(result.files).toBe(1)
        expect(result.pairs).toBe(0)
      },
    )
  },
  timeout,
)

test(
  "fails closed for an empty scope or inline suppression",
  async () => {
    await fixture({}, async (root) => {
      expect(
        await scan(root).then(
          () => "",
          (err: unknown) => String(err),
        ),
      ).toContain("No Kilo-owned source files")
    })
    await fixture({ [first]: `/* jscpd:ignore-start */\n${source}\n/* jscpd:ignore-end */\n` }, async (root) => {
      expect(
        await scan(root).then(
          () => "",
          (err: unknown) => String(err),
        ),
      ).toContain("Inline duplication suppression is not allowed")
    })
  },
  timeout,
)

test(
  "detects duplicated CSS blocks",
  async () => {
    const css = `.box {\n${Array.from({ length: 20 }, (_, index) => `  --shade-${index}: rgb(${index}, 0, 0);`).join("\n")}\n}\n`
    await fixture(
      {
        "packages/kilo-example/src/first.css": css,
        "packages/kilo-example/src/second.css": css,
      },
      async (root) => {
        const result = await scan(root)
        expect(result.pairs).toBe(1)
        expect(result.findings.at(0)?.files.every((file) => file.endsWith(".css"))).toBe(true)
      },
    )
  },
  timeout,
)

test(
  "the CLI rejects new copies and only prunes resolved debt",
  async () => {
    await fixture({ [first]: source, [second]: source }, async (root) => {
      const script = "script/check-kilocode-duplication.ts"
      await mkdir(join(root, "script"))
      await copyFile(resolve(import.meta.dir, "../../../", script), join(root, script))
      const invoke = async (args: string[] = []) => {
        const proc = Bun.spawn([process.execPath, script, ...args], {
          cwd: root,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        })
        const [code, stdout, stderr] = await Promise.all([
          proc.exited,
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ])
        return { code, text: stdout + stderr }
      }
      expect((await invoke(["--init"])).code).toBe(0)
      const baseline = Bun.file(join(root, "script/kilocode-duplication-allowlist.json"))
      const initial = await baseline.text()
      expect((await invoke()).code).toBe(0)
      const third = join(root, "packages/kilo-example/src/third.ts")
      await Bun.write(third, source)
      const failed = await invoke()
      expect(failed.code).toBe(1)
      expect(failed.text).toContain("Unclassified duplication")
      expect((await invoke(["--prune"])).code).toBe(1)
      expect(await baseline.text()).toBe(initial)
      expect((await invoke(["--init"])).code).toBe(1)
      expect(await baseline.text()).toBe(initial)
      await Promise.all([rm(join(root, second)), rm(third)])
      const stale = await invoke()
      expect(stale.code).toBe(1)
      expect(stale.text).toContain("Stale exception")
      expect((await invoke(["--prune"])).code).toBe(0)
      expect(parse(await baseline.json())).toEqual([])
      expect((await invoke()).code).toBe(0)
      const compact = JSON.stringify(await baseline.json())
      await Bun.write(baseline, compact)
      expect((await invoke(["--prune"])).code).toBe(0)
      expect(await baseline.text()).toBe(compact)
    })
  },
  timeout,
)

test("rejects malformed and duplicate exception entries", () => {
  const entry: Exception = {
    files: [first, second],
    fingerprint: "0123456789abcdef",
    maxMatches: 1,
    maxTokens: 100,
    kind: "legacy",
    owner: "scanner-tests",
    reason: "Existing fixture duplication awaiting cleanup.",
  }
  const data = { version: 1, scanner: "jscpd@5.0.16", exceptions: [entry] }
  expect(parse(data)).toEqual([entry])
  for (const change of [
    { reason: " " },
    { owner: "" },
    { fingerprint: "missing" },
    { maxMatches: 0 },
    { maxTokens: -1 },
    { kind: "ignore" },
    { files: [second, first] },
    { files: ["../outside.ts", second] },
    { files: [first] },
  ]) {
    expect(() => parse({ ...data, exceptions: [{ ...entry, ...change }] })).toThrow()
  }
  expect(() => parse({ ...data, exceptions: [entry, entry] })).toThrow("Duplicate exception")
  expect(() => parse({ ...data, scanner: "jscpd@latest" })).toThrow("Unsupported duplication allowlist")
  expect(() => parse({ ...data, exceptions: undefined })).toThrow()
})
