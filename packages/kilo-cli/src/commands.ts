import type { OpenCodeClient, SessionImportInput } from "@opencode-ai/client"
import { Session } from "@opencode-ai/schema/session"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { SessionTransfer } from "@opencode-ai/schema/session-transfer"
import { Schema } from "effect"
import path from "node:path"
import { parseArgs } from "node:util"

export const help = `Kilo internal conversation preview

Usage: kilo2 [--sandbox] [--project-config] [project-directory]
       kilo2 -s <session-id>
       kilo2 --help | --version
       kilo2 serve [--sandbox] [--project-config]
       kilo2 service start|status|stop
       kilo2 telemetry status|disable
       kilo2 telemetry enable --endpoint <collector-url>
       kilo2 attach [--directory path] [--session id]
       kilo2 acp [--directory path] [--sandbox] [--project-config]
       kilo2 cloud start <request.json> [--stream]
       kilo2 cloud send <cloud-session-id> <prompt>
       kilo2 cloud status|result <cloud-session-id> <message-id>
       kilo2 sessions [--directory path]
       kilo2 models [--directory path]
       kilo2 agents [--directory path]
       kilo2 export <session-id> [--sanitize]
       kilo2 import <v2-json-file> [--directory path]
       kilo2 import-external <local-jsonl-file> --model provider/model --agent name [--directory path]
       kilo2 external-sessions --source claude|codex --directory path [--limit 10]
       kilo2 import-v1 [--auth file] [--config file] [--gateway-server origin] [--apply]
       kilo2 run [prompt] [--session id] [--model provider/model] [--agent name]
                         [--directory path] [--auto] [--file path]... [--format text|json]
                         [--sandbox] [--project-config]
                         [--indexing-config local-file]

Sessions prints the latest 50 sessions for the selected project directory.
Models and agents print available selection metadata as JSON, without request
settings or agent system prompts. These reuse the v2 inventories and isolated config.
Export writes raw v2 transcript JSON to stdout. --sanitize uses upstream content
redaction, which can retain paths/identifiers (including subpath). Inspect before sharing.
Import creates a fresh session from a local v2 transcript, without source ancestry
or filesystem snapshots. It does not migrate V1 databases or read public share URLs.
Import-external creates a fresh session from an explicitly supplied local Claude or
Codex JSONL transcript. It requires a continuation model and agent, never reads
ambient provider histories or executes a model, and rejects unsupported content.
External-sessions lists candidates only in the explicitly supplied source directory;
it reports invalid transcripts, reads no ambient histories, and creates no sessions.
Import-v1 previews explicitly named auth/config files without opening a store.
--apply imports supported keys into the isolated profile; conflicts, existing
JSONC comments, unproven OAuth mappings, changed well-known manifests, and unmapped fields are refused.
Well-known import discovers only the explicitly supplied origin, verifies its saved
environment key, and stores the token through the local host credential writer.
Kilo device OAuth requires an explicit --gateway-server origin: v1 auth files do
not record the server. Known Kilo team/personal selection and key metadata are preserved.
Sources are never changed; reports omit credential material and config values.
Run --agent code uses a registered custom Code agent when present, otherwise native build.
/privacy on|off hides Kilo account labels in the TUI and asks before /teams or
/profile reveals them. It does not hide upstream paths, session text, or tool output.
All commands use the isolated kilo2 interactive store. One-shot commands require
exclusive ownership; stop the TUI or daemon before running them.
Serve runs the authenticated execution API in the foreground on a loopback ephemeral
port, printing its URL and password-file path. Service manages that host in the background;
attach opens a TUI on an already running daemon and leaves it running on exit.
Service status prints safe lifecycle metadata, never the authentication password.
ACP serves the Agent Client Protocol over stdin/stdout using the isolated execution host.
Build its bridge with bun run build:acp first. Protocol output contains no host credential.
Cloud start reads {message:{prompt},agent:{mode,model,variant?},repository} from a local
JSON file. Repository supports github {repo}, gitlab {url}, or git {url,token?}, plus branch.
Cloud commands use the signed-in Kilo account and selected team; they execute remotely.
Start/send print admission IDs, never stream tickets. Result may print assistant content.
Start --stream prints the admission as one JSON line, then remote event lines.
Stream failures emit an error notice without undoing the successful admission.
There is no cloud cancel endpoint in the inspected v1 client contract.
Activity telemetry is off by default. KILO_TELEMETRY_ENABLED=1 together with
KILO_TELEMETRY_ENDPOINT opts into OTLP logs of eleven registry/lifecycle event names only;
no prompts, event data, application logs, or traces are exported.
--indexing-config <file> explicitly enables the supplied indexing configuration on
TUI/serve/run/ACP. With enabled:true, source code is sent to the configured embedding
provider; inspect the file and provider before opting in. This is separate from kilo.jsonc.
Without this option no indexing engine starts. Index data defaults to isolated profile state.
--swarm explicitly enables a persistent shared board for a session and its task
descendants on TUI/serve/run/ACP. Peer messages are untrusted notes, not permission
grants, delivery guarantees, or coordination locks. Board tools obey native permissions.
Telemetry enable/disable saves consent in the isolated profile. Stop the TUI or daemon
before changing it; saved disable overrides environment opt-in. Status describes the
next host startup and never prints collector credentials.
--sandbox explicitly confines shell-tool writes to the selected project directory
and denies shell network access. Requires sandbox-exec (macOS) or bubblewrap (Linux).
It is not a read-access sandbox and does not cover PTY, MCP, or separate git spawns.
Managed service/attach do not accept this flag; they cannot change a running host's policy.
--project-config explicitly trusts Kilo JSON/JSONC project configuration and skill
sources inside the project boundary. This can configure providers, MCP and permissions;
inspect repository configuration before enabling it. Project plugins remain disabled.
Changes require a host restart. Kilo agent markdown is supported. Without this flag
only isolated profile configuration is loaded. Model-loaded trusted skills can expand
shell placeholders only after native policy checks and explicit human confirmation.
Project/remote skills cannot execute placeholders; user-invoked skills stay literal.
KILO_DISABLE_SKILL_SHELL=1 (or true) disables expansion. Headless --auto cannot confirm it.
Run prints the completed response and writes its session ID to stderr. Permissions
are rejected unless --auto explicitly grants this run's requests; questions fail
with an explanation. Run does not change saved global approval policy.
Run appends piped stdin to the prompt. Repeat --file/-f to attach local files (10 MiB
each), resolved from the invocation directory. Files are sent to the selected model.
--format json prints one completed {sessionID,text} object, not a streaming event log.
Failures write diagnostics to stderr with a nonzero exit code and no result on stdout.
`

