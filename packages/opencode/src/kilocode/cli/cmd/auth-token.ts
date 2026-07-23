import { Effect, Option } from "effect"
import fs from "fs"
import path from "path"
import type { Argv } from "yargs"
import { Auth } from "@/auth"
import { Global } from "@opencode-ai/core/global"
import { CliError, effectCmd } from "@/cli/effect-cmd"

const DEFAULT_PROVIDER = "kilo"
export const AUTH_FILE = path.join(Global.Path.data, "auth.json")

export const tokenFor = (info: Auth.Info): Option.Option<string> => {
  switch (info.type) {
    case "oauth":
      return Option.some(info.access)
    case "api":
      return Option.some(info.key)
    case "wellknown":
      return Option.some(info.token)
  }
}

export const resolveProvider = (input: string | undefined, known: readonly string[]): string => {
  if (!input) return DEFAULT_PROVIDER
  const lower = input.toLowerCase()
  return known.find((id) => id.toLowerCase() === lower) ?? input
}

export const listConfiguredProviders = (): string[] => {
  const raw = process.env.KILO_AUTH_CONTENT
  if (raw) {
    try {
      return Object.keys(JSON.parse(raw) as Record<string, unknown>)
    } catch {
      // Mirrors `Auth.all`: a malformed `KILO_AUTH_CONTENT` falls through to reading auth.json.
    }
  }
  try {
    return Object.keys(JSON.parse(fs.readFileSync(AUTH_FILE, "utf8")) as Record<string, unknown>)
  } catch {
    return []
  }
}

export interface RunInput {
  provider?: string
  all: Record<string, Auth.Info>
  write: (chunk: string) => void
}

export const run = Effect.fn("KiloAuthToken.run")(function* (input: RunInput) {
  const provider = resolveProvider(input.provider, Object.keys(input.all))
  const info = input.all[provider]

  if (!info) {
    const known = Object.keys(input.all)
    const hint = known.length
      ? ` Configured providers: ${known.join(", ")}.`
      : " Run `kilo auth login` to authenticate."
    return yield* Effect.fail(new CliError({ message: `Not authenticated with "${provider}".${hint}` }))
  }

  const token = tokenFor(info)
  if (Option.isNone(token)) {
    return yield* Effect.fail(new CliError({ message: `No token available for "${provider}".` }))
  }
  input.write(token.value + "\n")
})

export const TokenCommand = effectCmd({
  command: "token [provider]",
  describe: "print the authentication token for a configured provider (default: kilo)",
  // Reads only the global auth file; no project instance needed.
  instance: false,
  builder: (yargs: Argv) => {
    const configured = listConfiguredProviders()
    const positional = configured.length
      ? `provider id to print the token for (default: kilo; configured: ${configured.join(", ")})`
      : "provider id to print the token for (default: kilo; no providers configured — run `kilo auth login`)"
    const epilog = configured.length
      ? `Configured providers:\n  ${configured.join("\n  ")}`
      : "No providers configured. Run `kilo auth login` to authenticate."
    return yargs.positional("provider", { describe: positional, type: "string" }).epilog(epilog)
  },
  handler: Effect.fn("Cli.providers.token")(function* (args) {
    const auth = yield* Auth.Service
    const all = yield* Effect.orDie(auth.all())
    yield* run({ provider: args.provider, all, write: (chunk) => process.stdout.write(chunk) })
  }),
})
