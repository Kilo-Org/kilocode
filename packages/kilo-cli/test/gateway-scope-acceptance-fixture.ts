import { NodeHttpServer } from "@effect/platform-node"
import { createClient } from "@kilocode/client"
import { Service } from "@opencode-ai/client/effect/service"
import { KiloModels } from "@opencode-ai/schema/kilocode/models"
import { Effect } from "effect"
import assert from "node:assert/strict"
import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { launch } from "../src/interactive-server"
import { guardedFixtureLayout } from "./fixture"

// Loopback scope-acceptance fixture: the only network surface is this Bun.serve
// on 127.0.0.1. No account, deployment, or paid inference is used.
let failTeamModels = false
const metadata: Array<{ path: string; organization: string | null }> = []
const completions: Array<{ model: string; organization: string | null }> = []
const personalCatalog = {
  data: [
    {
      id: "kilo-auto/free",
      name: "Scope Fixture Personal Auto",
      context_length: 128000,
      preferredIndex: 0,
      autoRouting: { models: ["ordinary"] },
    },
    { id: "ordinary", name: "Scope Fixture Ordinary", context_length: 128000, supported_parameters: ["tools"] },
  ],
}
const teamCatalog = {
  data: [
    {
      id: "kilo-auto/team",
      name: "Scope Fixture Team Auto",
      context_length: 128000,
      preferredIndex: 0,
      autoRouting: { models: ["ordinary"] },
    },
    { id: "ordinary", name: "Scope Fixture Ordinary", context_length: 128000, supported_parameters: ["tools"] },
  ],
}
const gateway = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === "/api/profile")
      return Response.json({
        organizations: [{ id: "team", name: "Scope Fixture Team", role: "member" }],
        selectedOrganizationId: null,
        hasPersonalAccount: true,
      })
    if (url.pathname === "/api/openrouter/models" || url.pathname === "/api/organizations/team/models") {
      if (url.pathname === "/api/openrouter/models" && request.headers.get("authorization") === null)
        return Response.json({ data: [] })
      assert.equal(request.headers.get("authorization"), "Bearer scope-fixture")
      if (url.pathname === "/api/organizations/team/models") {
        assert.equal(request.headers.get("x-kilocode-organizationid"), "team")
        if (failTeamModels) return new Response(null, { status: 500 })
      } else {
        assert.equal(request.headers.get("x-kilocode-organizationid"), null)
      }
      metadata.push({ path: url.pathname, organization: request.headers.get("x-kilocode-organizationid") })
      return Response.json(url.pathname === "/api/openrouter/models" ? personalCatalog : teamCatalog)
    }
    if (url.pathname !== "/api/gateway/chat/completions") return new Response(null, { status: 404 })
    assert.equal(request.headers.get("authorization"), "Bearer scope-fixture")
    const body = (await request.json()) as { model?: string; stream?: boolean }
    completions.push({ model: body.model ?? "", organization: request.headers.get("x-kilocode-organizationid") })
    const responseModel = body.model === "kilo-auto/team" ? "provider/team-actual" : "provider/actual"
    if (!body.stream)
      return Response.json({
        id: "scope-fixture",
        object: "chat.completion",
        created: 1,
        model: responseModel,
        choices: [{ index: 0, message: { role: "assistant", content: "Scope fixture reply" }, finish_reason: "stop" }],
      })
    const frames = [
      {
        id: "scope-fixture",
        object: "chat.completion.chunk",
        created: 1,
        model: responseModel,
        choices: [{ index: 0, delta: { role: "assistant", content: "Scope fixture reply" }, finish_reason: null }],
      },
      {
        id: "scope-fixture",
        object: "chat.completion.chunk",
        created: 1,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      },
    ]
    return new Response(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("") + "data: [DONE]\n\n", {
      headers: { "content-type": "text/event-stream" },
    })
  },
})

