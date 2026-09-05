import { Config } from "@opencode-ai/core/config"
import { ConfigNormalize } from "@opencode-ai/core/config/normalize"
import { Form } from "@opencode-ai/core/form"
import { Instance } from "@opencode-ai/core/instance/service"
import { LocationMutation } from "@opencode-ai/core/location-mutation"
import { Location } from "@opencode-ai/core/location"
import { Permission } from "@opencode-ai/core/permission"
import { Session } from "@opencode-ai/core/session"
import { ShellParse } from "@opencode-ai/core/shell/parse"
import { ShellSelect } from "@opencode-ai/core/shell/select"
import { Skill } from "@opencode-ai/core/skill"
import { Tool } from "@opencode-ai/core/tool"
import { Info, type Entry } from "@opencode-ai/schema/config"
import { Global } from "@opencode-ai/util/global"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Schema, Effect, Option } from "effect"
import { parse, type ParseError } from "jsonc-parser"
import { realpathSync } from "node:fs"
import { realpath } from "node:fs/promises"
import path from "node:path"
import type { Layout } from "./paths"
import { BUILTIN_LOCATION, KILO_CONFIG_ID } from "./skill-policy"
import { render, type RenderInput } from "./skill-shell-render"

export interface SkillShellOptions {
  readonly layout: Layout
  readonly sessions: Session.Interface
  readonly instances: Instance.Interface
  readonly global: Global.Interface
  readonly fs: FSUtil.Interface
  /** The exact host-injected profile content, when the host used content instead of a file. */
  readonly profileContent?: string
  readonly disabled?: boolean
}

/**
 * Called after the native skill tool has checked permission and prepared its output. Undefined
 * means that the original native result should remain unchanged.
 */
export type SkillShell = (skillID: string, context: Tool.Context) => Effect.Effect<string | undefined, Tool.Error>

export class CancelledError extends Schema.TaggedError<CancelledError>()("KiloSkillShell.CancelledError", {}) {
  override get message() {
    return "Skill shell execution was cancelled"
  }
}

export interface TrustInput {
  readonly skill: Pick<Skill.Info, "id" | "location">
  readonly entries: readonly Entry[]
  readonly directory: string
  readonly projectRoot: string
  readonly profileFile: string
  readonly home: string
  readonly profileContent?: string
  readonly builtinID?: string
  readonly builtinLocation?: string
}

/** Source-origin trust check kept in the Kilo host rather than inferred from Skill.Info. */
export function isTrustedSkill(input: TrustInput) {
  return Effect.gen(function* () {
    const builtinID = input.builtinID ?? String(KILO_CONFIG_ID)
    const builtinLocation = input.builtinLocation ?? String(BUILTIN_LOCATION)
    if (String(input.skill.id) === builtinID && String(input.skill.location) === builtinLocation) return true

    const project = yield* canonical(input.projectRoot)
    const candidate = yield* canonical(String(input.skill.location))
    if (!project || !candidate || contains(project, candidate)) return false

    const sources = sourceRoots(input)
    const trusted = yield* Effect.forEach(sources.trusted, canonical)
    const untrusted = yield* Effect.forEach(sources.untrusted, canonical)
    const trustedRoots = trusted.filter((root): root is string => root !== undefined)
    const untrustedRoots = untrusted.filter((root): root is string => root !== undefined)
    for (const root of trustedRoots) {
      if (contains(project, root) || !contains(root, candidate)) continue
      if (untrustedRoots.some((other) => contains(other, root) || contains(root, other))) return false
      return true
    }
    return false
  })
}

/** Project-scoped sources cannot escape their project through a symlink or external root. */
export function isProjectScopedEscape(input: TrustInput) {
  const candidate = path.resolve(String(input.skill.location))
  const project = path.resolve(input.projectRoot)
  const roots = projectSourceRoots(input)
  if (!roots.some((root) => contains(path.resolve(root), candidate))) return false
  const canonical = realpathNow(String(input.skill.location))
  return canonical === undefined || !contains(project, canonical)
}

