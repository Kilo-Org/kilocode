// Local stand-in for the Kilo API. It answers the device auth, profile, models, and defaults routes
// in the shape of the deployed Gateway and records each request.
export function fixture() {
  const state = {
    // Milliseconds each response waits before it is sent, to simulate network latency.
    delay: 0,
    createStatus: 200,
    expiresIn: 60,
    verificationUrl: undefined as string | undefined,
    pending: 1,
    // Statuses that the poll route returns first, one per request, before it answers normally.
    pollErrors: [] as number[],
    // The poll route never answers.
    hang: false,
    pollStatus: 200,
    approved: { status: "approved", token: "fixture-token", userEmail: "device@example.test" } as unknown,
    profileStatus: 200,
    profilePending: undefined as Promise<void> | undefined,
    profile: {
      user: { email: "profile@example.test", name: "Fixture" },
      organizations: [
        { id: "first", name: "First", role: "member" },
        { id: "selected", name: "Selected", role: "owner" },
      ],
      selectedOrganizationId: "selected",
      hasPersonalAccount: true,
    } as unknown,
    modelsStatus: 200,
    authenticatedModelsStatus: undefined as number | undefined,
    modelsPending: undefined as Promise<void> | undefined,
    modelsRetryAfter: undefined as string | undefined,
    models: {
      data: [
        {
          id: "kilo-auto/free",
          name: "Kilo Auto Free",
          description: "Free router model",
          context_length: 128000,
          max_completion_tokens: 16384,
          supported_parameters: ["tools", "temperature"],
          isFree: true,
          preferredIndex: 1,
          opencode: { reasoning_options: [] },
        },
        {
          id: "kilo-auto/frontier",
          name: "Kilo Auto Frontier",
          description: "Frontier router model",
          context_length: 200000,
          max_completion_tokens: 32000,
          supported_parameters: ["tools", "reasoning", "temperature"],
          isFree: false,
          preferredIndex: 0,
          hasUserByokAvailable: true,
          mayTrainOnYourPrompts: false,
          autoRouting: { models: ["anthropic/claude-sonnet-4.6", "openai/gpt-5.4"] },
          terminalBench: { overallScore: 0.72, avgAttemptCostUsd: 0.45 },
          pricing: { prompt: "0.000003", completion: "0.000015", input_cache_read: "0.0000003" },
          opencode: {
            family: "claude",
            ai_sdk_provider: "openrouter",
            prompt: "anthropic",
            // Malformed entries and null values must be dropped without losing the valid option.
            reasoning_options: [null, { type: "unknown" }, { type: "effort", values: [null, "high"] }],
          },
        },
        {
          id: "kilo-auto/small",
          name: "Kilo Auto Small",
          context_length: 128000,
          max_completion_tokens: 8192,
          supported_parameters: ["tools"],
          isFree: true,
        },
        {
          id: "google/gemini-2.5-flash-image",
          name: "Gemini 2.5 Flash Image",
          description: "Image generation model",
          context_length: 64000,
          supported_parameters: ["temperature"],
          architecture: {
            input_modalities: ["text", "image"],
            output_modalities: ["text", "image"],
          },
          isFree: false,
        },
      ],
    } as unknown,
    teamModelsStatus: 200,
    teamModels: {
      data: [
        {
          id: "anthropic/claude-sonnet-4.6",
          name: "Claude Sonnet 4.6 (Team)",
          context_length: 200000,
          max_completion_tokens: 32000,
          supported_parameters: ["tools", "reasoning"],
          isFree: false,
          opencode: {
            family: "claude",
            ai_sdk_provider: "anthropic",
            reasoning_options: [{ type: "effort", values: ["low", "medium", "high", "max"] }],
          },
        },
        {
          id: "kilo-auto/small",
          name: "Kilo Auto Small",
          context_length: 128000,
          max_completion_tokens: 8192,
          supported_parameters: ["tools"],
          isFree: false,
        },
        {
          id: "google/gemini-2.5-flash-image",
          name: "Gemini 2.5 Flash Image",
          description: "Image generation model",
          context_length: 64000,
          supported_parameters: ["temperature"],
          architecture: {
            input_modalities: ["text", "image"],
            output_modalities: ["text", "image"],
          },
          isFree: false,
        },
      ],
    } as unknown,
    defaultsStatus: 200,
    defaults: {
      defaultModel: "kilo-auto/frontier",
      defaultFreeModel: "kilo-auto/free",
    } as unknown,
    teamDefaultsStatus: 200,
    teamDefaults: {
      defaultModel: "anthropic/claude-sonnet-4.6",
      defaultFreeModel: null,
    } as unknown,
    balanceStatus: 200,
    balance: { balance: 42.5, isDepleted: false } as unknown,
    kiloPassStatus: 200,
    kiloPass: [
      {
        result: {
          data: {
            json: {
              subscription: {
                status: "active",
                currentPeriodBaseCreditsUsd: 50,
                currentPeriodUsageUsd: 12.25,
                currentPeriodBonusCreditsUsd: 5,
                nextBillingAt: "2026-11-01T00:00:00Z",
              },
            },
          },
        },
      },
    ] as unknown,
    modesStatus: 200,
    modes: {
      modes: [
        {
          id: "mode-1",
          organization_id: "selected",
          name: "Security Reviewer",
          slug: "security-reviewer",
          created_by: "user-1",
          created_at: "2026-10-01T00:00:00Z",
          updated_at: "2026-10-01T00:00:00Z",
          config: {
            roleDefinition: "Review code for security issues",
            description: "Organization security mode",
            groups: ["read", ["edit", { fileRegex: "\\.ts$" }]],
          },
        },
      ],
    } as unknown,
    notificationsStatus: 200,
    notifications: {
      notifications: [
        {
          id: "notif-1",
          title: "Kilo v2 Available",
          message: "Try the new v2 CLI.",
          action: { actionText: "Learn more", actionURL: "https://kilo.ai" },
          showIn: ["cli"],
        },
      ],
    } as unknown,
    transcriptionModelsStatus: 200,
    transcriptionModels: {
      data: [
        { id: "openai/gpt-4o-mini-transcribe", name: "GPT-4o Mini Transcribe" },
      ],
    } as unknown,
    embeddingModelsStatus: 200,
    embeddingModels: {
      defaultModel: "mistralai/mistral-embed-2312",
      models: [
        {
          id: "mistralai/codestral-embed-2505",
          name: "Codestral Embed 2505",
          dimension: 1536,
          scoreThreshold: 0.35,
          note: "code",
        },
        { id: "mistralai/mistral-embed-2312", name: "Mistral Embed 2312", dimension: 1024, scoreThreshold: 0.35 },
      ],
      aliases: { "codestral-embed": "mistralai/codestral-embed-2505" },
    } as unknown,
    byokStatus: 200,
    byok: {
      result: {
        data: {
          json: [
            { id: "byok-1", provider_id: "anthropic", management_source: "user", is_enabled: true },
          ],
        },
      },
    } as unknown,
    codingPlansStatus: 200,
    codingPlans: {
      result: {
        data: {
          json: [
            {
              id: "sub-1",
              planId: "plan-pro",
              planName: "Kilo Coding Plan Pro",
              providerName: "Anthropic",
              providerId: "anthropic",
              canQueryUsage: true,
              hasInstalledByokKey: true,
              status: "active",
              cancelAtPeriodEnd: false,
            },
          ],
        },
      },
    } as unknown,
    codingPlanUsageStatus: 200,
    codingPlanUsage: {
      result: {
        data: {
          json: {
            schemaVersion: 1,
            fetchedAt: "2026-10-14T12:00:00Z",
            subscription: {
              id: "sub-1",
              planName: "Kilo Coding Plan Pro",
              providerId: "anthropic",
              providerName: "Anthropic",
              windows: [
                {
                  id: "five_hour",
                  remainingPercent: 75,
                  resetsAt: "2026-10-14T17:00:00Z",
                  period: { unit: "hour", value: 5 },
                },
              ],
            },
          },
        },
      },
    } as unknown,
    // Custom auto routers (ADR 0005). The web REST routes and the worker routes; point KILO_AUTO_ROUTING_URL here.
    customRoutersStatus: 200,
    customRouters: { routers: [customRouter()] } as { routers: ReturnType<typeof customRouter>[] },
    // A fixed decision body. Unset, the worker picks the first servable client entry, else the first gateway entry.
    decide: undefined as unknown,
    decideStatus: 200,
    evalPlan: undefined as unknown,
    evalCase: { caseId: "case-1", baseRouter: "efficient", prompt: "Reply with OK.", timeoutMs: 60_000 } as unknown,
    evalResult: { score: 1 } as unknown,
    evalStatus: 200,
    // Request bodies of the custom router routes, in order.
    customRouterBodies: [] as { method: string; path: string; body: unknown }[],
  }
  const requests: { method: string; path: string; authorization: string | null; organizationID?: string }[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname
      const organizationID = request.headers.get("x-kilocode-organizationid")
      requests.push({
        method: request.method,
        path,
        authorization: request.headers.get("authorization"),
        ...(organizationID ? { organizationID } : {}),
      })
      if (state.delay > 0) await Bun.sleep(state.delay)
      if (path === "/api/device-auth/codes") {
        return Response.json(
          {
            code: "ABCD-1234",
            verificationUrl: state.verificationUrl ?? new URL("/device-auth?code=ABCD-1234", request.url).href,
            expiresIn: state.expiresIn,
          },
          { status: state.createStatus },
        )
      }
      if (path === "/api/device-auth/codes/ABCD-1234") {
        if (state.hang) return new Promise<Response>(() => {})
        const error = state.pollErrors.shift()
        if (error) return new Response(null, { status: error })
        if (state.pending-- > 0) return new Response(null, { status: 202 })
        return Response.json(state.approved, { status: state.pollStatus })
      }
      if (path === "/api/profile") {
        const pending = state.profilePending
        state.profilePending = undefined
        if (pending) await pending
        return Response.json(state.profile, { status: state.profileStatus })
      }
      if (
        path === "/api/openrouter/models" ||
        path === "/api/gateway/models" ||
        path === "/api/gateway/v1/models" ||
        path === "/api/v1/models"
      ) {
        const pending = state.modelsPending
        state.modelsPending = undefined
        if (pending) await pending
        const headers = state.modelsRetryAfter ? { "retry-after": state.modelsRetryAfter } : undefined
        const status =
          request.headers.has("authorization") && request.headers.get("authorization") !== "Bearer anonymous"
            ? state.authenticatedModelsStatus ?? state.modelsStatus
            : state.modelsStatus
        if (status !== 200) return new Response("Unavailable", { status, headers })
        return Response.json(state.models)
      }
      if (/^\/api\/(?:gateway\/v1\/|v1\/)?organizations\/[^/]+\/models$/.test(path)) {
        const headers = state.modelsRetryAfter ? { "retry-after": state.modelsRetryAfter } : undefined
        if (state.teamModelsStatus !== 200) return new Response("Unavailable", { status: state.teamModelsStatus, headers })
        return Response.json(state.teamModels)
      }
      if (path === "/api/defaults") {
        if (state.defaultsStatus !== 200) return new Response(null, { status: state.defaultsStatus })
        return Response.json(state.defaults)
      }
      if (/^\/api\/organizations\/[^/]+\/defaults$/.test(path)) {
        if (state.teamDefaultsStatus !== 200) return new Response(null, { status: state.teamDefaultsStatus })
        return Response.json(state.teamDefaults)
      }
      if (path === "/api/profile/balance") {
        if (state.balanceStatus !== 200) return new Response(null, { status: state.balanceStatus })
        return Response.json(state.balance)
      }
      if (/^\/api\/organizations\/[^/]+\/modes$/.test(path)) {
        if (state.modesStatus !== 200) return new Response(null, { status: state.modesStatus })
        return Response.json(state.modes)
      }
      if (path === "/api/users/notifications") {
        if (state.notificationsStatus !== 200) return new Response(null, { status: state.notificationsStatus })
        return Response.json(state.notifications)
      }
      if (
        path === "/api/gateway/transcription-models" ||
        path === "/api/gateway/v1/transcription-models" ||
        path === "/api/v1/transcription-models"
      ) {
        if (state.transcriptionModelsStatus !== 200)
          return new Response(null, { status: state.transcriptionModelsStatus })
        return Response.json(state.transcriptionModels)
      }
      if (
        path === "/api/gateway/embedding-models" ||
        path === "/api/gateway/v1/embedding-models" ||
        path === "/api/v1/embedding-models"
      ) {
        if (state.embeddingModelsStatus !== 200) return new Response(null, { status: state.embeddingModelsStatus })
        return Response.json(state.embeddingModels)
      }
      if (path.startsWith("/api/auto-routing/") || path.startsWith("/v1/")) return customRouterRoute(state, request, path)
      if (path === "/api/trpc/kiloPass.getState") {
        if (state.kiloPassStatus !== 200) return new Response(null, { status: state.kiloPassStatus })
        return Response.json(state.kiloPass)
      }
      if (path === "/api/trpc/byok.list") {
        if (state.byokStatus !== 200) return new Response(null, { status: state.byokStatus })
        return Response.json(state.byok)
      }
      if (path === "/api/trpc/codingPlans.listSubscriptions") {
        if (state.codingPlansStatus !== 200) return new Response(null, { status: state.codingPlansStatus })
        return Response.json(state.codingPlans)
      }
      if (path === "/api/trpc/codingPlans.getUsage") {
        if (state.codingPlanUsageStatus !== 200) return new Response(null, { status: state.codingPlanUsageStatus })
        return Response.json(state.codingPlanUsage)
      }
      return new Response(null, { status: 404 })
    },
  })
  return { state, requests, url: server.url.origin, [Symbol.dispose]: () => server.stop(true) }
}

