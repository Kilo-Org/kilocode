import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { brandingPlugin } from "../src/branding/plugin"
import { KiloLogo } from "../src/branding/logo-art"

const go = 'export const go = {\n  left: ["G"],\n  right: ["O"],\n}\nexport const after = "keep-after"'
const multiline = 'export const logo = {\n  left: ["old"],\n  right: ["art"],\n}'
const singleline = 'export const logo = { left: ["old"], right: ["art"] };'

for (const [name, source] of [
  ["multiline", `${multiline}\n${go}`],
  ["single line", `${singleline}\n${go}`],
  ["adjacent declarations", `${singleline} ${go}`],
  ["CRLF", `${multiline}\n${go}`.replaceAll("\n", "\r\n")],
  ["nested braces", `export const logo = {\n left: ["old"],\n right: ["art"],\n extra: {\n}\n}\n${go}`],
]) {
  test(`logo replacement preserves other exports: ${name}`, async () => {
    const result = await build(`export const before = "keep-before"\n${source}`)
    expect(result.success, result.logs.map(String).join("\n")).toBe(true)
    const code = await result.outputs[0].text()
    const output = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`)
    expect(output.logo).toEqual(KiloLogo.logo)
    expect(output.compact).toEqual(KiloLogo.compact)
    expect(output.widths).toEqual(KiloLogo.widths)
    expect(output.go).toEqual({ left: ["G"], right: ["O"] })
    expect(output.before).toBe("keep-before")
    expect(output.after).toBe("keep-after")
  })
}

for (const [name, source] of [
  ["missing logo", go],
  ["renamed export", `${multiline.replace("const logo", "const wordmark")}\n${go}`],
  ["unexported logo", `${multiline.replace("export ", "")}\n${go}`],
  ["mutable declaration", `${multiline.replace("const logo", "let logo")}\n${go}`],
  ["combined declaration", 'export const logo = { left: [], right: [] }, go = { left: ["G"], right: ["O"] };'],
  ["initializer call", `function getLogo() { return { left: [], right: [] } }\nexport const logo = getLogo()\n${go}`],
]) {
  test(`logo replacement rejects declaration drift clearly: ${name}`, async () => {
    await expect(build(source)).rejects.toMatchObject({
      errors: expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining("Kilo logo no longer matches the upstream module"),
        }),
      ]),
    })
  })
}

async function build(source: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), "kilo-logo-guard-"))
  try {
    const directory = path.join(root, "packages/tui/src")
    await mkdir(directory, { recursive: true })
    const filename = path.join(directory, "logo.ts")
    await Bun.write(filename, source)
    return await Bun.build({ entrypoints: [filename], target: "bun", plugins: [brandingPlugin] })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
