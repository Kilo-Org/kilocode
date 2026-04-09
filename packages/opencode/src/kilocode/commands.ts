// All CommandModules in one place so help.ts and generate-cli-docs.ts can
// introspect them without importing index.ts (which has startup side effects).
// When upstream adds a new command to index.ts, add it here too.
import { AcpCommand } from "../cli/cmd/acp"
import { McpCommand } from "../cli/cmd/mcp"
import { TuiThreadCommand } from "../cli/cmd/tui/thread"
import { AttachCommand } from "../cli/cmd/tui/attach"
import { RunCommand } from "../cli/cmd/run"
import { GenerateCommand } from "../cli/cmd/generate"
import { DebugCommand } from "../cli/cmd/debug"
import { AuthCommand } from "../cli/cmd/auth"
import { AgentCommand } from "../cli/cmd/agent"
import { UpgradeCommand } from "../cli/cmd/upgrade"
import { UninstallCommand } from "../cli/cmd/uninstall"
import { ServeCommand } from "../cli/cmd/serve"
import { ModelsCommand } from "../cli/cmd/models"
import { StatsCommand } from "../cli/cmd/stats"
import { ExportCommand } from "../cli/cmd/export"
import { ImportCommand } from "../cli/cmd/import"
import { PrCommand } from "../cli/cmd/pr"
import { SessionCommand } from "../cli/cmd/session"
import { RemoteCommand } from "../cli/cmd/remote"
import { DbCommand } from "../cli/cmd/db"
import { ConfigCommand as ConfigCLICommand } from "../cli/cmd/config"
import { HelpCommand } from "./help-command"

// Synthetic entry for the yargs built-in .completion() command so that
// generateHelp --all and cli-reference.md include it automatically.
const CompletionCommand = {
  command: "completion",
  describe: "generate shell completion script",
  handler: () => {},
}

export const commands = [
  AcpCommand,
  McpCommand,
  TuiThreadCommand,
  AttachCommand,
  RunCommand,
  GenerateCommand,
  DebugCommand,
  AuthCommand,
  AgentCommand,
  UpgradeCommand,
  UninstallCommand,
  ServeCommand,
  ModelsCommand,
  StatsCommand,
  ExportCommand,
  ImportCommand,
  PrCommand,
  SessionCommand,
  RemoteCommand,
  DbCommand,
  ConfigCLICommand,
  HelpCommand,
  CompletionCommand,
]
