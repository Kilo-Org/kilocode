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
    return { rule, key }
  })
  const deny = profile.filesystem.denyWrite.flatMap((rule, index) => {
    const key = `DENY_WRITE_${index}`
    params.push({ key, value: rule.path })
    return exclude(rule, key)
  })
  const names = profile.filesystem.denyNames.map((name) => `(require-not (regex #"(^|/)${escape(name)}(/|$)"))`)
  const strict = allow.filter((item) => !item.rule.markers)
  const markers = allow.filter((item) => item.rule.markers)
  const excluded = strict.flatMap((item) => exclude(item.rule, item.key))
  const inside = profile.filesystem.denyNames.map((name) => `(require-not (regex #"(^|/)${escape(name)}/"))`)
  // Marker roots also let a regular file carry a denied name, but only through create and in-place
  // data writes. Renames, swaps, links and unlinks need other operations, so an existing marker can
  // never be replaced by a directory or symlink. Paths a strict root covers are excluded.
  const rules = [
    { ops: "file-write*", roots: strict, extra: names },
    { ops: "file-write*", roots: markers, extra: [...names, ...excluded] },
    {
      ops: "file-write-create file-write-data",
      roots: markers,
      extra: [...inside, "(vnode-type REGULAR-FILE)", ...excluded],
    },
  ]
  const write = rules
    .filter((item) => item.roots.length > 0)
    .map(
      (item) =>
        `(allow ${item.ops}\n  (require-all\n    (require-any ${item.roots.map((root) => filter(root.rule, root.key)).join(" ")})\n    ${[...deny, ...item.extra].join("\n    ")}\n  )\n)`,
    )
    .join("\n")
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