const ROUTER_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301"

function customRouter() {
  return {
    id: ROUTER_ID,
    scope: "user" as const,
    slug: "myrouter",
    name: "My Router",
    modelId: "kilo-auto/custom/myrouter",
    baseRouter: "efficient" as const,
    mode: "cost_per_accuracy" as const,
    defaultEntryKey: "gateway:anthropic/claude-sonnet-4.6",
    canEdit: true,
    entries: [
      {
        key: "gateway:anthropic/claude-sonnet-4.6",
        entry: { kind: "gateway", model: "anthropic/claude-sonnet-4.6" } as Record<string, unknown>,
        needsClientEval: false,
        variants: [{ variant: null as string | null, status: "ready", failureReason: null as string | null }],
      },
    ],
  }
}

interface FixtureState {
  customRoutersStatus: number
  customRouters: { routers: ReturnType<typeof customRouter>[] }
  decide: unknown
  decideStatus: number
  evalPlan: unknown
  evalCase: unknown
  evalResult: unknown
  evalStatus: number
  customRouterBodies: { method: string; path: string; body: unknown }[]
}

async function customRouterRoute(state: FixtureState, request: Request, path: string) {
  const url = new URL(request.url)
  const body = request.method === "GET" || request.method === "DELETE" ? undefined : await request.json().catch(() => undefined)
  state.customRouterBodies.push({ method: request.method, path: `${path}${url.search}`, body })
  const fields: Record<string, unknown> = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {}
  if (path === "/api/auto-routing/custom-routers") {
    if (state.customRoutersStatus !== 200) return new Response("Unavailable", { status: state.customRoutersStatus })
    return Response.json(state.customRouters)
  }
  const entries = /^\/api\/auto-routing\/custom-routers\/(user|org)\/([^/]+)\/client-entries$/.exec(path)
  if (entries) {
    const router = state.customRouters.routers.find((item) => item.scope === entries[1] && item.slug === entries[2])
    if (!router) return Response.json({ error: { code: "router_not_found", message: "no such router" } }, { status: 404 })
    if (request.method === "POST") {
      const entry = fields.entry
      if (typeof entry !== "object" || entry === null || !("provider" in entry) || !("model" in entry))
        return Response.json({ error: { code: "invalid_request", message: "entry is required" } }, { status: 400 })
      const key = `client:${entry.provider}/${entry.model}`
      router.entries = [
        ...router.entries.filter((item) => item.key !== key),
        { key, entry, needsClientEval: true, variants: [{ variant: null, status: "missing", failureReason: null }] },
      ]
    }
    if (request.method === "DELETE") {
      const key = `client:${url.searchParams.get("provider")}/${url.searchParams.get("model")}`
      router.entries = router.entries.filter((item) => item.key !== key)
    }
    return Response.json({ router })
  }
  if (path === "/v1/decide") {
    if (state.decideStatus !== 200 || state.decide !== undefined)
      return Response.json(state.decide ?? {}, { status: state.decideStatus })
    const client = (fields.clientEntries as { provider: string; model: string }[] | undefined)?.[0]
    const entry = client
      ? { kind: "client", provider: client.provider, model: client.model }
      : { kind: "gateway", model: "anthropic/claude-sonnet-4.6" }
    return Response.json({
      decision: {
        entry,
        model: client ? `client:${client.provider}/${client.model}` : entry.model,
        variant: null,
        stale: false,
        fallback: false,
        sticky: false,
        taskType: "code",
        subtaskType: null,
        tableVersion: "fixture",
      },
      decisionId: "fixture-decision",
    })
  }
  if (state.evalStatus !== 200) return Response.json({ error: { code: "quota_exceeded", message: "limit" } }, { status: state.evalStatus })
  if (path === "/v1/eval/plan") {
    if (state.evalPlan !== undefined) return Response.json(state.evalPlan)
    const router = state.customRouters.routers.find((item) => item.id === fields.routerId)
    const items = (router?.entries ?? [])
      .filter((item) => item.needsClientEval)
      .map((item) => ({ entry: item.entry, variant: null, caseId: "case-1", rep: 0 }))
    return Response.json({ baseRouter: "efficient", engineIdentity: "fixture-engine", repetitions: 1, items, staleEntries: [] })
  }
  if (path === "/v1/eval/case") return Response.json(state.evalCase)
  if (path === "/v1/eval/result") return Response.json(state.evalResult)
  return new Response(null, { status: 404 })
}
