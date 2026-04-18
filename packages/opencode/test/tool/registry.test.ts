import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { ToolRegistry } from "../../src/tool/registry"

afterEach(async () => {
  await Instance.disposeAll()
})

describe("tool.registry", () => {
  // kilocode_change start - plan_exit is always registered
  test("plan_exit is always registered regardless of client", async () => {
    const original = process.env["KILO_CLIENT"]
    try {
      for (const client of ["cli", "vscode", "desktop", "app"]) {
        process.env["KILO_CLIENT"] = client
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            const ids = await ToolRegistry.ids()
            expect(ids).toContain("plan_exit")
          },
        })
      }
    } finally {
      if (original === undefined) delete process.env["KILO_CLIENT"]
      else process.env["KILO_CLIENT"] = original
    }
  })
  // kilocode_change end

  // kilocode_change start
  test("suggest is registered for cli and vscode only", async () => {
    const original = process.env["KILO_CLIENT"]
    const originalQuestion = process.env["KILO_ENABLE_QUESTION_TOOL"]
    const originalConfig = process.env["KILO_CONFIG_DIR"]
    try {
      for (const client of ["cli", "vscode", "desktop", "app"]) {
        process.env["KILO_CLIENT"] = client
        process.env["KILO_ENABLE_QUESTION_TOOL"] = client === "vscode" ? "true" : "false"
        await using tmp = await tmpdir({ git: true })
        process.env["KILO_CONFIG_DIR"] = tmp.path
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            const ids = await ToolRegistry.ids()
            if (client === "cli" || client === "vscode") expect(ids).toContain("suggest")
            else expect(ids).not.toContain("suggest")
          },
        })
      }
    } finally {
      if (original === undefined) delete process.env["KILO_CLIENT"]
      else process.env["KILO_CLIENT"] = original
      if (originalQuestion === undefined) delete process.env["KILO_ENABLE_QUESTION_TOOL"]
      else process.env["KILO_ENABLE_QUESTION_TOOL"] = originalQuestion
      if (originalConfig === undefined) delete process.env["KILO_CONFIG_DIR"]
      else process.env["KILO_CONFIG_DIR"] = originalConfig
    }
  })
  // kilocode_change end

  test("loads tools from .opencode/tool (singular)", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const opencodeDir = path.join(dir, ".opencode")
        await fs.mkdir(opencodeDir, { recursive: true })

        const toolDir = path.join(opencodeDir, "tool")
        await fs.mkdir(toolDir, { recursive: true })

        await Bun.write(
          path.join(toolDir, "hello.ts"),
          [
            "export default {",
            "  description: 'hello tool',",
            "  args: {},",
            "  execute: async () => {",
            "    return 'hello world'",
            "  },",
            "}",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ids = await ToolRegistry.ids()
        expect(ids).toContain("hello")
      },
    })
  })

  test("loads tools from .opencode/tools (plural)", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const opencodeDir = path.join(dir, ".opencode")
        await fs.mkdir(opencodeDir, { recursive: true })

        const toolsDir = path.join(opencodeDir, "tools")
        await fs.mkdir(toolsDir, { recursive: true })

        await Bun.write(
          path.join(toolsDir, "hello.ts"),
          [
            "export default {",
            "  description: 'hello tool',",
            "  args: {},",
            "  execute: async () => {",
            "    return 'hello world'",
            "  },",
            "}",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ids = await ToolRegistry.ids()
        expect(ids).toContain("hello")
      },
    })
  })

  test("loads tools with external dependencies without crashing", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const opencodeDir = path.join(dir, ".opencode")
        await fs.mkdir(opencodeDir, { recursive: true })

        const toolsDir = path.join(opencodeDir, "tools")
        await fs.mkdir(toolsDir, { recursive: true })

        await Bun.write(
          path.join(opencodeDir, "package.json"),
          JSON.stringify({
            name: "custom-tools",
            dependencies: {
              "@kilocode/plugin": "^0.0.0",
              cowsay: "^1.6.0",
            },
          }),
        )

        await Bun.write(
          path.join(opencodeDir, "package-lock.json"),
          JSON.stringify({
            name: "custom-tools",
            lockfileVersion: 3,
            packages: {
              "": {
                dependencies: {
                  "@kilocode/plugin": "^0.0.0",
                  cowsay: "^1.6.0",
                },
              },
            },
          }),
        )

        const cowsayDir = path.join(opencodeDir, "node_modules", "cowsay")
        await fs.mkdir(cowsayDir, { recursive: true })
        await Bun.write(
          path.join(cowsayDir, "package.json"),
          JSON.stringify({
            name: "cowsay",
            type: "module",
            exports: "./index.js",
          }),
        )
        await Bun.write(
          path.join(cowsayDir, "index.js"),
          ["export function say({ text }) {", "  return `moo ${text}`", "}", ""].join("\n"),
        )

        await Bun.write(
          path.join(toolsDir, "cowsay.ts"),
          [
            "import { say } from 'cowsay'",
            "export default {",
            "  description: 'tool that imports cowsay at top level',",
            "  args: { text: { type: 'string' } },",
            "  execute: async ({ text }: { text: string }) => {",
            "    return say({ text })",
            "  },",
            "}",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ids = await ToolRegistry.ids()
        expect(ids).toContain("cowsay")
      },
    })
  })
})
