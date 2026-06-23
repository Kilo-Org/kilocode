import type { Argv } from "yargs"
import { cmd } from "@/cli/cmd/cmd"
import { UI } from "@/cli/ui"
import { Auth, type Info as AuthInfo } from "@/auth"
import { makeRuntime } from "@/effect/run-service"
import { isRecord } from "@/util/record"
import { buildKiloHeaders, fetchProfile, KILO_API_BASE, type KilocodeProfile } from "@kilocode/kilo-gateway"
import { isCancel, select } from "@clack/prompts"

const runtime = makeRuntime(Auth.Service, Auth.defaultLayer)

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>
const periods = ["day", "week", "month"] as const
type Period = (typeof periods)[number]
type SummaryInput = ReturnType<typeof summaryInput>

interface Args {
  json?: boolean
  org?: string
  period?: Period
  verbose?: boolean
  getAuth?: (providerID: string) => Promise<AuthInfo | undefined>
  getProfile?: (token: string) => Promise<KilocodeProfile>
  selectOrg?: (input: { orgs: Org[]; current?: string }) => Promise<string | undefined>
  selectPeriod?: (input: { current: Period }) => Promise<Period | undefined>
  fetch?: Fetch
  write?: (msg: string) => void
  error?: (msg: string) => void
  exit?: (code: number) => void
}

interface Org {
  id: string
  name: string
}

export function summaryInput(now = new Date()) {
  return summaryInputForPeriod("day", now)
}

export function summaryInputForPeriod(period: Period, now = new Date(), start = new Date(now)) {
  start.setHours(0, 0, 0, 0)
  if (period === "week") start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  if (period === "month") start.setDate(1)
  return {
    startDate: start.toISOString(),
    endDate: now.toISOString(),
    granularity: period,
    costSource: "cost",
    personalScope: "include-orgs",
    viewAs: "org-wide",
  }
}

function requestInput(input: { summary: SummaryInput; org: string }) {
  return {
    ...input.summary,
    organizationId: input.org,
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

function label(input: string) {
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\bmicro(?:s|dollars?|usd)?\b/gi, "")
    .trim()
    .replace(/^./, (char) => char.toUpperCase())
}

function norm(input: string) {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "")
}

function names(org: Org) {
  return [org.id, org.name].map(norm).filter(Boolean)
}

function resolveRequestedOrg(input: { orgs: Org[]; org: string }) {
  const query = norm(input.org)
  const exact = input.orgs.filter((org) => names(org).some((name) => name === query))
  if (exact.length > 0) return { matches: exact, exact: true }

  const partial = input.orgs.filter((org) => names(org).some((name) => name.includes(query)))
  return { matches: partial, exact: false }
}

function dollars(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value / 1_000_000)
}

function value(input: Record<string, unknown>, key: string) {
  const item = input[key]
  return typeof item === "number" && Number.isFinite(item) ? item : 0
}

function scalar(key: string, value: unknown) {
  if (typeof value === "number" && /micro|cost/i.test(key)) return dollars(value)
  if (typeof value === "number") return new Intl.NumberFormat("en-US").format(value)
  if (typeof value === "string") return value
  if (typeof value === "boolean") return value ? "true" : "false"
  if (value === null) return "null"
  return JSON.stringify(value)
}

function isDateKey(key: string) {
  return /^(start|end)?date$/i.test(key) || /date$/i.test(key)
}

function isCostKey(key: string) {
  return /cost|token|spend|amount|credit|balance/i.test(key)
}

function isOperationKey(key: string) {
  return /request|call|error|fail|success|rate|latency|duration|time|p50|p90|p95|p99/i.test(key)
}

