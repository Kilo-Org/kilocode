import { Pty } from "@opencode-ai/core/pty"
import { PersistentPty } from "@opencode-ai/core/persistent-pty"
import { Effect, Layer } from "effect"
import { parseSandboxConfig, type SandboxConfig } from "./sandbox"

/**
 * Refuse user-facing session terminals while the OS sandbox is active. v1's sandbox refused to
 * enable while interactive terminals were live (origin/main
 * packages/opencode/src/kilocode/sandbox/activation.ts:66-118); v2 decides the sandbox at launch
 * before terminals exist, so the parity point is creation time. The decorated service fails
 * `create` before any process spawns; existing terminals keep working. The separate decorator below also refuses
 * persistent-terminal creation, while preserving its host-trusted daemon infrastructure.
 *
 * The refusal is a defect, matching the public contract: `Pty.Interface.create` has an empty
 * error channel and the `pty.create` endpoint declares no error, so the refusal surfaces as an
 * untyped HTTP failure instead of a protocol change.
 */
export function sandboxPtyRefusalLayer(config: SandboxConfig): Layer.Layer<Pty.Service, never, Pty.Service> {
  const parsed = parseSandboxConfig(config)
  if (!parsed.enabled) throw new Error("sandbox PTY refusal requires an enabled sandbox config")
  return Layer.effect(
    Pty.Service,
    Effect.gen(function* () {
      const inner = yield* Pty.Service
      return Pty.Service.of({
        list: inner.list,
        get: inner.get,
        create: () => Effect.die(new Error("interactive terminals are unavailable while the OS sandbox is enabled")),
        update: inner.update,
        remove: inner.remove,
        write: inner.write,
        attach: inner.attach,
      })
    }),
  )
}

/**
 * Composition-root replacement: decorate Pty.node's implementation while preserving its
 * dependency wiring and service contract (ProviderNode.mapLayer — no new composition edges, no
 * self-reference). The host installs it through profile().overrides only when the sandbox is
 * enabled, so a non-sandbox host keeps the stock Pty service.
 */
export function sandboxPtyRefusalReplacement(config: SandboxConfig) {
  return Pty.node.replace(Pty.node.mapLayer((layer) => sandboxPtyRefusalLayer(config).pipe(Layer.provide(layer))))
}

/**
 * Same refusal for the TUI's persistent session terminals: the interactive terminal path calls
 * `experimental.persistentPty.create` (packages/tui/src/context/session-terminals.tsx), which is
 * user-facing, not trusted daemon infrastructure. `PersistentPty.Interface.create` declares
 * `UnavailableError`, so the refusal fails through the existing declared channel — the HTTP
 * handler maps it to ServiceUnavailableError without any Protocol edit. Only `create` is
 * denied: reads, attach, input, remove, and the actual daemon plumbing stay with the inner
 * service.
 */
export function sandboxPersistentPtyRefusalLayer(
  config: SandboxConfig,
): Layer.Layer<PersistentPty.Service, never, PersistentPty.Service> {
  const parsed = parseSandboxConfig(config)
  if (!parsed.enabled) throw new Error("sandbox PTY refusal requires an enabled sandbox config")
  return Layer.effect(
    PersistentPty.Service,
    Effect.gen(function* () {
      const inner = yield* PersistentPty.Service
      return PersistentPty.Service.of({
        list: inner.list,
        get: inner.get,
        create: () =>
          Effect.fail(
            new PersistentPty.UnavailableError({
              message: "interactive terminals are unavailable while the OS sandbox is enabled",
            }),
          ),
        write: inner.write,
        resize: inner.resize,
        control: inner.control,
        input: inner.input,
        snapshot: inner.snapshot,
        read: inner.read,
        remove: inner.remove,
        shutdown: inner.shutdown,
        handoff: inner.handoff,
        attach: inner.attach,
      })
    }),
  )
}

export function sandboxPersistentPtyRefusalReplacement(config: SandboxConfig) {
  return PersistentPty.node.replace(
    PersistentPty.node.mapLayer((layer) => sandboxPersistentPtyRefusalLayer(config).pipe(Layer.provide(layer))),
  )
}
