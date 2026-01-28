import z from "zod"
import { EOL } from "os"
import { NamedError } from "@opencode-ai/util/error"

export namespace UI {
  // kilocode_change start
  const LOGO = [
    `██ ▄█▀ ██ ██     ▄████▄   ▄█████ ██     ██ `,
    `████   ██ ██     ██  ██   ██     ██     ██ `,
    `██ ▀█▄ ██ ██████ ▀████▀   ▀█████ ██████ ██ `,
  ]
  // kilocode_change end

  export const CancelledError = NamedError.create("UICancelledError", z.void())

  export const Style = {
    TEXT_HIGHLIGHT: "\x1b[96m",
    TEXT_HIGHLIGHT_BOLD: "\x1b[96m\x1b[1m",
    TEXT_DIM: "\x1b[90m",
    TEXT_DIM_BOLD: "\x1b[90m\x1b[1m",
    TEXT_NORMAL: "\x1b[0m",
    TEXT_NORMAL_BOLD: "\x1b[1m",
    TEXT_WARNING: "\x1b[93m",
    TEXT_WARNING_BOLD: "\x1b[93m\x1b[1m",
    TEXT_DANGER: "\x1b[91m",
    TEXT_DANGER_BOLD: "\x1b[91m\x1b[1m",
    TEXT_SUCCESS: "\x1b[92m",
    TEXT_SUCCESS_BOLD: "\x1b[92m\x1b[1m",
    TEXT_INFO: "\x1b[94m",
    TEXT_INFO_BOLD: "\x1b[94m\x1b[1m",
  }

  export function println(...message: string[]) {
    print(...message)
    Bun.stderr.write(EOL)
  }

  export function print(...message: string[]) {
    blank = false
    Bun.stderr.write(message.join(" "))
  }

  let blank = false
  export function empty() {
    if (blank) return
    println("" + Style.TEXT_NORMAL)
    blank = true
  }

  // kilocode_change start
  export function logo(pad?: string) {
    const yellow = "\x1b[93m" // bright yellow
    const result = []
    for (const row of LOGO) {
      if (pad) result.push(pad)
      result.push(yellow)
      result.push(row)
      result.push("\x1b[0m")
      result.push(EOL)
    }
    return result.join("").trimEnd()
  }
  // kilocode_change end

  export async function input(prompt: string): Promise<string> {
    const readline = require("readline")
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    return new Promise((resolve) => {
      rl.question(prompt, (answer: string) => {
        rl.close()
        resolve(answer.trim())
      })
    })
  }

  export function error(message: string) {
    println(Style.TEXT_DANGER_BOLD + "Error: " + Style.TEXT_NORMAL + message)
  }

  export function markdown(text: string): string {
    return text
  }
}
