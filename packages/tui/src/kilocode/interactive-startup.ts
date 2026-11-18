import { batch, createSignal } from "solid-js"
import { Effect, Fiber } from "effect"
import type { CliRenderer, ThemeMode } from "@opentui/core"
import type { TuiInput } from "../app"
import { isLocationNotFoundError } from "@opencode/client"

export * as InteractiveStartup from "./interactive-startup"

export function transport(fetch: typeof globalThis.fetch, wait?: (signal?: AbortSignal) => Promise<void>) {
  if (!wait) return fetch
  let ready = false
  return (async (request, init) => {
    if (!ready) {
      await wait(init?.signal ?? (request instanceof Request ? request.signal : undefined))
      ready = true
    }
    return fetch(request, init)
  }) as typeof fetch
}

export function workspace<A extends { directory: string }, E>(input: TuiInput, locate: Effect.Effect<A, E>) {
  return Effect.gen(function* () {
    const local =
      process.env.OPENCODE_TUI_OVERLAP_STARTUP === "1" &&
      input.server.local &&
      !input.terminalHandoff &&
      !process.env.OPENCODE_DRIVE
    const early =
      local &&
      !input.args.continue &&
      !input.args.sessionID &&
      !input.args.newSessionID &&
      !process.env.OPENCODE_ROUTE &&
      !process.env.OPENCODE_STORY
    // A deleted location can be changed from Home. A dead or unauthorized server is a startup error,
    // not a usable workspace; preserve that failure rather than stranding the editor.
    const pending = early
      ? yield* Effect.forkChild(
          locate.pipe(
            Effect.catchIf(
              (error) =>
                isLocationNotFoundError(error) || (error instanceof Error && isLocationNotFoundError(error.cause)),
              () => Effect.succeed({ directory: process.cwd() }),
            ),
          ),
          { startImmediately: true },
        )
      : undefined
    const [confirmed, setConfirmed] = createSignal(!early)
    const [directory, setDirectory] = createSignal(pending ? process.cwd() : (yield* locate).directory)
    return {
      directory,
      confirmed: early ? confirmed : undefined,
      untilExit: (exit: Effect.Effect<void>) =>
        pending
          ? Effect.raceFirst(
              exit,
              Fiber.join(pending).pipe(
                Effect.tap((location) =>
                  Effect.sync(() =>
                    batch(() => {
                      setDirectory(location.directory)
                      setConfirmed(true)
                    }),
                  ),
                ),
                Effect.andThen(exit),
              ),
            )
          : exit,
      async colors(renderer: CliRenderer, handoff: ThemeMode | null | undefined, setting?: string) {
        const locked = process.env.OPENCODE_TUI_USE_PINNED_MODE === "1" ? setting : undefined
        const pinned = handoff ?? (locked === "light" || locked === "dark" ? locked : undefined)
        if (pinned) return { mode: pinned }
        const detection = renderer.waitForThemeMode(1000)
        return {
          mode: (local ? renderer.themeMode : await detection) ?? "dark",
          detecting: local ? detection.catch(() => null) : undefined,
        } as const
      },
    }
  })
}