function indexingFile(value: string | undefined) {
  if (value === undefined) return undefined
  if (!value.trim() || value.startsWith("-") || URL.canParse(value))
    throw new Error("--indexing-config requires an explicit local configuration file")
  return path.resolve(value)
}

export function parseCommand(args: string[]) {
  if (args[0] === "cloud") {
    const action = args[1]
    if (action === "start") {
      const parsed = parseArgs({
        args: args.slice(2),
        options: { stream: { type: "boolean" } },
        allowPositionals: true,
      })
      const file = parsed.positionals[0]
      if (parsed.positionals.length !== 1 || !file?.trim() || file.startsWith("-") || URL.canParse(file))
        throw new Error("Usage: kilo2 cloud start <local-request.json> [--stream]")
      return {
        type: "cloud",
        action,
        file: path.resolve(file),
        ...(parsed.values.stream ? { stream: true } : {}),
      } as const
    }
    if (action === "send" && args.length === 4 && args[2].trim() && args[3].trim())
      return { type: "cloud", action, cloudAgentSessionId: args[2], prompt: args[3] } as const
    if ((action === "status" || action === "result") && args.length === 4 && args[2].trim() && args[3].trim())
      return { type: "cloud", action, cloudAgentSessionId: args[2], messageId: args[3] } as const
    throw new Error(
      "Usage: kilo2 cloud start <request.json> | send <session-id> <prompt> | status|result <session-id> <message-id>",
    )
  }
  if (args[0] === "external-sessions") {
    const parsed = parseArgs({
      args: args.slice(1),
      options: { source: { type: "string" }, directory: { type: "string" }, limit: { type: "string" } },
      allowPositionals: false,
    })
    const source = parsed.values.source
    if (
      (source !== "claude" && source !== "codex") ||
      !parsed.values.directory?.trim() ||
      URL.canParse(parsed.values.directory)
    )
      throw new Error("Usage: kilo2 external-sessions --source claude|codex --directory <local-path> [--limit 10]")
    const limit = parsed.values.limit === undefined ? 10 : Number(parsed.values.limit)
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("External session limit must be 1–50")
    return { type: "external-sessions", source, directory: path.resolve(parsed.values.directory), limit } as const
  }
  if (args[0] === "acp") {
    const parsed = parseArgs({
      args: args.slice(1),
      options: {
        directory: { type: "string" },
        sandbox: { type: "boolean" },
        swarm: { type: "boolean" },
        "project-config": { type: "boolean" },
        "indexing-config": { type: "string" },
      },
      allowPositionals: false,
    })
    return {
      type: "acp" as const,
      directory: path.resolve(parsed.values.directory ?? process.cwd()),
      sandbox: parsed.values.sandbox,
      swarm: parsed.values.swarm,
      projectConfig: parsed.values["project-config"],
      indexingConfig: indexingFile(parsed.values["indexing-config"]),
    }
  }
  if (args[0] === "telemetry") {
    const action = args[1]
    const parsed = parseArgs({
      args: args.slice(2),
      options: { endpoint: { type: "string" } },
      allowPositionals: false,
    })
    if (action !== "status" && action !== "enable" && action !== "disable")
      throw new Error("Usage: kilo2 telemetry status|disable|enable --endpoint <collector-url>")
    if ((action === "enable") !== (parsed.values.endpoint !== undefined))
      throw new Error("Only telemetry enable requires --endpoint <collector-url>")
    return { type: "telemetry", action, endpoint: parsed.values.endpoint } as const
  }
  if (args[0] === "import-v1") {
    const parsed = parseArgs({
      args: args.slice(1),
      options: {
        auth: { type: "string" },
        config: { type: "string" },
        "gateway-server": { type: "string" },
        apply: { type: "boolean", default: false },
      },
      allowPositionals: false,
    })
    if (!parsed.values.auth && !parsed.values.config)
      throw new Error("Usage: kilo2 import-v1 --auth file | --config file [--apply]")
    if (parsed.values["gateway-server"] !== undefined && !parsed.values.auth)
      throw new Error("--gateway-server requires an explicit --auth source")
    for (const file of [parsed.values.auth, parsed.values.config]) {
      if (file !== undefined && (!file.trim() || URL.canParse(file)))
        throw new Error("Import-v1 requires explicit local file paths")
    }
    return {
      type: "import-v1" as const,
      auth: parsed.values.auth ? path.resolve(parsed.values.auth) : undefined,
      config: parsed.values.config ? path.resolve(parsed.values.config) : undefined,
      apply: parsed.values.apply,
      ...(parsed.values["gateway-server"] !== undefined ? { gatewayServer: parsed.values["gateway-server"] } : {}),
    }
  }
  if (args[0] === "service") {
    const action = args[1]
    if (args.length !== 2 || (action !== "start" && action !== "status" && action !== "stop"))
      throw new Error("Usage: kilo2 service start|status|stop")
    return { type: "service" as const, action }
  }
  if (args[0] === "attach") {
    const parsed = parseArgs({
      args: args.slice(1),
      options: { directory: { type: "string" }, session: { type: "string", short: "s" } },
      allowPositionals: false,
    })
    if (parsed.values.session !== undefined && !parsed.values.session.trim()) throw new Error("Session ID is required")
    return {
      type: "attach" as const,
      directory: path.resolve(parsed.values.directory ?? process.cwd()),
      sessionID: parsed.values.session,
    }
  }
  if (args[0] === "serve") {
    const parsed = parseArgs({
      args: args.slice(1),
      allowPositionals: false,
      options: {
        sandbox: { type: "boolean" },
        swarm: { type: "boolean" },
        "project-config": { type: "boolean" },
        "indexing-config": { type: "string" },
      },
    })
    return {
      type: "serve" as const,
      ...(parsed.values.swarm ? { swarm: true } : {}),
      ...(parsed.values.sandbox ? { sandbox: true } : {}),
      ...(parsed.values["project-config"] ? { projectConfig: true } : {}),
      ...(parsed.values["indexing-config"] !== undefined
        ? { indexingConfig: indexingFile(parsed.values["indexing-config"]) }
        : {}),
    }
  }
  if (args[0] === "run") {
    const parsed = parseArgs({
      args: args.slice(1),
      options: {
        directory: { type: "string" },
        session: { type: "string", short: "s" },
        model: { type: "string", short: "m" },
        agent: { type: "string" },
        auto: { type: "boolean", default: false },
        sandbox: { type: "boolean" },
        swarm: { type: "boolean" },
        "project-config": { type: "boolean" },
        "indexing-config": { type: "string" },
        file: { type: "string", short: "f", multiple: true },
        format: { type: "string", default: "text" },
      },
      allowPositionals: true,
    })
    if (!["text", "json"].includes(parsed.values.format)) throw new Error("Run format must be text or json")
    const model = parsed.values.model
    if (parsed.values.session !== undefined && !parsed.values.session.trim()) throw new Error("Session ID is required")
    if (parsed.values.agent !== undefined && !parsed.values.agent.trim()) throw new Error("Agent name is required")
    const slash = model?.indexOf("/") ?? -1
    if (model !== undefined && (slash < 1 || slash === model.length - 1)) {
      throw new Error("Model must have the form provider/model")
    }
    return {
      type: "run" as const,
      text: parsed.positionals.join(" "),
      directory: path.resolve(parsed.values.directory ?? process.cwd()),
      sessionID: parsed.values.session,
      model: model ? { providerID: model.slice(0, slash), id: model.slice(slash + 1) } : undefined,
      agent: parsed.values.agent,
      auto: parsed.values.auto,
      ...(parsed.values.swarm ? { swarm: true } : {}),
      ...(parsed.values.sandbox ? { sandbox: true } : {}),
      ...(parsed.values["project-config"] ? { projectConfig: true } : {}),
      ...(parsed.values["indexing-config"] !== undefined
        ? { indexingConfig: indexingFile(parsed.values["indexing-config"]) }
        : {}),
      files:
        parsed.values.file?.map((file) => {
          if (!file.trim() || (URL.canParse(file) && !/^[a-z]:[\\/]/i.test(file)))
            throw new Error("Attachments require local file paths")
          return path.resolve(file)
        }) ?? [],
      format: parsed.values.format,
    }
  }
  if (args[0] === "sessions" || args[0] === "models" || args[0] === "agents") {
    const parsed = parseArgs({
      args: args.slice(1),
      options: { directory: { type: "string" } },
      allowPositionals: false,
    })
    const directory = path.resolve(parsed.values.directory ?? process.cwd())
    if (args[0] === "models") return { type: "models" as const, directory }
    if (args[0] === "agents") return { type: "agents" as const, directory }
    return { type: "sessions" as const, directory }
  }
  if (args[0] === "export") {
    const parsed = parseArgs({
      args: args.slice(1),
      options: { sanitize: { type: "boolean", default: false } },
      allowPositionals: true,
    })
    if (parsed.positionals.length !== 1 || !parsed.positionals[0].trim())
      throw new Error("Usage: kilo2 export <session-id> [--sanitize]")
    return { type: "export" as const, sessionID: parsed.positionals[0], sanitize: parsed.values.sanitize }
  }
  if (args[0] === "import") {
    const parsed = parseArgs({
      args: args.slice(1),
      options: { directory: { type: "string" } },
      allowPositionals: true,
    })
    if (parsed.positionals.length !== 1) throw new Error("Usage: kilo2 import <v2-json-file> [--directory path]")
    if (URL.canParse(parsed.positionals[0])) throw new Error("Import accepts local v2 JSON files only")
    return {
      type: "import" as const,
      file: path.resolve(parsed.positionals[0]),
      directory: path.resolve(parsed.values.directory ?? process.cwd()),
    }
  }
  if (args[0] === "import-external") {
    const parsed = parseArgs({
      args: args.slice(1),
      options: { directory: { type: "string" }, model: { type: "string" }, agent: { type: "string" } },
      allowPositionals: true,
    })
    const file = parsed.positionals[0]
    if (parsed.positionals.length !== 1 || !file?.trim())
      throw new Error(
        "Usage: kilo2 import-external <local-jsonl-file> --model provider/model --agent name [--directory path]",
      )
    if (URL.canParse(file) && !/^[a-z]:[\\/]/i.test(file))
      throw new Error("Import-external accepts local Claude or Codex transcript files only")
    const model = parsed.values.model
    if (!model?.trim()) throw new Error("Import-external requires --model provider/model")
    const slash = model.indexOf("/")
    if (slash < 1 || slash === model.length - 1) throw new Error("Model must have the form provider/model")
    const agent = parsed.values.agent
    if (!agent?.trim()) throw new Error("Import-external requires --agent name")
    return {
      type: "import-external" as const,
      file: path.resolve(file),
      directory: path.resolve(parsed.values.directory ?? process.cwd()),
      agent,
      model: { providerID: model.slice(0, slash), id: model.slice(slash + 1) },
    }
  }
  return undefined
}

