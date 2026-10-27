import type { Argv } from "yargs"
import { Effect } from "effect"
import { Auth } from "@/auth"
import { Provider } from "@/provider/provider"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { organization, token } from "@/kilocode/provider/catalog"
import { cmd } from "@/cli/cmd/cmd"
import { CliError, effectCmd, fail } from "@/cli/effect-cmd"
import { UI } from "@/cli/ui"
import { errorMessage } from "@/util/error"
import {
  CustomRouterRequestError,
  customRouterEntryKey,
  fetchCustomRouters,
  fetchPlatformMeasurements,
  parseCustomRouterModelId,
  registerCustomRouterClientEntry,
  removeCustomRouterClientEntry,
  suggestMeasuredAs,
  type CustomRouterClientEntryId,
  type CustomRouterListEntry,
  type CustomRouterReference,
  type CustomRouterSummary,
} from "@kilocode/kilo-gateway"
import { clientEntry, linkChoice } from "@/kilocode/auto-routing/entries"
import { KiloCustomRouter } from "@/kilocode/auto-routing/router"
import { KiloAutoEval } from "@/kilocode/auto-routing/eval"

export const AutoCommand = cmd({
  command: "auto",
  describe: "custom auto routers: register client models and run client evals",
  builder: (yargs: Argv) => yargs.command(AutoRouterCommand).command(AutoEvalCommand).demandCommand(),
  async handler() {},
})

export const AutoRouterCommand = cmd({
  command: "router",
  describe: "manage custom auto router client entries",
  builder: (yargs: Argv) =>
    yargs.command(AutoRouterListCommand).command(AutoRouterAddCommand).command(AutoRouterRemoveCommand).demandCommand(),
  async handler() {},
})

export const AutoRouterListCommand = effectCmd({
  command: "list",
  describe: "list custom auto routers, their entries, and per-entry eval status",
  builder: (yargs) =>
    yargs.option("json", {
      type: "boolean",
      default: false,
      describe: "print the raw router list as JSON",
    }),
  handler: Effect.fn("Cli.auto.router.list")(function* (args) {
    const creds = yield* credentials()
    if (!creds) return
    const catalog = yield* providers()
    const list = yield* Effect.promise(() =>
      fetchCustomRouters({ token: creds.token, organizationId: creds.organizationId }).catch((error) => {
        throw new Error(describeFailure(error, "Could not load custom auto routers"))
      }),
    )
    if (args.json) {
      console.log(JSON.stringify(list, null, 2))
      return
    }
    if (list.routers.length === 0) {
      UI.println("No custom auto routers. Create one in the Kilo web editor.")
      return
    }
    for (const router of list.routers) {
      console.log(router.modelId)
      console.log(`  ${describeRouter(router)}`)
      for (const item of router.entries) {
        console.log(`  ${describeEntry(item, catalog)}`)
      }
    }
  }),
})