export function createSkillShell(options: SkillShellOptions): SkillShell {
  return (skillID, context) =>
    options.sessions.get(context.sessionID).pipe(
      Effect.flatMap((session) =>
        options.instances.provide(session)(
          Effect.gen(function* () {
            const config = yield* Config.Service
            const forms = yield* Form.Service
            const location = yield* Location.Service
            const mutation = yield* LocationMutation.Service
            const permission = yield* Permission.Service
            const shellSelect = yield* ShellSelect.Service
            const skills = yield* Skill.Service
            const tools = yield* Tool.Service
            const skill = yield* skills.get(Skill.ID.make(skillID))
            if (!skill) return undefined
            const entries = yield* config.entries()
            const trustInput = {
              skill,
              entries,
              directory: location.directory,
              projectRoot: location.project.directory,
              profileFile: options.layout.config,
              home: options.global.home,
              ...(options.profileContent === undefined ? {} : { profileContent: options.profileContent }),
            } satisfies TrustInput
            if (isProjectScopedEscape(trustInput))
              return yield* new Tool.Error({ message: "Skill source is outside the project boundary" })
            const trusted = yield* isTrustedSkill(trustInput)
            const shell = yield* shellSelect.resolve({ priority: "compat" })

            const run: RenderInput<Tool.Error>["run"] = (command) =>
              runCommand({
                command,
                shell,
                cwd: location.directory,
                context,
                tools,
              })
            const authorize: RenderInput<Tool.Error>["authorize"] = (commands) =>
              authorizeCommands({
                commands,
                shell,
                cwd: location.directory,
                context,
                forms,
                mutation,
                permission,
                skillID,
              }).pipe(
                Effect.mapError((error) =>
                  error instanceof Tool.Error
                    ? error
                    : new Tool.Error({ message: "Unable to authorize skill shell commands" }),
                ),
              )
            const rendered = yield* render({
              content: skill.content,
              trusted,
              disabled: options.disabled === true,
              authorize,
              run,
            })
            if (rendered === undefined) return undefined
            const output = yield* Skill.prepare(options.fs, { ...skill, content: rendered })
            return output.output
          }),
        ),
      ),
      Effect.mapError((error) =>
        error instanceof Tool.Error ? error : new Tool.Error({ message: `Unable to expand skill ${skillID}` }),
      ),
    )
}

function authorizeCommands(input: {
  readonly commands: readonly string[]
  readonly shell: string
  readonly cwd: string
  readonly context: Tool.Context
  readonly forms: Form.Interface
  readonly mutation: LocationMutation.Interface
  readonly permission: Permission.Interface
  readonly skillID: string
}) {
  return Effect.gen(function* () {
    const scans = yield* Effect.forEach(input.commands, (command) =>
      ShellParse.scanPortable(command, input.shell, input.cwd).pipe(
        Effect.mapError(() => new Tool.Error({ message: "Unable to safely analyze a skill shell command" })),
      ),
    )
    const directories = yield* Effect.forEach(unique(scans.flatMap((scan) => scan.directories)), (directory) =>
      input.mutation.resolve({
        path: LocationMutation.resolvePath(input.cwd, directory),
        kind: "directory",
      }),
    )
    const external = unique(
      directories
        .flatMap((target) => (target.externalDirectory === undefined ? [] : [target.externalDirectory]))
        .map((target) => target.resource),
    )
    if (external.length > 0)
      yield* input.permission.assert({
        action: "external_directory",
        resources: external,
        save: [],
        sessionID: input.context.sessionID,
        agent: input.context.agent,
        source: { type: "tool", messageID: input.context.messageID, id: input.context.id },
      })
    const resources = unique([
      ...input.commands,
      ...scans.flatMap((scan) => scan.commands.map((item) => item.resource)),
    ])
    if (resources.length === 0)
      return yield* new Tool.Error({ message: "Skill shell commands have no authorizable resources" })
    yield* input.permission.assert({
      action: "shell",
      resources,
      save: [],
      sessionID: input.context.sessionID,
      agent: input.context.agent,
      source: { type: "tool", messageID: input.context.messageID, id: input.context.id },
    })
    const state = yield* input.forms.ask({
      sessionID: input.context.sessionID,
      title: `Run shell commands from skill "${displayCommand(input.skillID)}"?`,
      metadata: {
        kind: "skill-shell",
        skillShell: true,
        skill: input.skillID,
        commands: input.commands,
        ...(external.length > 0 ? { externalDirectories: external } : {}),
      },
      fields: [
        {
          key: "allow",
          title: "Run commands",
          description: [
            ...input.commands.map(displayCommand),
            ...(external.length > 0 ? ["", "External directories:", ...external.map(displayCommand)] : []),
          ].join("\n"),
          type: "boolean",
          required: true,
        },
      ],
    })
    if (state.status === "cancelled") return yield* Effect.die(new CancelledError())
    if (state.answer.allow !== true) return yield* new Tool.Error({ message: "Skill shell commands were rejected" })
  })
}

function runCommand(input: {
  readonly command: string
  readonly shell: string
  readonly cwd: string
  readonly context: Tool.Context
  readonly tools: Tool.Interface
}) {
  return Effect.gen(function* () {
    const snapshot = yield* input.tools.snapshot()
    const result = yield* snapshot.execute({
      sessionID: input.context.sessionID,
      agent: input.context.agent,
      messageID: input.context.messageID,
      call: {
        type: "tool-call",
        id: `${String(input.context.id)}:skill-shell`,
        name: "shell",
        input: {
          command: input.command,
          workdir: input.cwd,
          timeout: 2 * 60 * 1000,
        },
      },
      progress: input.context.progress,
    })
    const output = result.output
    const text: unknown = output && typeof output === "object" ? Reflect.get(output, "output") : undefined
    if (typeof text !== "string") {
      return yield* new Tool.Error({ message: "Native shell returned an unusable result" })
    }
    return text
  }).pipe(
    Effect.catch((error: Tool.Error) => {
      if (isPermissionFailure(error)) return Effect.fail(error)
      return Effect.succeed("[skill shell command failed]")
    }),
  )
}

