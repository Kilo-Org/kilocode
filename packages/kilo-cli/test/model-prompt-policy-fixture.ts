import { NodeHttpServer } from "@effect/platform-node"
import { createClient } from "@kilocode/client"
import { Service } from "@opencode-ai/client/effect/service"
import { Effect } from "effect"
import assert from "node:assert/strict"
import { launch } from "../src/interactive-server"
import { guardedFixtureLayout } from "./fixture"

// Deliberately opaque model IDs: dispatch must use the real Gateway catalog `opencode.prompt`
// tag, never a model-name heuristic. The loopback Gateway serves each model's tag in its
// catalog record; the production interactive-server wiring bridges the Gateway plugin's
// per-Location cache into the prompt policy (no test-injected registry).
// `conflict-claude-trinity` carries a `trinity` tag while its name matches the native claude
// heuristic, so the tag must win. `tagged-without-todo-claude` carries an `anthropic_without_todo`
// tag and matches the claude heuristic, proving the native baseline replaces the Anthropic asset.
// `tagged-codex` proves the adapted Codex prompt is applied with v2 tool names.
// `tagged-codex-gpt` proves native OpenAIPlugin append composition alongside the adapted Codex base.
// `tagged-gemini` proves the adapted Gemini prompt is applied with v2 tool schemas and background boolean.
// `tagged-ling` proves the adapted Ling prompt is applied without the non-existent shell description requirement.
// `tagged-deferred-*` prove unported legacy tags resolve to no override.
// `tagged-unknown` carries a value outside the closed enum, so
// the tolerant decode drops it and the native default applies. `heuristic-claude-opus` carries
// no tag and exercises the untouched native heuristic path.
const teamModels = [
  { id: "tagged-anthropic", tag: "anthropic" },
  { id: "tagged-trinity", tag: "trinity" },
  { id: "conflict-claude-trinity", tag: "trinity" },
  { id: "tagged-without-todo-claude", tag: "anthropic_without_todo" },
  { id: "tagged-codex", tag: "codex" },
  { id: "tagged-codex-gpt", tag: "codex" },
  { id: "tagged-gemini", tag: "gemini" },
  { id: "tagged-ling", tag: "ling" },
  { id: "tagged-gpt55", tag: "gpt55" },
  { id: "tagged-beast", tag: "beast" },
  { id: "tagged-unknown", tag: "unknown-selector" },
  { id: "heuristic-claude-opus", tag: undefined },
] as const
// The personal account serves a different tag for the shared model id, proving the reader
// re-reads the current account's catalog on refresh rather than retaining the team's tag.
const personalModels = [
  { id: "tagged-anthropic", tag: "trinity" },
  { id: "tagged-trinity", tag: "anthropic" },
  { id: "conflict-claude-trinity", tag: "trinity" },
  { id: "tagged-without-todo-claude", tag: "anthropic" },
  { id: "tagged-codex", tag: "anthropic_without_todo" },
  { id: "tagged-codex-gpt", tag: "codex" },
  { id: "tagged-gemini", tag: "ling" },
  { id: "tagged-ling", tag: "gemini" },
  { id: "tagged-gpt55", tag: "beast" },
  { id: "tagged-beast", tag: "gpt55" },
  { id: "tagged-unknown", tag: "unknown-selector" },
  { id: "heuristic-claude-opus", tag: undefined },
] as const

const requests: Array<{ model: unknown; messages: unknown; organization: string | null }> = []