export const AutoRouterAddCommand = effectCmd({
  command: "add <router> <model>",
  describe: "register a client model as a custom auto router entry",
  builder: (yargs) =>
    yargs
      .positional("router", { type: "string", demandOption: true, describe: "router id or slug" })
      .positional("model", { type: "string", demandOption: true, describe: "<provider>/<model> resolved by this CLI" })
      .option("measured-as", { type: "string", describe: "reuse the platform benchmark of this model" })
      .option("link", {
        type: "boolean",
        default: true,
        describe: "suggest a platform benchmark link (--no-link skips it; a stored link stays until cleared in the web editor)",
      })
      .option("yes", { type: "boolean", default: false, describe: "accept a suggested platform benchmark link" }),
  handler: Effect.fn("Cli.auto.router.add")(function* (args) {
    const reference = resolveReference(args.router)
    if (!reference) {
      yield* fail(`Not a custom router: "${args.router}". Use \`kilo-auto/custom/<slug>\` or a slug.`)
      return
    }
    const target = splitModel(args.model)
    if (!target) {
      yield* fail(`Expected <provider>/<model>, got "${args.model}"`)
      return
    }
    const catalog = yield* providers()
    const provider = catalog[ProviderV2.ID.make(target.provider)]
    const model = provider?.models[target.model]
    if (!provider || !model) {
      yield* fail(`Model ${args.model} is not configured in this CLI. Check \`kilo models\`.`)
      return
    }
    const creds = yield* credentials()
    if (!creds) return
    const list = yield* Effect.promise(() =>
      fetchCustomRouters({ token: creds.token, organizationId: creds.organizationId }).catch((error) => {
        throw new Error(describeFailure(error, "Could not load custom auto routers"))
      }),
    )
    const router = list.routers.find((item) => item.scope === reference.scope && item.slug === reference.slug)
    if (!router) {
      yield* fail(`Custom auto router ${args.router} was not found. Check the id with \`kilo auto router list\`.`)
      return
    }
    // An explicit --measured-as skips the suggestion: the server validates the link on register.
    const measurements =
      args.measuredAs || !args.link
        ? undefined
        : yield* Effect.promise(() =>
            fetchPlatformMeasurements({
              token: creds.token,
              organizationId: creds.organizationId,
              baseRouter: router.baseRouter,
            }).catch((error) => {
              UI.println(
                `${UI.Style.TEXT_WARNING}${describeFailure(error, "Could not load platform measurements")}. Registering without a benchmark link.${UI.Style.TEXT_NORMAL}`,
              )
              return undefined
            }),
          )
    const suggestion = measurements
      ? suggestMeasuredAs(
          target,
          measurements.models.map((item) => item.model),
        )
      : null
    const choice = linkChoice({
      measuredAs: args.measuredAs,
      yes: args.yes,
      interactive: Boolean(process.stdin.isTTY),
      suggestion,
    })
    if (suggestion && choice.kind === "skip") {
      UI.println(`Platform benchmark ${suggestion} matches this model. Pass --yes to link it.`)
    }
    const measuredAs = yield* Effect.promise(async () => {
      if (choice.kind !== "ask") return choice.kind === "link" ? choice.measuredAs : undefined
      const answer = (await UI.input(`Reuse the platform benchmark of ${choice.suggestion}? [Y/n] `)).trim()
      return answer === "" || /^y(es)?$/i.test(answer) ? choice.suggestion : undefined
    })
    const response = yield* Effect.promise(() =>
      registerCustomRouterClientEntry({
        token: creds.token,
        organizationId: creds.organizationId,
        scope: reference.scope,
        slug: reference.slug,
        entry: clientEntry(model, measuredAs),
      }).catch((error) => {
        throw new Error(describeFailure(error, "Could not register the client entry"))
      }),
    )
    const registered = response.router.entries.find(
      (item) => item.key === customRouterEntryKey({ kind: "client", provider: target.provider, model: target.model }),
    )
    UI.println(`Registered ${args.model} on ${response.router.modelId}.`)
    if (registered) UI.println(describeEntry(registered, catalog))
    if (registered?.needsClientEval) {
      UI.println(`This entry needs a client eval: run \`kilo auto eval ${response.router.modelId}\`.`)
    }
  }),
})

export const AutoRouterRemoveCommand = effectCmd({
  command: "remove <router> <model>",
  describe: "remove a client model entry from a custom auto router",
  builder: (yargs) =>
    yargs
      .positional("router", { type: "string", demandOption: true, describe: "router id or slug" })
      .positional("model", { type: "string", demandOption: true, describe: "<provider>/<model>" }),
  handler: Effect.fn("Cli.auto.router.remove")(function* (args) {
    const reference = resolveReference(args.router)
    if (!reference) {
      yield* fail(`Not a custom router: "${args.router}". Use \`kilo-auto/custom/<slug>\` or a slug.`)
      return
    }
    const target = splitModel(args.model)
    if (!target) {
      yield* fail(`Expected <provider>/<model>, got "${args.model}"`)
      return
    }
    const creds = yield* credentials()
    if (!creds) return
    const response = yield* Effect.promise(() =>
      removeCustomRouterClientEntry({
        token: creds.token,
        organizationId: creds.organizationId,
        scope: reference.scope,
        slug: reference.slug,
        provider: target.provider,
        model: target.model,
      }).catch((error) => {
        throw new Error(describeFailure(error, "Could not remove the client entry"))
      }),
    )
    UI.println(`Removed ${args.model} from ${response.router.modelId}.`)
  }),
})