export async function executeCommand(
  client: OpenCodeClient,
  command: NonNullable<ReturnType<typeof parseCommand>>,
  signal?: AbortSignal,
) {
  if (command.type === "run") {
    const { run } = await import("./run")
    const { prepareRunInput } = await import("./run-input")
    return run(client, { ...command, ...(await prepareRunInput(command, undefined, signal)) }, signal)
  }
  if (command.type === "import-external") {
    const { importExternalTranscript } = await import("./resume-external")
    const imported = await importExternalTranscript(client, command, { signal })
    return { sessionID: imported.id }
  }
  if (
    command.type === "serve" ||
    command.type === "service" ||
    command.type === "attach" ||
    command.type === "telemetry" ||
    command.type === "acp" ||
    command.type === "external-sessions" ||
    command.type === "cloud" ||
    command.type === "import-v1"
  )
    throw new Error("Lifecycle commands are owned by the conversation host")
  if (command.type === "export") return client.session.export(command)
  if (command.type === "models" || command.type === "agents") {
    const resolved = await client.location.get({ location: { directory: command.directory } }, { signal })
    const location = { directory: resolved.directory, workspace: resolved.workspaceID }
    await client.plugin.awaitActivation({ location }, { signal })
    if (command.type === "models") {
      const inventory = await client.model.list({ location }, { signal })
      return inventory.data
        .filter((model) => model.enabled)
        .map((model) => ({ providerID: model.providerID, id: model.id, name: model.name }))
    }
    const inventory = await client.agent.list({ location }, { signal })
    return inventory.data
      .filter((agent) => !agent.hidden)
      .map((agent) => ({
        id: agent.id,
        name: agent.name,
        description: agent.description,
        mode: agent.mode,
        model: agent.model,
      }))
  }
  if (command.type === "sessions") {
    const location = await client.location.get({ location: { directory: command.directory } })
    return client.session.list({
      directory: location.directory,
      workspace: location.workspaceID,
      parentID: null,
      order: "desc",
      limit: 50,
    })
  }
  const data = Schema.decodeUnknownSync(Schema.fromJsonString(SessionTransfer.Data))(
    await Bun.file(command.file).text(),
  )
  const location = await client.location.get({ location: { directory: command.directory } })
  // JSON transcripts have no snapshot trees. Import is a portable copy, not an identity-preserving restore.
  const copy = Schema.encodeSync(SessionTransfer.Data)({
    info: {
      ...data.info,
      id: Session.ID.create(),
      parentID: undefined,
      fork: undefined,
      revert: undefined,
    },
    messages: data.messages.map((message) => ({
      ...message,
      id: SessionMessage.ID.create(),
      ...(message.type === "assistant" ? { snapshot: undefined } : {}),
    })),
  })
  // The canonical encoder emits readonly JSON arrays; generated client JSON types require mutable arrays.
  return client.session.import({
    ...copy,
    location: { directory: location.directory, workspaceID: location.workspaceID },
  } as SessionImportInput)
}