const gateway = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === "/api/profile")
      return Response.json({
        organizations: [{ id: "team", name: "Fixture team", role: "member" }],
        selectedOrganizationId: "team",
        hasPersonalAccount: true,
      })
    if (url.pathname === "/api/openrouter/models" || url.pathname === "/api/organizations/team/models") {
      const served = url.pathname === "/api/openrouter/models" ? personalModels : teamModels
      return Response.json({
        data: served.map((item) => ({
          id: item.id,
          name: item.id,
          context_length: 128000,
          supported_parameters: ["tools"],
          opencode: {
            ai_sdk_provider: "openai-compatible",
            ...(item.tag === undefined ? {} : { prompt: item.tag }),
          },
        })),
      })
    }
    if (!url.pathname.startsWith("/api/gateway/")) return new Response(null, { status: 404 })
    const body = (await request.json()) as Record<string, unknown>
    requests.push({
      model: body.model,
      messages: body.messages,
      organization: request.headers.get("x-kilocode-organizationid"),
    })
    const text = `Reply ${String(body.model)}`
    if (!body.stream)
      return Response.json({
        id: "chat_fixture",
        object: "chat.completion",
        created: 1,
        model: body.model,
        choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
      })
    return new Response(
      [
        `data: ${JSON.stringify({
          id: "chat_fixture",
          object: "chat.completion.chunk",
          created: 1,
          model: body.model,
          choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }],
        })}\n\n`,
        `data: ${JSON.stringify({
          id: "chat_fixture",
          object: "chat.completion.chunk",
          created: 1,
          model: body.model,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        })}\n\n`,
      ].join(""),
      { headers: { "content-type": "text/event-stream" } },
    )
  },
})

// Extract the system-role message texts from a captured OpenAI-compatible chat request. The
// chat protocol lowers all system parts into leading `system` messages; content may be a
// string or an array of text blocks.
function systemTexts(messages: unknown): string[] {
  if (!Array.isArray(messages)) return []
  return messages.flatMap((message) => {
    if (typeof message !== "object" || message === null) return []
    const record = message as { role?: unknown; content?: unknown }
    if (record.role !== "system") return []
    if (typeof record.content === "string") return [record.content]
    if (!Array.isArray(record.content)) return []
    return record.content.flatMap((part) =>
      typeof part === "object" && part !== null && typeof (part as { text?: unknown }).text === "string"
        ? [(part as { text: string }).text]
        : [],
    )
  })
}

const ANTHROPIC_MARKER = "# Professional objectivity"
const TRINITY_MARKER = "what command should I run to list files"
const CODEX_MARKER = "You are Kilo, the best coding agent on the planet."
const GPT_EXTENSION_MARKER = "# Response channels"
const GEMINI_MARKER = "You are Kilo, an interactive CLI agent specializing in software engineering tasks."
const LING_MARKER = "Refuse to write code or explain code that may be used maliciously"
const GPT55_MARKER = "Treat the workspace as shared with the user and other agents."
const BEAST_MARKER = "please keep going until the user's query is completely resolved"

async function prompt(
  client: ReturnType<typeof createClient>,
  location: { directory: string },
  model: string,
  agent?: string,
) {
  const session = await client.session.create({
    location,
    title: `Fixture ${model}`,
    model: { providerID: "kilo", id: model },
    ...(agent === undefined ? {} : { agent }),
  })
  await client.session.prompt({ sessionID: session.id, text: `Use ${model}` })
  await client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10000) })
  const sent = requests.findLast((item) => item.model === model)
  assert(sent, `No captured request for ${model}`)
  return systemTexts(sent.messages)
}