function isPermissionFailure(error: Tool.Error) {
  return (
    error.error instanceof Permission.BlockedError ||
    error.error instanceof Permission.CorrectedError ||
    error.error instanceof Permission.DeclinedError
  )
}

function sourceRoots(input: TrustInput) {
  const trusted: string[] = []
  const untrusted: string[] = []
  const contentRoots = input.profileContent === undefined ? [] : profileContentRoots(input.profileContent, input.home)
  const contentMatches = input.entries.filter(
    (entry) =>
      entry.type === "document" &&
      entry.path === undefined &&
      sameRoots(absoluteSkillRoots(entry.info.skills ?? [], input.home), contentRoots),
  )
  const contentIsUnique = contentRoots.length > 0 && contentMatches.length <= 1
  for (const entry of input.entries) {
    if (entry.type === "document") {
      const profile = entry.path !== undefined && path.resolve(entry.path) === path.resolve(input.profileFile)
      const content = contentIsUnique && entry.path === undefined && contentMatches.includes(entry)
      const roots =
        profile || content
          ? absoluteSkillRoots(entry.info.skills ?? [], input.home)
          : sourceSkillRoots(entry.info.skills ?? [], input.home, input.directory)
      ;(profile || content ? trusted : untrusted).push(...roots)
      continue
    }
    const roots =
      entry.type === "agents" || entry.type === "claude"
        ? [path.join(entry.path, "skills")]
        : entry.type === "directory"
          ? [path.join(entry.path, "skill"), path.join(entry.path, "skills")]
          : []
    untrusted.push(...roots)
  }
  if (contentIsUnique) trusted.push(...contentRoots)
  return { trusted, untrusted }
}

function projectSourceRoots(input: TrustInput) {
  const project = path.resolve(input.projectRoot)
  const profileFile = path.resolve(input.profileFile)
  return input.entries.flatMap((entry) => {
    if (entry.type === "document") {
      if (
        entry.path === undefined ||
        path.resolve(entry.path) === profileFile ||
        !contains(project, path.resolve(entry.path))
      )
        return []
      return sourceSkillRoots(entry.info.skills ?? [], input.home, input.directory)
    }
    if (!contains(project, path.resolve(entry.path))) return []
    return entry.type === "agents" || entry.type === "claude"
      ? [path.join(entry.path, "skills")]
      : entry.type === "directory"
        ? [path.join(entry.path, "skill"), path.join(entry.path, "skills")]
        : []
  })
}

function absoluteSkillRoots(items: readonly string[], home: string) {
  return items.flatMap((item) => {
    if (isHTTPURL(item)) return []
    const expanded = item.startsWith("~/") ? path.join(home, item.slice(2)) : item
    return path.isAbsolute(expanded) ? [path.resolve(expanded)] : []
  })
}

function sourceSkillRoots(items: readonly string[], home: string, directory: string) {
  return items.flatMap((item) => {
    if (isHTTPURL(item)) return []
    const expanded = item.startsWith("~/") ? path.join(home, item.slice(2)) : item
    return [path.resolve(directory, expanded)]
  })
}

function sameRoots(left: readonly string[], right: readonly string[]) {
  return left.length > 0 && left.length === right.length && left.every((root) => right.includes(root))
}

function profileContentRoots(content: string, home: string) {
  const errors: ParseError[] = []
  const raw: unknown = parse(content, errors, { allowTrailingComma: true })
  if (errors.length > 0) return []
  const normalized = ConfigNormalize.normalize(raw)
  if (normalized.type === "rejected") return []
  const info = Option.getOrUndefined(Schema.decodeUnknownOption(Info)(normalized.encoded))
  return info ? absoluteSkillRoots(info.skills ?? [], home) : []
}

function isHTTPURL(value: string) {
  return URL.canParse(value) && /^(https?:)$/.test(new URL(value).protocol)
}

function canonical(value: string) {
  return Effect.promise(() => realpath(value)).pipe(Effect.orElseSucceed(() => undefined))
}

function realpathNow(value: string) {
  try {
    return realpathSync.native(value)
  } catch {
    return undefined
  }
}

function contains(parent: string, child: string) {
  const relative = path.relative(parent, child)
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
}

function unique(values: readonly string[]) {
  return Array.from(new Set(values))
}

function displayCommand(command: string) {
  return command.replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, (char) => {
    if (char === "\n") return "\\n"
    if (char === "\r") return "\\r"
    if (char === "\t") return "\\t"
    const code = char.charCodeAt(0)
    return code <= 0xff ? `\\x${code.toString(16).padStart(2, "0")}` : `\\u${code.toString(16).padStart(4, "0")}`
  })
}
