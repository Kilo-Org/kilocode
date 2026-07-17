import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { KilocodeMcpConfig } from "@/kilocode/cli/cmd/mcp"
import { tmpdir } from "../../../fixture/fixture"

const added = `{
  "permission": {
    "bash": "allow"
  },
  "mcp": {
    "linear": {
      "type": "remote",
      "url": "https://mcp.linear.app/mcp",
      "oauth": {}
    }
  },
}`

describe("KilocodeMcpConfig.format", () => {
  test("writes strict JSON for kilo.json", () => {
    const output = KilocodeMcpConfig.format("/tmp/kilo.json", added)

    expect(JSON.parse(output)).toEqual({
      permission: { bash: "allow" },
      mcp: {
        linear: {
          type: "remote",
          url: "https://mcp.linear.app/mcp",
          oauth: {},
        },
      },
    })
    expect(output).not.toEndWith(",\n}")
  })

  test("preserves JSONC formatting for kilo.jsonc", () => {
    expect(KilocodeMcpConfig.format("/tmp/kilo.jsonc", added)).toBe(added)
  })
})

describe("KilocodeMcpConfig.resolve", () => {
  test("orders local Kilo config candidates before their fallbacks", () => {
    const dir = "/tmp/project"

    expect(KilocodeMcpConfig.files(dir)).toEqual([
      path.join(dir, ".kilo", "kilo.jsonc"),
      path.join(dir, ".kilo", "kilo.json"),
      path.join(dir, ".kilocode", "kilo.jsonc"),
      path.join(dir, ".kilocode", "kilo.json"),
      path.join(dir, "kilo.jsonc"),
      path.join(dir, "kilo.json"),
    ])
  })

  test("orders global Kilo config candidates", () => {
    const dir = "/tmp/global"

    expect(KilocodeMcpConfig.files(dir, true)).toEqual([path.join(dir, "kilo.jsonc"), path.join(dir, "kilo.json")])
  })

  test("selects the highest priority local Kilo config", async () => {
    await using tmp = await tmpdir()
    const files = KilocodeMcpConfig.files(tmp.path)
    await Promise.all(
      files.map(async (file) => {
        await fs.mkdir(path.dirname(file), { recursive: true })
        await Bun.write(file, "{}")
      }),
    )

    expect(await KilocodeMcpConfig.resolve(tmp.path)).toBe(files[0])
  })

  test("selects global Kilo JSONC before JSON", async () => {
    await using tmp = await tmpdir()
    const files = KilocodeMcpConfig.files(tmp.path, true)
    await Promise.all(files.map((file) => Bun.write(file, "{}")))

    expect(await KilocodeMcpConfig.resolve(tmp.path, true)).toBe(files[0])
  })

  test("defaults to Kilo JSONC files", async () => {
    await using tmp = await tmpdir()

    expect(await KilocodeMcpConfig.resolve(tmp.path)).toBe(path.join(tmp.path, ".kilo", "kilo.jsonc"))
    expect(await KilocodeMcpConfig.resolve(tmp.path, true)).toBe(path.join(tmp.path, "kilo.jsonc"))
  })

  test("does not select OpenCode config files", async () => {
    await using tmp = await tmpdir()
    const legacy = [
      path.join(tmp.path, ".kilo", "opencode.jsonc"),
      path.join(tmp.path, ".kilo", "opencode.json"),
      path.join(tmp.path, ".kilocode", "opencode.jsonc"),
      path.join(tmp.path, ".kilocode", "opencode.json"),
      path.join(tmp.path, "opencode.jsonc"),
      path.join(tmp.path, "opencode.json"),
    ]
    await Promise.all(
      legacy.map(async (file) => {
        await fs.mkdir(path.dirname(file), { recursive: true })
        await Bun.write(file, "legacy")
      }),
    )

    expect(await KilocodeMcpConfig.resolve(tmp.path)).toBe(path.join(tmp.path, ".kilo", "kilo.jsonc"))
    expect(await KilocodeMcpConfig.resolve(tmp.path, true)).toBe(path.join(tmp.path, "kilo.jsonc"))
    await Promise.all(legacy.map((file) => expect(fs.readFile(file, "utf8")).resolves.toBe("legacy")))
  })
})