export const AutoEvalCommand = effectCmd({
  command: "eval <router>",
  describe: "run the missing client evals for a custom auto router locally in Docker",
  builder: (yargs) =>
    yargs
      .positional("router", { type: "string", demandOption: true, describe: "router id or slug" })
      .option("yes", {
        type: "boolean",
        default: false,
        describe: "skip the plan confirmation",
      })
      .option("concurrency", {
        type: "number",
        default: 1,
        describe: "number of cases to run in parallel",
      })
      .option("cli-version", {
        type: "string",
        describe: "published @kilocode/cli version to install in the eval image (default: this CLI's version)",
      })
      .option("debug-config", {
        type: "boolean",
        default: false,
        describe: "print the Docker command and the generated container config, then exit",
      }),
  handler: Effect.fn("Cli.auto.eval")(function* (args) {
    if (args.concurrency < 1) {
      yield* fail("--concurrency must be at least 1")
      return
    }
    const creds = yield* credentials()
    if (!creds) return
    const catalog = yield* providers()
    const auth = yield* Auth.Service
    const all = yield* auth.all().pipe(Effect.mapError(credentialsFailure))
    const code = yield* Effect.promise(() =>
      KiloAutoEval.run({
        router: args.router,
        yes: args.yes,
        concurrency: args.concurrency,
        debugConfig: args.debugConfig,
        cliVersion: args.cliVersion,
        token: creds.token,
        organizationId: creds.organizationId,
        providers: catalog,
        auth: all,
      }),
    )
    if (code !== 0) process.exitCode = code
  }),
})

function describeRouter(router: CustomRouterSummary): string {
  return `${router.name} · base ${router.baseRouter} · mode ${router.mode} · default ${router.defaultEntryKey}${router.canEdit ? "" : " · read-only"}`
}

function describeEntry(entry: CustomRouterListEntry, providers: Record<ProviderV2.ID, Provider.Info>): string {
  const state = entry.variants
    .map((variant) => `${variant.variant ?? "default"}:${variant.status}${variant.linked ? "(linked)" : ""}`)
    .join(" ")
  const needs = entry.needsClientEval ? "needs client eval" : "ready"
  const local = KiloCustomRouter.servable(entry.entry, providers) ? " · servable here" : ""
  const linked = entry.entry.measuredAs ? ` · measured as ${entry.entry.measuredAs}` : ""
  return `${entry.key}${linked} · ${state || "no variants"} · ${needs}${local}`
}

function splitModel(value: string): CustomRouterClientEntryId | undefined {
  const separator = value.indexOf("/")
  if (separator <= 0 || separator === value.length - 1) return undefined
  return { provider: value.slice(0, separator), model: value.slice(separator + 1) }
}

function resolveReference(value: string): CustomRouterReference | undefined {
  const full = parseCustomRouterModelId(value)
  if (full) return full
  const org = value.startsWith("org/") ? value.slice("org/".length) : undefined
  return parseCustomRouterModelId(org ? `kilo-auto/custom/org/${org}` : `kilo-auto/custom/${value}`) ?? undefined
}

function describeFailure(error: unknown, prefix: string): string {
  if (error instanceof CustomRouterRequestError) {
    return `${prefix}: ${KiloCustomRouter.errorMessage(error.code, error.message, error.retryAt)}`
  }
  return `${prefix}: ${errorMessage(error)}`
}

function credentialsFailure(error: Auth.AuthError): CliError {
  return new CliError({ message: `Could not read Kilo credentials: ${error.message}` })
}

const credentials = Effect.fn("Cli.auto.credentials")(function* () {
  const provider = yield* Provider.Service
  const auth = yield* Auth.Service
  const catalog = yield* provider.list()
  const kilo = catalog[ProviderV2.ID.kilo]
  if (!kilo) {
    yield* fail("Sign in to Kilo to use custom auto routers. Run `kilo auth login`.")
    return undefined
  }
  const info = yield* auth.get(ProviderV2.ID.kilo).pipe(Effect.mapError(credentialsFailure))
  return { token: token(kilo.options, info) ?? "", organizationId: organization(kilo.options, info) }
})

const providers = Effect.fn("Cli.auto.providers")(function* () {
  const provider = yield* Provider.Service
  return yield* provider.list()
})
