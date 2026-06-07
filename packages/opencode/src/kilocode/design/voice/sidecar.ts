// Child-process voice source. Spawns a helper command that speaks the Voice
// Helper Protocol (JSONL on stdout, commands on stdin) and adapts it to the
// VoiceAdapter seam. Used for `--voice local --voice-helper-command "<cmd>"`
// and, later, for the bundled Swift sidecar. Keeping a generic JSONL helper as
// a first-class path lets us exercise the exact same code with a scripted
// helper before any native binary exists.

import { Process, type Child } from "@/util/process"
import * as Log from "@opencode-ai/core/util/log"
import type { VoiceAdapter } from "./adapter"
import { createJsonlParser, encodeCommand, type VoiceCommand, type VoiceEvent } from "./protocol"

const log = Log.create({ service: "design.voice.sidecar" })

export type SidecarOpts = {
  /** Command argv to spawn (e.g. ["swift", "run", "kilo-voice-sidecar"]). */
  command: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  /** Run the command through a shell (so a single quoted string works). */
  shell?: boolean
  activation?: "continuous" | "push-to-talk"
}

export function createSidecarVoice(opts: SidecarOpts): VoiceAdapter {
  let child: Child | undefined
  let emit: ((event: VoiceEvent) => void) | undefined

  function command(cmd: VoiceCommand) {
    if (child?.stdin && !child.stdin.destroyed) {
      child.stdin.write(encodeCommand(cmd))
    }
  }

  return {
    start(onEvent) {
      emit = onEvent
      const proc = Process.spawn(opts.command, {
        cwd: opts.cwd,
        env: opts.env,
        shell: opts.shell,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      })
      child = proc

      const parser = createJsonlParser()
      proc.stdout?.setEncoding("utf8")
      proc.stdout?.on("data", (chunk: string) => {
        for (const event of parser.write(chunk)) emit?.(event)
      })
      proc.stderr?.setEncoding("utf8")
      proc.stderr?.on("data", (chunk: string) => {
        log.info("sidecar stderr", { chunk: chunk.trimEnd() })
      })
      proc.once("error", (err) => {
        emit?.({ type: "error", message: `voice helper failed to start: ${err.message}` })
      })
      proc.exited.then(
        (code) => {
          for (const event of parser.flush()) emit?.(event)
          if (code !== 0) emit?.({ type: "error", message: `voice helper exited (code ${code})` })
        },
        () => {},
      )

      if (opts.activation) command({ type: "set-activation", value: opts.activation })
    },
    send(cmd) {
      command(cmd)
    },
    reset() {
      command({ type: "reset" })
    },
    async shutdown() {
      emit = undefined
      if (!child) return
      command({ type: "shutdown" })
      const proc = child
      child = undefined
      await Promise.race([proc.exited.catch(() => 0), Bun.sleep(500)])
      await Process.stop(proc)
    },
  }
}
