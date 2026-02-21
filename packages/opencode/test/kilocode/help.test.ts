import { describe, test, expect } from "bun:test"
import { generateHelp } from "../../src/kilocode/help"
import { AcpCommand } from "../../src/cli/cmd/acp"
import { McpCommand } from "../../src/cli/cmd/mcp"
import { RunCommand } from "../../src/cli/cmd/run"
import { GenerateCommand } from "../../src/cli/cmd/generate"
import { DebugCommand } from "../../src/cli/cmd/debug"
import { AuthCommand } from "../../src/cli/cmd/auth"
import { AgentCommand } from "../../src/cli/cmd/agent"
import { UpgradeCommand } from "../../src/cli/cmd/upgrade"
import { UninstallCommand } from "../../src/cli/cmd/uninstall"
import { ServeCommand } from "../../src/cli/cmd/serve"
import { WebCommand } from "../../src/cli/cmd/web"
import { ModelsCommand } from "../../src/cli/cmd/models"
import { StatsCommand } from "../../src/cli/cmd/stats"
import { ExportCommand } from "../../src/cli/cmd/export"
import { ImportCommand } from "../../src/cli/cmd/import"
import { PrCommand } from "../../src/cli/cmd/pr"
import { SessionCommand } from "../../src/cli/cmd/session"

const commands = [
  AcpCommand,
  McpCommand,
  RunCommand,
  GenerateCommand,
  DebugCommand,
  AuthCommand,
  AgentCommand,
  UpgradeCommand,
  UninstallCommand,
  ServeCommand,
  WebCommand,
  ModelsCommand,
  StatsCommand,
  ExportCommand,
  ImportCommand,
  PrCommand,
  SessionCommand,
] as any[]

describe("kilo help --all (markdown)", () => {
  test("contains ## heading for each known top-level command", async () => {
    const output = await generateHelp({ all: true, format: "md", commands })
    for (const cmd of ["run", "auth", "debug", "mcp", "session", "agent"]) {
      expect(output).toContain(`## kilo ${cmd}`)
    }
  })

  test("contains headings for nested subcommands", async () => {
    const output = await generateHelp({ all: true, format: "md", commands })
    expect(output).toContain("kilo auth login")
    expect(output).toContain("kilo auth logout")
    expect(output).toContain("kilo debug config")
  })
})

describe("kilo help --all (text)", () => {
  test("does NOT contain Markdown ## headings or triple-backtick fences", async () => {
    const output = await generateHelp({ all: true, format: "text", commands })
    expect(output).not.toMatch(/^##\s/m)
    expect(output).not.toContain("```")
  })

  test("still contains each command name", async () => {
    const output = await generateHelp({ all: true, format: "text", commands })
    for (const cmd of ["run", "auth", "debug", "mcp", "session", "agent"]) {
      expect(output).toContain(`kilo ${cmd}`)
    }
  })
})

describe("kilo help <command>", () => {
  test("kilo help auth contains auth subcommand headings", async () => {
    const output = await generateHelp({ command: "auth", format: "md", commands })
    expect(output).toContain("kilo auth login")
    expect(output).toContain("kilo auth logout")
    expect(output).toContain("kilo auth list")
  })

  test("kilo help auth does NOT contain run or debug headings", async () => {
    const output = await generateHelp({ command: "auth", format: "md", commands })
    expect(output).not.toContain("## kilo run")
    expect(output).not.toContain("## kilo debug")
  })
})

describe("edge cases", () => {
  test("output contains no ANSI escape sequences", async () => {
    const output = await generateHelp({ all: true, format: "md", commands })
    expect(/\x1b\[/.test(output)).toBe(false)
  })

  test("kilo help nonexistent throws unknown command error", async () => {
    expect(generateHelp({ command: "nonexistent", commands })).rejects.toThrow("unknown command")
  })
})
