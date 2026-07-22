import { existsSync } from "node:fs"
import { Effect } from "effect"
import type { Backend, Launch, Support } from "./backend"
import type { PathRule, Profile } from "./profile"
import { base } from "./seatbelt-base"
import { networkPolicy } from "./seatbelt-network"
import type { ProxyRuntime } from "./proxy"

const executable = "/usr/bin/sandbox-exec"

interface Param {
  readonly key: string
  readonly value: string
}

function filter(rule: PathRule, key: string) {
  if (rule.kind === "literal") return `(literal (param "${key}"))`
  return `(require-any (literal (param "${key}")) (subpath (param "${key}")))`
}

function escape(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function quote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

function exclude(rule: PathRule, key: string) {
  if (rule.kind === "literal") return [`(require-not (literal (param "${key}")))`]
  return [`(require-not (literal (param "${key}")))`, `(require-not (subpath (param "${key}")))`]
}

function policy(profile: Profile, proxy?: ProxyRuntime) {
  const params: Array<Param> = []
  const allow = profile.filesystem.allowWrite.map((rule, index) => {
    const key = `ALLOW_WRITE_${index}`
    params.push({ key, value: rule.path })
    return filter(rule, key)
  })
  const deny = profile.filesystem.denyWrite.flatMap((rule, index) => {
    const key = `DENY_WRITE_${index}`
    params.push({ key, value: rule.path })
    return exclude(rule, key)
  })
  const names = profile.filesystem.denyNames.map((name) => `(require-not (regex #"(^|/)${escape(name)}(/|$)"))`)
  const write =
    allow.length === 0
      ? ""
      : `(allow file-write*\n  (require-all\n    (require-any ${allow.join(" ")})\n    ${[...deny, ...names].join("\n    ")}\n  )\n)`
  return {
    value: [
      base,
      networkPolicy(profile, proxy),
      "; reads are not confined by the file-level sandbox\n(allow file-read*)",
      write,
    ].join("\n"),
    params,
  }
}

export function generate(profile: Profile, launch: Launch, proxy?: ProxyRuntime): Launch {
  const generated = policy(profile, proxy)
  const args = ["-p", generated.value, ...generated.params.map((param) => `-D${param.key}=${param.value}`)]
  const command = launch.shell ? (typeof launch.shell === "string" ? launch.shell : "/bin/sh") : launch.command
  const commandArgs = launch.shell ? ["-c", [launch.command, ...launch.args.map(quote)].join(" ")] : launch.args
  args.push("--", command, ...commandArgs)
  return {
    ...launch,
    command: executable,
    args,
  }
}

const available: Support = existsSync(executable)
  ? { available: true }
  : { available: false, reason: `${executable} is not available` }

export const seatbelt: Backend = {
  support: () => available,
  prepare: (profile, launch, proxy) => Effect.succeed(generate(profile, launch, proxy)),
}
