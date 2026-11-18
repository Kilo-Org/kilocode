import { $ } from "bun"
import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

let dir: string
const src = "packages/kilo-example/src/"

function source(name: string, branches: number) {
  return `export function ${name}(x: number) {\n${Array.from({ length: branches }, (_, i) => `  if (x === ${i}) return ${i}\n`).join("")}  return -1\n}\n`
}

function write(name: string, text: string) {
  return Bun.write(join(dir, src, name), text)
}

async function commit() {
  await $`git add .`.cwd(dir)
  await $`git -c user.name=Fixture -c user.email=test@example.invalid -c commit.gpgsign=false commit -qm base`.cwd(dir)
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kilo-metric-test-"))
  await $`git init -q`.cwd(dir)
  await write("old.ts", source("legacy", 22))
  await Bun.write(
    join(dir, "script/upstream/mirrors.json"),
    JSON.stringify({ mirrors: { "upstream.ts": { mirror: src + "copy.ts" } } }),
  )
  await commit()
})

afterEach(() => rm(dir, { recursive: true, force: true }))

async function gate(code: number) {
  const result = await $`${process.execPath} ${join(import.meta.dir, "check.ts")} HEAD`.cwd(dir).quiet().nothrow()
  expect(result.exitCode, result.stderr.toString()).toBe(code)
  return result.stderr.toString()
}

test("lowered complexity is the next ceiling even across inserted and deleted lines", async () => {
  await write("old.ts", "// offset\n" + source("legacy", 20))
  await gate(0)
  await commit()
  await write("old.ts", source("legacy", 21))
  expect(await gate(1)).toContain("complexity 22 (limit 21)")
})

test("a replacement cannot inherit debt or disable the metric", async () => {
  await write("old.ts", "// oxlint-disable-next-line complexity\n" + source("replacement", 20))
  expect(await gate(1)).toContain("complexity 21 (limit 20)")
})

test("Unicode separators in a literal do not displace an unchanged declaration", async () => {
  await write("old.ts", 'const prefix = "a\u2028b\u2029c"\n' + source("legacy", 22))
  await gate(0)
})

test("caps new and existing files but excludes tests, mirrors and generated code", async () => {
  const large = "// line\n".repeat(1001)
  for (const name of ["old.test.ts", "copy.ts", "contract.generated.ts"]) await write(name, large)
  await gate(0)
  await write("new.tsx", large)
  expect(await gate(1)).toContain("1001 lines (limit 1000)")
  await commit()
  await write("new.tsx", large + "// extra\n")
  expect(await gate(1)).toContain("1002 lines (limit 1001)")
})
