import { describe, expect, test } from "bun:test"
import { mkdir, writeFile } from "fs/promises"
import { dirname, join } from "path"
import { tmpdir } from "../fixture/fixture"

const yargs = Bun.resolveSync("yargs", import.meta.dir)
const y18n = (await import(Bun.resolveSync("y18n", dirname(yargs)))).default as (options: {
  directory: string
  locale: string
  updateFiles: boolean
}) => { __: (text: string) => string }

describe("yargs locale file read", () => {
  test("falls back to the default strings when the locale file cannot be read", async () => {
    await using tmp = await tmpdir()
    await mkdir(join(tmp.path, "en_US.json"))

    const strings = y18n({ directory: tmp.path, locale: "en_US", updateFiles: false })

    expect(strings.__("show help")).toBe("show help")
  })

  test("still reports a locale file with invalid JSON", async () => {
    await using tmp = await tmpdir()
    await writeFile(join(tmp.path, "en_US.json"), "{")

    const strings = y18n({ directory: tmp.path, locale: "en_US", updateFiles: false })

    expect(() => strings.__("show help")).toThrow(SyntaxError)
  })
})