process.on("unhandledRejection", (reason) => {
  console.log("UNHANDLED", Bun.inspect(reason, { depth: 6 }).slice(0, 1500))
})
try {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const input = guardedFixtureLayout()
        const second = yield* Effect.promise(() => mkdtemp(path.join(os.tmpdir(), "kilo-scope-location-")))
        const endpoint = yield* launch(input, {
          models: false,
          recover: false,
          gateway: { server: gateway.url.origin },
          content: JSON.stringify({
            model: "kilo/ordinary",
            providers: {
              kilo: {
                package: "aisdk:@ai-sdk/openai-compatible",
                models: { ordinary: {} },
              },
            },
          }),
        })
        const client = createClient({
          baseUrl: endpoint.url,
          headers: Object.fromEntries(new Headers(Service.headers(endpoint))),
        })
        const models = client.rpc(KiloModels.Definition)
        const locationA = { directory: process.cwd() }
        const locationB = { directory: second }
        yield* Effect.promise(() => client.plugin.awaitActivation({ location: locationA }))
        yield* Effect.promise(() =>
          endpoint.importCredential({
            kind: "api-key",
            integrationID: "kilo",
            key: "scope-fixture",
            label: "Scope acceptance fixture",
            metadata: {
              server: gateway.url.origin,
              hasPersonalAccount: "true",
              organizations: "team",
            },
          }),
        )
        const waitFor = (id: string, location: { directory: string }) =>
          Effect.promise(async () => {
            for (let attempt = 0; attempt < 200; attempt++) {
              const inventory = await client.model.list({ location })
              if (inventory.data.some((model) => model.providerID === "kilo" && model.id === id)) return inventory
              await Bun.sleep(20)
            }
            return client.model.list({ location })
          })

        // The second location activates only after the first catalog is settled, so its
        // initial load must read the account's *current* scope rather than inheriting the
        // first location's cache.
        yield* waitFor("kilo-auto/free", locationA)
        yield* Effect.promise(() => client.plugin.awaitActivation({ location: locationB }))
        const personalA = yield* Effect.promise(() => client.model.list({ location: locationA }))
        const personalB = yield* Effect.promise(() => client.model.list({ location: locationB }))
        for (const [name, data] of [
          ["location A", personalA.data],
          ["location B", personalB.data],
        ] as const) {
          assert(
            data.some((model) => model.providerID === "kilo" && model.id === "kilo-auto/free"),
            name,
          )
          assert(!data.some((model) => model.providerID === "kilo" && model.id === "kilo-auto/team"), name)
        }
        assert(
          metadata.every((item) => item.path === "/api/openrouter/models"),
          JSON.stringify(metadata),
        )

        // personal -> team: the eligible catalog becomes the team's and the personal-only
        // Auto model must leave the inventory of *both* locations (no cross-Location bleed).
        yield* Effect.promise(() => client.kilocode.organization.set({ organizationID: "team" }))
        const teamA = yield* waitFor("kilo-auto/team", locationA)
        const teamB = yield* waitFor("kilo-auto/team", locationB)
        for (const [name, data] of [
          ["location A", teamA.data],
          ["location B", teamB.data],
        ] as const) {
          assert(
            data.some((model) => model.providerID === "kilo" && model.id === "kilo-auto/team"),
            name,
          )
          assert(!data.some((model) => model.providerID === "kilo" && model.id === "kilo-auto/free"), name)
        }
        assert(
          metadata.some((item) => item.path === "/api/organizations/team/models"),
          JSON.stringify(metadata),
        )

        // The picker metadata RPC serves the current scope's eligible catalog only.
        const teamMetadata = yield* Effect.promise(() => models.list({}, { location: locationA }))
        assert(
          teamMetadata.some((entry) => entry.id === "kilo-auto/team"),
          JSON.stringify(teamMetadata),
        )
        assert(!teamMetadata.some((entry) => entry.id === "kilo-auto/free"), JSON.stringify(teamMetadata))

        // The team-only Auto model is selectable and executes inside its own scope, and the
        // routed model identity still comes only from the actual response metadata.
        const completionsBeforeTeamSession = completions.length
        const teamSession = yield* Effect.promise(() =>
          client.session.create({
            location: locationA,
            model: { providerID: "kilo", id: "kilo-auto/team" },
          }),
        )
        yield* Effect.promise(() => client.session.prompt({ sessionID: teamSession.id, text: "Team Auto route" }))
        yield* Effect.promise(() =>
          client.session.wait({ sessionID: teamSession.id }, { signal: AbortSignal.timeout(10000) }),
        )
        const teamAssistant = (yield* Effect.promise(() =>
          client.message.list({ sessionID: teamSession.id }),
        )).data.find((message) => message.type === "assistant")
        assert.equal(teamAssistant?.type, "assistant")
        assert.equal(
          (teamAssistant?.providerState as { routedModelID?: string } | undefined)?.routedModelID,
          "provider/team-actual",
          JSON.stringify(teamAssistant?.providerState),
        )
        assert(
          completions.slice(completionsBeforeTeamSession).every((item) => item.organization === "team"),
          JSON.stringify(completions.slice(completionsBeforeTeamSession)),
        )

        // team -> personal: the round trip must return the personal catalog to both
        // locations and drop every trace of the team-only model.
        yield* Effect.promise(() => client.kilocode.organization.set({ organizationID: null }))
        const backA = yield* waitFor("kilo-auto/free", locationA)
        const backB = yield* waitFor("kilo-auto/free", locationB)
        for (const [name, data] of [
          ["location A", backA.data],
          ["location B", backB.data],
        ] as const) {
          assert(
            data.some((model) => model.providerID === "kilo" && model.id === "kilo-auto/free"),
            name,
          )
          assert(!data.some((model) => model.providerID === "kilo" && model.id === "kilo-auto/team"), name)
        }
        const personalMetadata = yield* Effect.promise(() => models.list({}, { location: locationA }))
        assert(
          personalMetadata.some((entry) => entry.id === "kilo-auto/free") &&
            !personalMetadata.some((entry) => entry.id === "kilo-auto/team"),
          JSON.stringify(personalMetadata),
        )

        // An unavailable selection across scopes: the durable team-only session must not
        // silently execute against a stale selection after its model left the catalog.
        const staleRequests = completions.length
        const assistantsBeforeRetry = (yield* Effect.promise(() =>
          client.message.list({ sessionID: teamSession.id }),
        )).data.filter((message) => message.type === "assistant").length
        const promptOutcome = yield* Effect.promise(async () => {
          try {
            await client.session.prompt({ sessionID: teamSession.id, text: "Retry the team Auto model" })
            return null
          } catch (error) {
            return error
          }
        })
        const waitOutcome = yield* Effect.promise(async () => {
          try {
            await client.session.wait({ sessionID: teamSession.id }, { signal: AbortSignal.timeout(10000) })
            return null
          } catch (error) {
            return error
          }
        })
        assert(
          promptOutcome !== null || waitOutcomeIsTerminal(waitOutcome),
          `An unavailable selection must terminate explicitly without a stale execution: ${JSON.stringify({
            promptOutcome,
            waitOutcome: waitOutcome === null ? null : String(waitOutcome),
          })}`,
        )
        assert(
          !completions.slice(staleRequests).some((item) => item.model === "kilo-auto/team"),
          `A selection whose model left the active scope must not execute against a stale catalog: ${JSON.stringify(
            completions.slice(staleRequests),
          )}`,
        )
        const retried = (yield* Effect.promise(() => client.message.list({ sessionID: teamSession.id }))).data.filter(
          (message) => message.type === "assistant",
        )
        assert(
          retried.length === assistantsBeforeRetry ||
            !retried
              .slice(assistantsBeforeRetry)
              .every((message) => message.content.some((part) => part.type === "text" && part.text.length > 0)),
          "A stale team-only selection must not produce fresh settled replies after the switch",
        )

        // A switch whose target scope cannot serve its catalog still switches the account
        // selection (catalog availability is not a selection authority). Until the catalog is
        // served again the unavailable scope's eligible set drains from the inventory of both
        // locations: no stale model from either scope is advertised, and the picker metadata
        // RPC fails explicitly.
        failTeamModels = true
        const switchOutcome = yield* Effect.promise(() =>
          client.kilocode.organization.set({ organizationID: "team" }).then(
            () => "switched",
            (error) => error,
          ),
        )
        const pickerFailure = yield* Effect.promise(async () => {
          try {
            await models.list({}, { location: locationA })
            return null
          } catch (error) {
            return error
          }
        })
        assert(pickerFailure, "Picker metadata must fail explicitly while the scope catalog is unavailable")
        const drainKilo = (location: { directory: string }) =>
          Effect.promise(async () => {
            let stable = 0
            let inventory = await client.model.list({ location })
            for (let attempt = 0; attempt < 300; attempt++) {
              inventory = await client.model.list({ location })
              const auto = inventory.data.filter(
                (model) => model.providerID === "kilo" && model.id.startsWith("kilo-auto/"),
              )
              if (auto.length === 0) {
                stable += 1
                if (stable >= 5) return inventory
              } else {
                stable = 0
              }
              await Bun.sleep(20)
            }
            console.log(
              "DRAIN_SETTLE",
              location.directory.slice(-8),
              JSON.stringify(
                inventory.data
                  .filter((model) => model.providerID === "kilo")
                  .map((model) => ({ id: model.id, enabled: (model as unknown as { enabled?: boolean }).enabled })),
              ),
            )
            return inventory
          })
        const unavailableA = yield* drainKilo(locationA)
        const unavailableB = yield* drainKilo(locationB)
        for (const [name, data] of [
          ["location A", unavailableA.data],
          ["location B", unavailableB.data],
        ] as const) {
          // The whole Gateway catalog surface goes empty while its scope is unserved: no stale
          // model from the previous scope is advertised, and nothing invents availability.
          assert(!data.some((model) => model.providerID === "kilo" && model.id === "kilo-auto/team"), name)
          assert(!data.some((model) => model.providerID === "kilo" && model.id === "kilo-auto/free"), name)
        }
        failTeamModels = false
        // The failed refresh leaves the catalog drained until the next account refresh; the
        // selection persisted through the outage, so the next served refresh restores the team
        // scope's own eligible set in both locations while the personal-only model stays
        // unavailable in the team scope.
        yield* Effect.promise(() => client.kilocode.organization.set({ organizationID: null }))
        yield* waitFor("kilo-auto/free", locationA)
        yield* Effect.promise(() => client.kilocode.organization.set({ organizationID: "team" }))
        const restoredA = yield* waitFor("kilo-auto/team", locationA)
        const restoredB = yield* waitFor("kilo-auto/team", locationB)
        for (const [name, data] of [
          ["location A", restoredA.data],
          ["location B", restoredB.data],
        ] as const) {
          assert(
            data.some((model) => model.providerID === "kilo" && model.id === "kilo-auto/team"),
            name,
          )
          assert(!data.some((model) => model.providerID === "kilo" && model.id === "kilo-auto/free"), name)
        }
      }),
    ).pipe(Effect.provide(NodeHttpServer.layerHttpServices)),
  )
  console.log("GATEWAY_SCOPE_ACCEPTANCE_OK")
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  await gateway.stop(true)
}

function waitOutcomeIsTerminal(outcome: unknown) {
  if (outcome === null) return true
  const name = outcome instanceof Error ? `${outcome.name} ${outcome.message}` : String(outcome)
  return !/timeout|abort/i.test(name)
}