try {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const input = guardedFixtureLayout()
        const endpoint = yield* launch(input, {
          models: false,
          recover: false,
          gateway: { server: gateway.url.origin },
          content: JSON.stringify({
            model: "kilo/tagged-anthropic",
            agents: { ask: { description: "Custom Ask", system: "Custom ask system prompt" } },
            providers: { kilo: { package: "aisdk:@ai-sdk/openai-compatible" } },
          }),
        })
        const client = createClient({
          baseUrl: endpoint.url,
          headers: Object.fromEntries(new Headers(Service.headers(endpoint))),
        })
        const location = { directory: process.cwd() }
        yield* Effect.promise(() => client.plugin.awaitActivation({ location }))
        yield* Effect.promise(() =>
          endpoint.importCredential({
            kind: "api-key",
            integrationID: "kilo",
            key: "fixture-only",
            label: "Fixture prompt selector",
            metadata: { server: gateway.url.origin, organizationID: "team" },
          }),
        )
        yield* Effect.promise(async () => {
          for (let i = 0; i < 100; i++) {
            if ((await client.model.list({ location })).data.some((item) => item.id === "tagged-anthropic")) return
            await Bun.sleep(20)
          }
          throw new Error("Gateway catalog did not activate")
        })

        // Catalog tag beats the name heuristic: an opaque ID with a verified tag adopts the
        // maintained v2 asset even though its name matches no heuristic.
        const anthropic = yield* Effect.promise(() => prompt(client, location, "tagged-anthropic"))
        assert(
          anthropic[0]?.includes(ANTHROPIC_MARKER),
          `tagged-anthropic must use the Anthropic asset: ${anthropic[0]}`,
        )

        const trinity = yield* Effect.promise(() => prompt(client, location, "tagged-trinity"))
        assert(trinity[0]?.includes(TRINITY_MARKER), `tagged-trinity must use the Trinity asset: ${trinity[0]}`)

        // Conflicting model-id heuristic: the id matches the native claude heuristic, but the
        // explicit trinity tag must win over the native Anthropic replacement.
        const conflict = yield* Effect.promise(() => prompt(client, location, "conflict-claude-trinity"))
        assert(
          conflict[0]?.includes(TRINITY_MARKER) && !conflict[0].includes(ANTHROPIC_MARKER),
          `explicit tag must beat the conflicting model-id heuristic: ${conflict[0]}`,
        )

        // anthropic_without_todo tag beats conflicting claude heuristic:
        // replaces Anthropic asset with the native baseline, retaining tool-guidance.
        const withoutTodo = yield* Effect.promise(() => prompt(client, location, "tagged-without-todo-claude"))
        assert(
          withoutTodo[0]?.startsWith("You are an AI agent powered by OpenCode") &&
            !withoutTodo[0].includes(ANTHROPIC_MARKER),
          `anthropic_without_todo tag must restore native baseline over claude heuristic: ${withoutTodo[0]}`,
        )
        assert(
          withoutTodo[0]?.includes("Prefer dedicated tools over shell commands") ||
            withoutTodo[0]?.includes("Use the edit tool for targeted changes"),
          `anthropic_without_todo must retain tool guidance in baseline: ${withoutTodo[0]}`,
        )

        // Codex tag applies adapted Codex prompt with v2 tool names and no apply_patch/Bash:
        const codex = yield* Effect.promise(() => prompt(client, location, "tagged-codex"))
        assert(codex[0]?.includes(CODEX_MARKER), `tagged-codex must use the Codex asset: ${codex[0]}`)
        assert(
          codex[0]?.includes("Use the edit tool for targeted changes") && !codex[0]?.includes("apply_patch"),
          `tagged-codex must adapt tool names to edit and remove apply_patch: ${codex[0]}`,
        )
        assert(
          codex[0]?.includes("Use read to view files") &&
            codex[0]?.includes("Use shell for terminal operations") &&
            !codex[0]?.includes("Use Bash"),
          `tagged-codex must adapt tools to read/edit/write/glob/grep/shell: ${codex[0]}`,
        )

        // Composition: tagged-codex-gpt has "gpt" in ID, triggering native OpenAIPlugin append
        // which joins into the system message alongside the adapted Codex base.
        const codexGpt = yield* Effect.promise(() => prompt(client, location, "tagged-codex-gpt"))
        assert(codexGpt[0]?.includes(CODEX_MARKER), `tagged-codex-gpt base must be Codex prompt: ${codexGpt[0]}`)
        assert(
          codexGpt[0]?.includes(GPT_EXTENSION_MARKER),
          `tagged-codex-gpt must preserve native OpenAIPlugin append in system message: ${codexGpt[0]}`,
        )

        // Gemini tag applies adapted Gemini prompt with v2 tool schemas and background boolean:
        const gemini = yield* Effect.promise(() => prompt(client, location, "tagged-gemini"))
        assert(gemini[0]?.includes(GEMINI_MARKER), `tagged-gemini must use the Gemini asset: ${gemini[0]}`)
        assert(
          gemini[0]?.includes("background: true") && !gemini[0]?.includes("node server.js &"),
          `tagged-gemini must adapt background execution to v2 boolean: ${gemini[0]}`,
        )
        assert(
          gemini[0]?.includes("Use the 'shell' tool for running terminal commands") &&
            !gemini[0]?.includes("filePath argument"),
          `tagged-gemini must adapt tool and path parameters to v2: ${gemini[0]}`,
        )
        assert(
          !gemini[0]?.includes("confirmation dialogue upon use") &&
            !gemini[0]?.includes("Most tool calls will first require confirmation"),
          `tagged-gemini must not claim guaranteed confirmation dialogues: ${gemini[0]}`,
        )
        assert(
          gemini[0]?.includes("permissions are governed by configured rules"),
          `tagged-gemini must respect configured permission outcomes: ${gemini[0]}`,
        )

        // Ling tag applies adapted Ling prompt without non-existent shell description schema:
        const ling = yield* Effect.promise(() => prompt(client, location, "tagged-ling"))
        assert(ling[0]?.includes(LING_MARKER), `tagged-ling must use the Ling asset: ${ling[0]}`)
        assert(
          ling[0]?.includes('"No changes to apply" error = early stop signal'),
          `tagged-ling must preserve stop signals: ${ling[0]}`,
        )
        assert(
          !ling[0]?.includes("Every Bash tool call MUST include a `description` field") &&
            !ling[0]?.includes('{"command": "git status", "description"'),
          `tagged-ling must omit non-existent shell description requirement: ${ling[0]}`,
        )
        assert(
          ling[0]?.includes("background: true"),
          `tagged-ling must use v2 background boolean for long-running commands: ${ling[0]}`,
        )

        // Gpt55 tag applies adapted GPT-5.5 prompt with v2 tools, reconciled delegation, and native OpenAI append:
        const gpt55 = yield* Effect.promise(() => prompt(client, location, "tagged-gpt55"))
        assert(gpt55[0]?.includes(GPT55_MARKER), `tagged-gpt55 must use the GPT-5.5 asset: ${gpt55[0]}`)
        assert(
          gpt55[0]?.includes("do not spawn subagents proactively"),
          `tagged-gpt55 must reconcile delegation with v2 rules: ${gpt55[0]}`,
        )
        assert(
          gpt55[0]?.includes("Use shell for terminal operations") && !gpt55[0]?.includes("apply_patch"),
          `tagged-gpt55 must adapt tool names to v2: ${gpt55[0]}`,
        )
        assert(
          gpt55[0]?.includes(GPT_EXTENSION_MARKER),
          `tagged-gpt55 must preserve native OpenAI append composition: ${gpt55[0]}`,
        )

        // Beast tag applies adapted Beast prompt with deep autonomy, v2 tools, and no mandatory web crawling:
        const beast = yield* Effect.promise(() => prompt(client, location, "tagged-beast"))
        assert(beast[0]?.includes(BEAST_MARKER), `tagged-beast must use the Beast asset: ${beast[0]}`)
        assert(
          beast[0]?.includes("Respect user constraints, including local-only work"),
          "Beast must preserve user constraints on the wire",
        )
        assert(
          beast[0]?.includes("Investigate the codebase using `glob` and `grep` search tools."),
          `tagged-beast must adapt tool usage to v2: ${beast[0]}`,
        )
        assert(
          !beast[0]?.includes("search google for how to properly use libraries") &&
            !beast[0]?.includes(".github/instructions/memory.instruction.md"),
          `tagged-beast must omit unavailable legacy tool/memory assumptions: ${beast[0]}`,
        )

        // Unknown tag: no override, so the opaque ID keeps the native default base prompt.
        const unknown = yield* Effect.promise(() => prompt(client, location, "tagged-unknown"))
        assert(
          unknown[0]?.startsWith("You are an AI agent powered by OpenCode") &&
            !unknown[0].includes(ANTHROPIC_MARKER) &&
            !unknown[0].includes(TRINITY_MARKER),
          `unknown tag must keep the native default base prompt: ${unknown[0]}`,
        )

        // Untagged model: the native name heuristic still applies (claude -> Anthropic asset),
        // proving the plugin leaves the native heuristic path intact.
        const heuristic = yield* Effect.promise(() => prompt(client, location, "heuristic-claude-opus"))
        assert(
          heuristic[0]?.includes(ANTHROPIC_MARKER),
          `untagged claude must keep the native Anthropic heuristic: ${heuristic[0]}`,
        )

        // A custom agent system always wins over the catalog tag.
        const custom = yield* Effect.promise(() => prompt(client, location, "tagged-anthropic", "ask"))
        assert(
          custom[0]?.startsWith("Custom ask system prompt") && !custom[0].includes(ANTHROPIC_MARKER),
          `custom agent system must win over the catalog tag: ${custom[0]}`,
        )

        // Preservation: the tag override replaces only the base part and keeps the native
        // supplementary parts the session composes after it. The tagged request must retain the
        // environment block alongside the replaced base, and the tool-guidance the native
        // baseline contributes must survive too — proving the override never cleared the system
        // array or discarded instruction/project/history content. (The environment block is
        // per-session, so preservation is asserted by presence, not cross-session equality.)
        assert(
          anthropic[0]?.includes("useful information about the environment"),
          `tag override must preserve the native supplementary environment part: ${anthropic[0]}`,
        )
        assert(
          anthropic[0]?.includes("Prefer dedicated tools over shell commands") || anthropic[0]?.includes("subagent"),
          `tag override must preserve the baseline tool-guidance composition: ${anthropic[0]}`,
        )
        // The base itself must be the Anthropic asset, not the native default baseline (which
        // begins "You are an AI agent powered by OpenCode, a coding agent harness.").
        assert(
          !anthropic[0]?.startsWith("You are an AI agent powered by OpenCode"),
          `tag override must replace the default baseline base part: ${anthropic[0]}`,
        )

        // Account/location refresh: switch team -> personal. The personal account serves a
        // different tag for the same model id (`tagged-anthropic`: anthropic -> trinity), so the
        // reader must re-read the current account's catalog and the override must follow it —
        // proving no stale team tag survives, and the team routing header does not either.
        yield* Effect.promise(() => client.kilocode.organization.set({ organizationID: null }, { location }))
        const personal = yield* Effect.promise(() => prompt(client, location, "tagged-anthropic"))
        assert(
          personal[0]?.includes(TRINITY_MARKER) && !personal[0].includes(ANTHROPIC_MARKER),
          `tag override must follow the account refresh to the personal tag: ${personal[0]}`,
        )
        const last = requests.findLast((item) => item.model === "tagged-anthropic")
        assert.equal(last?.organization, null, "team header must not survive switching to personal")

        const personalClaude = yield* Effect.promise(() => prompt(client, location, "tagged-without-todo-claude"))
        assert(
          personalClaude[0]?.includes(ANTHROPIC_MARKER),
          `tagged-without-todo-claude must adopt personal anthropic tag on refresh: ${personalClaude[0]}`,
        )

        const personalCodex = yield* Effect.promise(() => prompt(client, location, "tagged-codex"))
        assert(
          personalCodex[0]?.startsWith("You are an AI agent powered by OpenCode") &&
            !personalCodex[0]?.includes(CODEX_MARKER),
          `tagged-codex must adopt personal anthropic_without_todo tag on refresh: ${personalCodex[0]}`,
        )

        const personalGemini = yield* Effect.promise(() => prompt(client, location, "tagged-gemini"))
        assert(
          personalGemini[0]?.includes(LING_MARKER) && !personalGemini[0]?.includes(GEMINI_MARKER),
          `tagged-gemini must adopt personal ling tag on refresh: ${personalGemini[0]}`,
        )

        const personalLing = yield* Effect.promise(() => prompt(client, location, "tagged-ling"))
        assert(
          personalLing[0]?.includes(GEMINI_MARKER) && !personalLing[0]?.includes(LING_MARKER),
          `tagged-ling must adopt personal gemini tag on refresh: ${personalLing[0]}`,
        )

        const personalGpt55 = yield* Effect.promise(() => prompt(client, location, "tagged-gpt55"))
        assert(
          personalGpt55[0]?.includes(BEAST_MARKER) && !personalGpt55[0]?.includes(GPT55_MARKER),
          `tagged-gpt55 must adopt personal beast tag on refresh: ${personalGpt55[0]}`,
        )

        const personalBeast = yield* Effect.promise(() => prompt(client, location, "tagged-beast"))
        assert(
          personalBeast[0]?.includes(GPT55_MARKER) && !personalBeast[0]?.includes(BEAST_MARKER),
          `tagged-beast must adopt personal gpt55 tag on refresh: ${personalBeast[0]}`,
        )
      }),
    ).pipe(Effect.provide(NodeHttpServer.layerHttpServices)),
  )
  console.log("MODEL_PROMPT_POLICY_OK")
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  await gateway.stop(true)
}
