import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { DateTime, Effect } from "effect"
import { KiloSandboxRpc } from "@opencode/schema/kilocode/sandbox"
import { Money } from "@opencode/schema/money"
import { Project } from "@opencode/schema/project"
import { AbsolutePath } from "@opencode/schema/schema"
import { Session } from "@opencode/schema/session"
import type { SessionID } from "@opencode/schema/session-id"
import type { SandboxConfig } from "../../src/sandbox/config"
import { Runtime, type Interface, type Target } from "../../src/sandbox/runtime"

export type Harness = {
  readonly directory: string
  readonly worktree: string
  config: { sandbox?: SandboxConfig.Info }
  readonly sessions: Map<string, Session.Info>
  readonly children: Map<string, readonly Target[]>
  readonly active: Set<string>
  readonly background: Set<string>
  readonly published: KiloSandboxRpc.Changed[]
}

const roots: string[] = []

export async function tempdir() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-sandbox-test-"))
  roots.push(root)
  return root
}

export async function cleanup() {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
}

export function harness(input: {
  directory: string
  worktree?: string
  config?: { sandbox?: SandboxConfig.Info }
}): Harness {
  return {
    directory: input.directory,
    worktree: input.worktree ?? input.directory,
    config: input.config ?? {},
    sessions: new Map(),
    children: new Map(),
    active: new Set(),
    background: new Set(),
    published: [],
  }
}

export function session(
  id: string,
  directory: string,
  options: { parentID?: string; metadata?: Session.Metadata } = {},
): Session.Info {
  return Session.Info.make({
    id: Session.ID.make(id),
    parentID: options.parentID ? Session.ID.make(options.parentID) : undefined,
    projectID: Project.ID.make("sandbox-test"),
    cost: Money.USD.zero,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
    location: { directory: AbsolutePath.make(directory) },
    metadata: options.metadata,
  })
}

export function addSession(value: Harness, info: Session.Info) {
  value.sessions.set(info.id, info)
  return info
}

export function runtime(value: Harness): Interface {
  return {
    directory: value.directory,
    worktree: value.worktree,
    config: Effect.sync(() => value.config),
    session: (sessionID: SessionID) => Effect.sync(() => value.sessions.get(sessionID)),
    children: (sessionID: SessionID) => Effect.sync(() => value.children.get(sessionID) ?? []),
    active: Effect.sync(() => value.active),
    background: Effect.sync(() => value.background),
    publish: (event) => Effect.sync(() => void value.published.push(event)),
  }
}

export function provide<A, E>(value: Harness, effect: Effect.Effect<A, E, Runtime>) {
  return effect.pipe(Effect.provideService(Runtime, runtime(value)))
}
