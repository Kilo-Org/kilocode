import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloConfigFiles } from "@opencode/util/kilocode/config/files"
import { configFile } from "../src/marketplace/config"
import { entryFingerprint, fingerprint, preflight, remove, write } from "../src/marketplace/plugin-config"

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), "kilo-marketplace-plugin-"))

const plugin = (input: {
  file: string
  spec: string
  identity?: string
  replace?: boolean
  fingerprints?: readonly string[]
}) =>
  write({
    file: input.file,
    spec: input.spec,
    identity: input.identity ?? input.spec.split("@")[0],
    replace: input.replace ?? false,
    fingerprints: input.fingerprints,
  })

describe("plugin config entries", () => {
  test("appends to an existing array and keeps sibling comments and entries", async () => {
    const file = path.join(await tmp(), "kilo2.jsonc")
    await Bun.write(
      file,
      `{
  // keep this comment
  "plugins": [
    "first" // first entry comment
  ],
  "theme": "kilo"
}
`,
    )
    await plugin({ file, spec: "second@1" })
    const text = await Bun.file(file).text()
    expect(text).toContain("// keep this comment")
    expect(text).toContain("// first entry comment")
    expect(text).toContain('"second@1"')
    expect(text).toContain('"theme": "kilo"')
  })
  test("creates the array when the document has none", async () => {
    const file = path.join(await tmp(), "kilo2.json")
    await Bun.write(file, `{ "theme": "kilo" }\n`)
    await plugin({ file, spec: "demo" })
    expect(await Bun.file(file).json()).toEqual({ theme: "kilo", plugins: ["demo"] })
  })
  test("creates the file when it does not exist", async () => {
    const file = path.join(await tmp(), "kilo2.json")
    await plugin({ file, spec: "demo" })
    expect(await Bun.file(file).json()).toEqual({ plugins: ["demo"] })
  })
  test("writes nothing for a second install without replace", async () => {
    const file = path.join(await tmp(), "kilo2.json")
    await plugin({ file, spec: "demo@1" })
    const before = await Bun.file(file).text()
    await plugin({ file, spec: "demo@2" })
    expect(await Bun.file(file).text()).toBe(before)
  })
  test("replaces an owned version bump in place", async () => {
    const file = path.join(await tmp(), "kilo2.json")
    await plugin({ file, spec: "demo@1" })
    const owned = entryFingerprint("demo@1")
    await plugin({ file, spec: "demo@2", replace: true, fingerprints: [owned] })
    expect(await Bun.file(file).json()).toEqual({ plugins: ["demo@2"] })
    expect(await fingerprint(file, "demo")).toBe(entryFingerprint("demo@2"))
  })
  test("leaves an already equal owned entry alone", async () => {
    const file = path.join(await tmp(), "kilo2.json")
    await Bun.write(file, `{"plugins":["demo@1"],"theme":"kilo"}\n`)
    const before = await Bun.file(file).text()
    await plugin({ file, spec: "demo@1", replace: true, fingerprints: [entryFingerprint("demo@1")] })
    expect(await Bun.file(file).text()).toBe(before)
  })
  test("collapses owned duplicates and protects an unowned one", async () => {
    const file = path.join(await tmp(), "kilo2.json")
    await Bun.write(file, `{"plugins":["demo@1","other","demo@1"]}\n`)
    await plugin({ file, spec: "demo@2", replace: true, fingerprints: [entryFingerprint("demo@1")] })
    expect(await Bun.file(file).json()).toEqual({ plugins: ["demo@2", "other"] })
    await Bun.write(file, `{"plugins":["demo@1","demo@9"]}\n`)
    await expect(
      plugin({ file, spec: "demo@2", replace: true, fingerprints: [entryFingerprint("demo@1")] }),
    ).rejects.toMatchObject({ reason: "conflict" })
    // Nothing changed after the refusal.
    expect(await Bun.file(file).json()).toEqual({ plugins: ["demo@1", "demo@9"] })
  })
  test("accepts an identical entry the install itself writes", async () => {
    const file = path.join(await tmp(), "kilo2.json")
    await Bun.write(file, `{"plugins":["demo@1"]}\n`)
    await plugin({ file, spec: "demo@1", replace: true, fingerprints: [entryFingerprint("demo@1")] })
    expect(await Bun.file(file).json()).toEqual({ plugins: ["demo@1"] })
  })
  test("refuses a same-identity entry with other options", async () => {
    const file = path.join(await tmp(), "kilo2.json")
    await Bun.write(file, `{"plugins":[{"package":"demo","options":{"mode":"server"}}]}\n`)
    await expect(plugin({ file, spec: "demo", replace: true })).rejects.toMatchObject({ reason: "conflict" })
  })
  test("refuses invalid JSON and a non-array plugins value", async () => {
    const file = path.join(await tmp(), "kilo2.jsonc")
    await Bun.write(file, `{ "plugins": [ "demo"`)
    await expect(plugin({ file, spec: "demo" })).rejects.toMatchObject({ reason: "invalid_params" })
    await Bun.write(file, `{ "plugins": { "demo": true } }`)
    await expect(plugin({ file, spec: "demo" })).rejects.toMatchObject({ reason: "invalid_params" })
  })
  test("removes only the owned entry and keeps the rest", async () => {
    const file = path.join(await tmp(), "kilo2.jsonc")
    await Bun.write(file, `{\n  // keep\n  "plugins": ["demo@1", "other"], // trailing\n  "theme": "kilo"\n}\n`)
    await remove({ file, identity: "demo", fingerprints: [entryFingerprint("demo@1")] })
    const text = await Bun.file(file).text()
    expect(text).toContain('"other"')
    expect(text).not.toContain("demo@1")
    expect(text).toContain("// keep")
    expect(text).toContain("// trailing")
    expect(await fingerprint(file, "demo")).toBeUndefined()
    // Removing an absent entry is a no-op.
    await remove({ file, identity: "demo" })
    expect(await Bun.file(file).text()).toBe(text)
  })
  test("removes several owned matches, including the last element", async () => {
    const file = path.join(await tmp(), "kilo2.json")
    await Bun.write(file, `{"plugins":["demo@1","other","demo@2"]}\n`)
    await remove({ file, identity: "demo", fingerprints: [entryFingerprint("demo@1"), entryFingerprint("demo@2")] })
    expect(await Bun.file(file).json()).toEqual({ plugins: ["other"] })
    await Bun.write(file, `{"plugins":["other","demo"]}\n`)
    await remove({ file, identity: "demo", fingerprints: [entryFingerprint("demo")] })
    expect(await Bun.file(file).json()).toEqual({ plugins: ["other"] })
  })
  test("refuses to remove an entry the record does not own", async () => {
    const file = path.join(await tmp(), "kilo2.json")
    await Bun.write(file, `{"plugins":["demo@2"]}\n`)
    await expect(remove({ file, identity: "demo", fingerprints: [entryFingerprint("demo@1")] })).rejects.toMatchObject({
      reason: "conflict",
    })
    await expect(remove({ file, identity: "demo" })).rejects.toMatchObject({ reason: "conflict" })
    expect(await Bun.file(file).json()).toEqual({ plugins: ["demo@2"] })
  })
  test("preflight accepts an owned value and refuses a modified one without writing", async () => {
    const file = path.join(await tmp(), "kilo2.json")
    await Bun.write(file, `{"plugins":["demo@1"]}\n`)
    const before = await Bun.file(file).text()
    await preflight({ file, identity: "demo", fingerprints: [entryFingerprint("demo@1")] })
    await expect(
      preflight({ file, identity: "demo", fingerprints: [entryFingerprint("demo@0")] }),
    ).rejects.toMatchObject({ reason: "conflict" })
    expect(await Bun.file(file).text()).toBe(before)
  })
  test("fingerprints none, one and several matches distinctly", async () => {
    const file = path.join(await tmp(), "kilo2.json")
    await Bun.write(file, `{"plugins":["demo@1","other"]}\n`)
    expect(await fingerprint(file, "demo")).toBe(entryFingerprint("demo@1"))
    expect(await fingerprint(file, "absent")).toBeUndefined()
    await Bun.write(file, `{"plugins":["demo@1","demo@1"]}\n`)
    const duplicates = await fingerprint(file, "demo")
    expect(duplicates).toBeDefined()
    expect(duplicates).not.toBe(entryFingerprint("demo@1"))
  })
  test("serializes concurrent writers so neither edit is lost", async () => {
    const file = path.join(await tmp(), "kilo2.json")
    await Bun.write(file, `{"plugins":[]}\n`)
    await Promise.all([plugin({ file, spec: "first" }), plugin({ file, spec: "second" })])
    expect((await Bun.file(file).json()).plugins.toSorted()).toEqual(["first", "second"])
  })
  test.skipIf(process.platform === "win32")("an aliased file shares one queue and one entry", async () => {
    const directory = await fs.realpath(await tmp())
    const file = path.join(directory, "kilo2.json")
    const alias = path.join(directory, "alias.json")
    await Bun.write(file, `{"plugins":[]}\n`)
    await fs.symlink(file, alias)
    await Promise.all([plugin({ file: alias, spec: "first" }), plugin({ file, spec: "second" })])
    expect((await Bun.file(file).json()).plugins.toSorted()).toEqual(["first", "second"])
    expect(await fingerprint(alias, "first")).toBe(entryFingerprint("first"))
  })
})

describe("plugin config targets", () => {
  test.skipIf(process.platform === "win32")("a project config outside the native candidates is refused", async () => {
    const directory = await fs.realpath(await tmp())
    const outside = path.join(directory, "..", `${path.basename(directory)}-outside.json`)
    await Bun.write(path.join(directory, "kilo2.json"), "{}\n")
    await Bun.write(outside, "{}\n")
    await fs.unlink(path.join(directory, "kilo2.json"))
    await fs.symlink(outside, path.join(directory, "kilo2.json"))
    await expect(configFile(directory, false)).rejects.toMatchObject({ reason: "conflict" })
    expect(KiloConfigFiles.writeCandidates(directory, false)).toContain(path.join(directory, "kilo2.json"))
  })
  test("a global config is not confined to the directory", async () => {
    expect(await configFile(path.join(await tmp(), "missing"), true)).toEndWith("kilo2.json")
  })
})