function formatDate(value: string) {
  const date = new Date(value)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function periodLine(period: SummaryInput) {
  const start = formatDate(period.startDate)
  const end = formatDate(period.endDate)
  if (start === end) return `Date: ${start}`
  return `Date Range: ${start} to ${end}`
}

function lines(value: unknown, depth = 0, key = ""): string[] {
  const pad = "  ".repeat(depth)
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${pad}${label(key || "Items")}: none`]
    return value.flatMap((item, index) => [
      `${pad}${label(key || "Item")} ${index + 1}:`,
      ...lines(item, depth + 1),
    ])
  }

  if (isRecord(value)) {
    return Object.entries(value).flatMap(([name, item]) => {
      if (isRecord(item) || Array.isArray(item)) return [`${pad}${label(name)}:`, ...lines(item, depth + 1, name)]
      return [`${pad}${label(name)}: ${scalar(name, item)}`]
    })
  }

  return [`${pad}${scalar(key, value)}`]
}

export function formatSummary(input: unknown) {
  return formatSummaryForPeriod(input, summaryInput())
}

function title(input: string, width: number) {
  const left = Math.floor((width - input.length) / 2)
  const right = Math.max(0, width - input.length - left)
  return `│${" ".repeat(left)}${input}${" ".repeat(right)}│`
}

function row(label: string, text: string, width: number) {
  const padding = Math.max(0, width - 1 - label.length - text.length)
  return `│${label}${" ".repeat(padding)}${text} │`
}

function box(name: string, rows: [string, string][]) {
  const width = 56
  const top = "┌" + "─".repeat(width) + "┐"
  const mid = "├" + "─".repeat(width) + "┤"
  const bottom = "└" + "─".repeat(width) + "┘"
  return [top, title(name, width), mid, ...rows.map(([name, text]) => row(name, text, width)), bottom].join("\n")
}

function integer(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value)
}

function decimal(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(value)
}

export function formatSummaryTable(input: unknown, period: SummaryInput) {
  if (!isRecord(input)) return formatSummaryForPeriod(input, period)

  return [
    box("OVERVIEW", [
      [periodLine(period), ""],
      ["Requests", integer(value(input, "requestCount"))],
      ["Distinct Users", integer(value(input, "distinctUsers"))],
    ]),
    box("COST & TOKENS", [
      ["Cost", dollars(value(input, "costMicrodollars"))],
      ["Cost/Request", dollars(value(input, "costPerRequest"))],
      ["Tokens/Request", decimal(value(input, "tokensPerRequest"))],
      ["Total Tokens", integer(value(input, "totalTokens"))],
      ["Input", integer(value(input, "inputTokens"))],
      ["Output", integer(value(input, "outputTokens"))],
      ["Cache Hit", integer(value(input, "cacheHitTokens"))],
      ["Cache Write", integer(value(input, "cacheWriteTokens"))],
    ]),
    box("OPERATIONS", [
      ["Errors", integer(value(input, "errorCount"))],
      ["Error Rate", decimal(value(input, "errorRate"))],
      ["Avg Latency", `${decimal(value(input, "avgLatencyMs"))} ms`],
      ["BYOK Requests", integer(value(input, "byokRequestCount"))],
      ["Free Requests", integer(value(input, "freeRequestCount"))],
      ["Cancelled", integer(value(input, "cancelledCount"))],
    ]),
  ].join("\n\n")
}

function header(org?: Org) {
  if (!org) return []
  return [`Organization: ${org.name}`, ""]
}

export function formatSummaryTableForOrg(input: unknown, period: SummaryInput, org?: Org) {
  return [...header(org), formatSummaryTable(input, period)].join("\n")
}

export function formatSummaryForPeriod(input: unknown, period: SummaryInput, org?: Org) {
  if (!isRecord(input)) return [...header(org), periodLine(period), "", ...lines(input)].join("\n")

  const entries = Object.entries(input)
  const totals = entries.filter(([key]) => isCostKey(key))
  const ops = entries.filter(([key]) => !isCostKey(key) && isOperationKey(key))
  const details = entries.filter(([key]) => !isDateKey(key) && !isCostKey(key) && !isOperationKey(key))
  const section = (title: string, values: [string, unknown][]) => {
    if (values.length === 0) return []
    return [title, ...values.flatMap(([key, value]) => lines({ [key]: value }))]
  }

  const sections = [section("Cost & Tokens", totals), section("Operations", ops), section("Details", details)].filter(
    (items) => items.length > 0,
  )
  return [...header(org), periodLine(period), ...sections.flatMap((items) => ["", ...items])].join("\n")
}

export async function fetchUsageSummaryResponse(input: { token: string; org: string; fetch?: Fetch; summary?: SummaryInput }) {
  const summary = input.summary ?? summaryInput()
  const params = new URLSearchParams({
    batch: "1",
    input: JSON.stringify({ "0": requestInput({ summary, org: input.org }) }),
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

  return res.json()
}

export async function fetchUsageSummary(input: { token: string; org: string; fetch?: Fetch; summary?: SummaryInput }) {
  return unwrap(await fetchUsageSummaryResponse(input))
}

async function promptOrg(input: { orgs: Org[]; current?: string }) {
  const orgs = [...input.orgs].sort((a, b) => {
    if (a.id === input.current) return -1
    if (b.id === input.current) return 1
    return a.name.localeCompare(b.name)
  })
  const choice = await select({
    message: "Select Kilo organization",
    options: orgs.map((org) => ({
      label: org.id === input.current ? `${org.name} (current)` : org.name,
      value: org.id,
      hint: org.id,
    })),
  })
  if (isCancel(choice)) return undefined
  return choice
}

async function promptPeriod(input: { current: Period }) {
  const choice = await select({
    message: "Select usage period",
    initialValue: input.current,
    options: periods.map((period) => ({
      label: period === input.current ? `${label(period)} (default)` : label(period),
      value: period,
    })),
  })
  if (isCancel(choice)) return undefined
  return choice
}

export async function resolvePeriod(input: {
  period?: Period
  selectPeriod?: (input: { current: Period }) => Promise<Period | undefined>
}) {
  if (input.period) return input.period

  return (input.selectPeriod ?? promptPeriod)({ current: "day" })
}

export async function resolveOrg(input: {
  auth: AuthInfo
  org?: string
  getProfile?: (token: string) => Promise<KilocodeProfile>
  selectOrg?: (input: { orgs: Org[]; current?: string }) => Promise<string | undefined>
}) {
  if (input.auth.type !== "oauth") return undefined

  const profile = await (input.getProfile ?? fetchProfile)(input.auth.access)
  const orgs = profile.organizations ?? []
  if (orgs.length === 0) return undefined

  const current = input.auth.accountId
  const requested = input.org ? resolveRequestedOrg({ orgs, org: input.org }) : undefined
  if (requested && requested.matches.length === 0) throw new Error(`No Kilo organization matches "${input.org}"`)

  const choices = requested && !requested.exact && requested.matches.length > 1 ? requested.matches : orgs
  const selected = requested?.matches.length === 1 ? requested.matches[0] : orgs.length === 1 ? orgs[0] : undefined
  const id = selected?.id ?? (await (input.selectOrg ?? promptOrg)({ orgs: choices, current }))
  const org = selected ?? orgs.find((org) => org.id === id)
  if (!org) return undefined

  return { id: org.id, name: org.name }
}

export async function handleUsage(args: Args = {}) {
  const get = args.getAuth ?? ((id: string) => runtime.runPromise((svc) => svc.get(id)))
  const auth = await get("kilo")
  const error = args.error ?? UI.error
  const exit = args.exit ?? ((code: number) => (process.exitCode = code))

  if (!auth || auth.type !== "oauth") {
    error("Not authenticated with a Kilo organization")
    exit(1)
    return
  }

  try {
    const org = await resolveOrg({ auth, org: args.org, getProfile: args.getProfile, selectOrg: args.selectOrg })
    if (!org) {
      error("No Kilo organization selected for the authenticated account")
      exit(1)
      return
    }

    const period = await resolvePeriod({ period: args.period, selectPeriod: args.selectPeriod })
    if (!period) {
      error("No usage period selected")
      exit(1)
      return
    }

    const summary = summaryInputForPeriod(period)
    const res = await fetchUsageSummaryResponse({ token: auth.access, org: org.id, fetch: args.fetch, summary })
    const write = args.write ?? ((msg: string) => process.stdout.write(msg))
    if (args.json) {
      write(JSON.stringify(res, null, 2) + "\n")
      return
    }
    const data = unwrap(res)
    write((args.verbose ? formatSummaryForPeriod(data, summary, org) : formatSummaryTableForOrg(data, summary, org)) + "\n")
  } catch (err) {
    error(err instanceof Error ? err.message : String(err))
    exit(1)
  }
}

const UsageCommand = cmd({
  command: "usage [organization]",
  describe: "show organization usage summary",
  builder: (yargs) =>
    yargs
      .positional("organization", {
        describe: "organization name or id",
        type: "string",
      })
      .option("org", {
        describe: "organization name or id",
        type: "string",
      })
      .option("json", {
        describe: "print raw JSON response",
        type: "boolean",
        default: false,
      })
      .option("period", {
        describe: "usage period to summarize",
        type: "string",
        choices: periods,
      })
      .option("verbose", {
        describe: "print detailed usage fields",
        type: "boolean",
        default: false,
      }),
  handler: async (args) => {
    await handleUsage({
      json: args.json,
      org: (args.org ?? args.organization) as string | undefined,
      period: args.period as Period | undefined,
      verbose: args.verbose,
    })
  },
})

export const OrgCommand = cmd({
  command: "org",
  describe: "manage Kilo organizations",
  builder: (yargs: Argv) => yargs.command(UsageCommand).demandCommand(),
  handler: async () => {},
})
