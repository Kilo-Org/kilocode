import { spawn as create } from "bun-pty"
import { latch } from "../kilocode/pty/latch" // kilocode_change
import type { Opts, Proc } from "./pty"

export type { Disp, Exit, Opts, Proc } from "./pty"

export function spawn(file: string, args: string[], opts: Opts): Proc {
  const pty = create(file, args, opts)
  // kilocode_change start - bun-pty drops events emitted before listeners attach
  return latch({
    // kilocode_change end
    pid: pty.pid,
    onData(listener) {
      return pty.onData(listener)
    },
    onExit(listener) {
      return pty.onExit(listener)
    },
    write(data) {
      pty.write(data)
    },
    resize(cols, rows) {
      pty.resize(cols, rows)
    },
    kill(signal) {
      pty.kill(signal)
    },
  }) // kilocode_change
}
