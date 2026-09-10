import path from "node:path"

export function parseTuiArgs(args: string[]): {
  directory?: string
  sessionID?: string
  sandbox?: boolean
  swarm?: boolean
  projectConfig?: boolean
  indexingConfig?: string
} {
  if (args[0] === "--sandbox") return { ...parseTuiArgs(args.slice(1)), sandbox: true }
  if (args[0] === "--swarm") return { ...parseTuiArgs(args.slice(1)), swarm: true }
  if (args[0] === "--project-config") return { ...parseTuiArgs(args.slice(1)), projectConfig: true }
  if (args[0] === "--indexing-config") {
    if (!args[1]?.trim() || args[1].startsWith("-") || URL.canParse(args[1]))
      throw new Error("--indexing-config requires an explicit local configuration file")
    return { ...parseTuiArgs(args.slice(2)), indexingConfig: path.resolve(args[1]) }
  }
  if (!args.length) return {}
  if (args[0] === "-s" || args[0] === "--session") {
    if (args.length !== 2 || !args[1]) throw new Error("Usage: kilo2 [-s session-id] [project-directory]")
    return { sessionID: args[1] }
  }
  if (args.length === 1 && !args[0].startsWith("-")) return { directory: args[0] }
  throw new Error("Usage: kilo2 [-s session-id] [project-directory]")
}
