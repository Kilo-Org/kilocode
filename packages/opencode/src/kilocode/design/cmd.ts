// `kilo design` — experimental, voice-steered live design iteration.
//
// Boots one in-process Kilo session and drives it from a continuous voice loop:
// speak (or type, in fake mode) → automatic turn → dispatch → edits stream back
// into the Browser Canvas. The command handler wires the real services to the
// plain-TS orchestrator and blocks until the user quits (Ctrl+C).

import type { Argv } from "yargs"
import path from "path"
import { Effect } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import { effectCmd, fail } from "@/cli/effect-cmd"
import { Bus } from "@/bus"
import { Session } from "@/session/session"
import { createActiveSession, type ModelRef } from "./session"
import { createOrchestrator } from "./orchestrator"
import { createTerminalSurface } from "./surface/terminal"
import { createFakeVoice } from "./voice/fake"
import { createSidecarVoice } from "./voice/sidecar"
import { createLocalVoice, LocalVoiceUnavailable } from "./voice/local"
import { openCanvas } from "./browser"
import type { VoiceAdapter } from "./voice/adapter"
import type { InputKind } from "./state"

const log = Log.create({ service: "design" })

function parseModel(value?: string): ModelRef | undefined {
  if (!value) return undefined
  const [providerID, ...rest] = value.split("/")
  if (!providerID || rest.length === 0) return undefined
  return { providerID, modelID: rest.join("/") }
}

type DesignArgs = {
  url?: string
  dir?: string
  voice: string
  "voice-helper-command"?: string
  "voice-backend": string
  "voice-activation": string
  "silence-ms"?: number
  "dev-command"?: string
  browser: boolean
  agent: string
  model?: string
}

export const DesignCommand = effectCmd({
  command: "design",
  describe: "experimental: voice-steered live design iteration",
  // Root the design session where the canvas lives so the agent edits that app,
  // not whatever directory the launcher happened to start in.
  directory: (args) => (args.dir ? path.resolve(process.cwd(), args.dir) : process.cwd()),
  builder: (yargs: Argv) =>
    yargs
      .option("url", {
        type: "string",
        describe: "Browser Canvas URL (the running app to steer)",
      })
      .option("dir", {
        type: "string",
        describe: "directory the design session edits (defaults to current directory)",
      })
      .option("voice", {
        type: "string",
        choices: ["fake", "local"] as const,
        default: "fake",
        describe: "voice source: fake (typed) or local (sidecar)",
      })
      .option("voice-helper-command", {
        type: "string",
        describe: "command that speaks the Voice Helper Protocol (JSONL); used with --voice local",
      })
      .option("voice-backend", {
        type: "string",
        choices: ["apple-speech", "fluidaudio-eou"] as const,
        default: "apple-speech",
        describe: "local voice backend (fluidaudio-eou lands in a later milestone)",
      })
      .option("voice-activation", {
        type: "string",
        choices: ["continuous", "push-to-talk"] as const,
        default: "continuous",
        describe: "continuous always-on listening (default) or push-to-talk",
      })
      .option("silence-ms", {
        type: "number",
        describe: "end-of-utterance silence window for local voice (default 1100)",
      })
      .option("dev-command", {
        type: "string",
        describe: "command to start the dev server (reserved; resolver lands in M3)",
      })
      .option("browser", {
        type: "boolean",
        default: true,
        describe: "auto-open the Browser Canvas (use --no-browser to skip)",
      })
      .option("agent", {
        type: "string",
        default: "build",
        describe: "agent to use for the design session",
      })
      .option("model", {
        type: "string",
        describe: "model in provider/model form, e.g. kilo/anthropic/claude-haiku-4.5 (a fast model feels best)",
      }) as Argv<DesignArgs>,
  handler: Effect.fn("Cli.design")(function* (args) {
    const input: InputKind = args.voice === "fake" ? "fake" : "voice"

    const activation = args["voice-activation"] === "push-to-talk" ? "push-to-talk" : "continuous"

    // Build the voice source.
    const adapter: VoiceAdapter = yield* Effect.gen(function* () {
      if (args.voice === "fake") return createFakeVoice()

      // An explicit helper command always wins (protocol seam / scripted turns).
      const helper = args["voice-helper-command"]
      if (helper) return createSidecarVoice({ command: [helper], shell: true, activation })

      if (args["voice-backend"] === "fluidaudio-eou") {
        return yield* fail(
          "the fluidaudio-eou backend lands in a later milestone. Use --voice-backend apple-speech (default) or --voice-helper-command.",
        )
      }

      // Bundled Apple Speech sidecar (builds from source on first run).
      try {
        return createLocalVoice({ activation, silenceMs: args["silence-ms"] })
      } catch (err) {
        if (err instanceof LocalVoiceUnavailable) return yield* fail(err.message)
        throw err
      }
    })

    const bus = yield* Bus.Service
    // Forward holder: the session is created before the orchestrator, but dispatch
    // errors must reach the orchestrator's surface once it exists.
    let reportError: (message: string) => void = () => {}
    const session = yield* createActiveSession({
      agent: args.agent,
      input,
      model: parseModel(args.model),
      target: args.url,
      onError: (message) => reportError(message),
    })

    log.info("design session started", { sessionID: session.sessionID, voice: args.voice })

    let resolveDone: () => void = () => {}
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve
    })
    let quitting = false
    const quit = () => {
      if (quitting) return
      quitting = true
      resolveDone()
    }

    // Wire the orchestrator to the surface and the session. The surface and the
    // orchestrator reference each other, so the surface's handlers close over
    // `orchestrator` (assigned just below, before any input can fire).
    const surface = createTerminalSurface({
      input,
      target: args.url,
      onLine: (text) => orchestrator.submitLine(text),
      onEscape: () => orchestrator.escape(),
      onQuit: quit,
    })

    const orchestrator = createOrchestrator({
      adapter,
      input,
      target: args.url,
      dispatch: session.dispatch,
      cancel: session.cancel,
      render: (state) => surface.setState(state),
    })
    reportError = (message) => orchestrator.reportError(message)

    // Agent busy/idle comes from the session bus, not from the dispatch promise.
    const offOpen = yield* bus.subscribeCallback(Session.Event.TurnOpen, (event) => {
      if (event.properties.sessionID === session.sessionID) orchestrator.agentOpen()
    })
    const offClose = yield* bus.subscribeCallback(Session.Event.TurnClose, (event) => {
      if (event.properties.sessionID === session.sessionID) orchestrator.agentClose(event.properties.reason)
    })

    if (args.browser && args.url) openCanvas(args.url)

    surface.start()
    yield* Effect.promise(() => orchestrator.start())

    yield* Effect.promise(() => done).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          offOpen()
          offClose()
          void orchestrator.stop()
          surface.stop()
        }),
      ),
    )
  }),
})
