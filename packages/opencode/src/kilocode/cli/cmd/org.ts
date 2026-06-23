import type { Argv } from "yargs"
import { cmd } from "@/cli/cmd/cmd"
import { UI } from "@/cli/ui"
import { Auth, type Info as AuthInfo } from "@/auth"
import { makeRuntime } from "@/effect/run-service"
import { isRecord } from "@/util/record"
import { buildKiloHeaders, KILO_API_BASE } from "@kilocode/kilo-gateway"

const runtime = makeRuntime(Auth.Service, Auth.defaultLayer)

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

interface Args {
  getAuth?: (providerID: string) => Promise<AuthInfo | undefined>
  fetch?: Fetch
  write?: (msg: string) => void
  error?: (msg: string) => void
  exit?: (code: number) => void
}

export function summaryInput(now = new Date()) {
  const start = new Date(now)
  start.setUTCDate(start.getUTCDate() - 30)
  return {
    startDate: start.toISOString(),
    endDate: now.toISOString(),
    granularity: "day",
  }
}

function unwrap(input: unknown) {
  const item = Array.isArray(input) ? input[0] : input
  if (!isRecord(item)) return input

  const result = item.result
  if (!isRecord(result)) return input

  const data = result.data
  if (!isRecord(data)) return data

  return data.json ?? data
}

export async function fetchUsageSummary(input: { token: string; org: string; fetch?: Fetch }) {
  const params = new URLSearchParams({
    batch: "1",
    input: JSON.stringify({ "0": summaryInput() }),
  })
  const res = await (input.fetch ?? fetch)(`${KILO_API_BASE}/api/trpc/usageAnalytics.getSummary?${params}`, {
    headers: {
      Authorization: `Bearer ${input.token}`,
      "Content-Type": "application/json",
      ...buildKiloHeaders(undefined, { kilocodeOrganizationId: input.org }),
    },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Usage summary fetch failed: ${res.status}${text ? ` ${text.slice(0, 500)}` : ""}`)
  }

  return unwrap(await res.json())
}

export async function handleUsage(args: Args = {}) {
  const get = args.getAuth ?? ((id: string) => runtime.runPromise((svc) => svc.get(id)))
  const auth = await get("kilo")
  const error = args.error ?? UI.error
  const exit = args.exit ?? ((code: number) => (process.exitCode = code))

  if (!auth || auth.type !== "oauth") {
    error("Not authenticated with Kilo Gateway")
    exit(1)
    return
  }

  if (!auth.accountId) {
    error("No active Kilo organization selected")
    exit(1)
    return
  }

  try {
    const summary = await fetchUsageSummary({ token: auth.access, org: auth.accountId, fetch: args.fetch })
    const write = args.write ?? ((msg: string) => process.stdout.write(msg))
    write(JSON.stringify(summary, null, 2) + "\n")
  } catch (err) {
    error(err instanceof Error ? err.message : String(err))
    exit(1)
  }
}

const UsageCommand = cmd({
  command: "usage",
  describe: "show organization usage summary",
  handler: async () => {
    await handleUsage()
  },
})

export const OrgCommand = cmd({
  command: "org",
  describe: "manage Kilo organizations",
  builder: (yargs: Argv) => yargs.command(UsageCommand).demandCommand(),
  handler: async () => {},
})
