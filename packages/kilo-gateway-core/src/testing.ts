// Local stand-in for the Kilo API. It answers the device auth, profile, models, and defaults routes
// in the shape of the deployed Gateway and records each request.
export function fixture() {
  const state = {
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
            variants: {
              high: { reasoningEffort: "high" },
            },
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
  }
  const requests: { method: string; path: string; authorization: string | null; organizationID?: string }[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname
      const organizationID = request.headers.get("x-kilocode-organizationid")
      requests.push({
        method: request.method,
        path,
        authorization: request.headers.get("authorization"),
        ...(organizationID ? { organizationID } : {}),
      })
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
      if (path === "/api/profile") return Response.json(state.profile, { status: state.profileStatus })
      if (
        path === "/api/openrouter/models" ||
        path === "/api/gateway/models" ||
        path === "/api/gateway/v1/models" ||
        path === "/api/v1/models"
      ) {
        const headers = state.modelsRetryAfter ? { "retry-after": state.modelsRetryAfter } : undefined
        if (state.modelsStatus !== 200) return new Response("Unavailable", { status: state.modelsStatus, headers })
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
      return new Response(null, { status: 404 })
    },
  })
  return { state, requests, url: server.url.origin, [Symbol.dispose]: () => server.stop(true) }
}
