export function fixture() {
  const state = {
    createStatus: 200,
    pollStatus: 200,
    pending: 1,
    profileStatus: 200,
    balanceStatus: 200,
    balance: { balance: 42.5 } as unknown,
    kiloPassStatus: 200,
    kiloPass: [
      {
        result: {
          data: {
            json: {
              subscription: {
                status: "active",
                currentPeriodBaseCreditsUsd: 19,
                currentPeriodUsageUsd: 4.5,
                currentPeriodBonusCreditsUsd: 2,
                nextBillingAt: "2026-10-01T00:00:00.000Z",
              },
            },
          },
        },
      },
    ] as unknown,
    modelsStatus: 200,
    models: {
      data: [
        { id: "kilo/auto", preferredIndex: 1, autoRouting: { models: ["kilo/balanced", "kilo/free"] } },
        { id: "kilo/balanced", preferredIndex: 2, supported_parameters: ["tools"] },
      ],
    } as unknown,
    expiresIn: 60,
    verificationUrl: undefined as string | undefined,
    approved: { status: "approved", token: "fixture-token", userEmail: "device@example.test" } as unknown,
    profile: {
      user: { email: "profile@example.test", name: "Fixture" },
      organizations: [
        { id: "first", name: "First", role: "member" },
        { id: "selected", name: "Selected", role: "owner" },
      ],
      selectedOrganizationId: "selected",
      hasPersonalAccount: true,
    } as unknown,
  }
  const requests: {
    path: string
    method: string
    body: string
    authorization: string | null
    organizationID: string | null
  }[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname
      requests.push({
        path,
        method: request.method,
        body: await request.text(),
        authorization: request.headers.get("authorization"),
        organizationID: request.headers.get("x-kilocode-organizationid"),
      })
      if (path === "/api/device-auth/codes") {
        return Response.json(
          {
            code: "fixture/code",
            verificationUrl: state.verificationUrl ?? new URL("/verify", request.url).href,
            expiresIn: state.expiresIn,
          },
          { status: state.createStatus },
        )
      }
      if (path === "/api/device-auth/codes/fixture%2Fcode") {
        if (state.pending-- > 0) return new Response(null, { status: 202 })
        return Response.json(state.approved, { status: state.pollStatus })
      }
      if (path === "/api/profile") return Response.json(state.profile, { status: state.profileStatus })
      if (path === "/api/profile/balance") return Response.json(state.balance, { status: state.balanceStatus })
      if (path === "/api/trpc/kiloPass.getState") return Response.json(state.kiloPass, { status: state.kiloPassStatus })
      if (path === "/api/openrouter/models" || path.startsWith("/api/organizations/")) {
        return Response.json(state.models, { status: state.modelsStatus })
      }
      return new Response(null, { status: 404 })
    },
  })
  return { state, requests, url: server.url.origin, [Symbol.dispose]: () => server.stop(true) }
}
