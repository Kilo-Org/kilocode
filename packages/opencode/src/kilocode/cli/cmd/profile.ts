import type { Argv } from "yargs"
import type { Info as AuthInfo } from "../../../auth"
import type { KilocodeBalance, KilocodeProfile } from "@kilocode/kilo-gateway"
import { cmd } from "../../../cli/cmd/cmd"
import { UI } from "../../../cli/ui"

// Keep the top-level import graph light: this module is registered eagerly at CLI
// startup, so the auth runtime and gateway fetches happen inside the handler (same
// deferral pattern as upstream opencode#30453). The runtime is created lazily on
// first use rather than at module load.
let runtime: Awaited<ReturnType<typeof load>> | undefined
async function load() {
  const { Auth } = await import("../../../auth")
  const { makeRuntime } = await import("../../../effect/run-service")
  return makeRuntime(Auth.Service, Auth.defaultLayer)
}
async function stored(providerID: string) {
  runtime ??= await load()
  return runtime.runPromise((svc) => svc.get(providerID))
}

interface Info {
  name: string | null
  email: string
  team: string
  organizationId: string | null
  balance: number
}

export function payload(input: {
  profile: KilocodeProfile
  balance: KilocodeBalance | null
  organizationId?: string | null
}): Info {
  const org = input.profile.organizations?.find((item) => item.id === input.organizationId)
  return {
    name: input.profile.name ?? null,
    email: input.profile.email,
    team: org?.name ?? "Personal",
    organizationId: input.organizationId ?? null,
    balance: input.balance?.balance ?? 0,
  }
}

export function format(info: Info): string {
  const lines = [
    ...(info.name ? [`Name: ${info.name}`] : []),
    `Email: ${info.email}`,
    `Team: ${info.team}`,
    `Balance: $${info.balance.toFixed(2)}`,
  ]
  return lines.join("\n")
}

interface Args {
  json: boolean
  getAuth?: (providerID: string) => Promise<AuthInfo | undefined>
  getProfile?: (token: string) => Promise<KilocodeProfile>
  getBalance?: (token: string, organizationId?: string) => Promise<KilocodeBalance | null>
  error?: (msg: string) => void
  exit?: (code: number) => void
}

export const ProfileCommand = cmd({
  command: "profile",
  describe: "show Kilo account profile",
  builder: (yargs: Argv) =>
    yargs.option("json", {
      describe: "output profile as JSON",
      type: "boolean",
      default: false,
    }),
  handler: async (args) => {
    await handle({ json: args.json })
  },
})

export async function handle(args: Args) {
  const get = args.getAuth ?? stored
  const auth = await get("kilo")
  const error = args.error ?? UI.error
  const exit = args.exit ?? ((code: number) => (process.exitCode = code))

  if (!auth || auth.type !== "oauth") {
    error("Not authenticated with Kilo Gateway")
    exit(1)
    return
  }

  const { fetchBalance, fetchProfile } = await import("@kilocode/kilo-gateway")
  const org = auth.accountId ?? null
  const result = await (async () => {
    try {
      return await Promise.all([
        (args.getProfile ?? fetchProfile)(auth.access),
        (args.getBalance ?? fetchBalance)(auth.access, org ?? undefined),
      ] as const)
    } catch (err) {
      error(err instanceof Error ? err.message : String(err))
      exit(1)
      return undefined
    }
  })()
  if (!result) return

  const [profile, balance] = result
  const info = payload({ profile, balance, organizationId: org })

  if (args.json) {
    console.log(JSON.stringify(info, null, 2))
    return
  }

  process.stdout.write(format(info) + "\n")
}
