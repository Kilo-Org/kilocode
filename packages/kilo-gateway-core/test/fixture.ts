// Local stand-in for the Kilo API. It answers the device auth and profile routes in the shape of the
// deployed Gateway and records each request.
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
  }
  const requests: { method: string; path: string; authorization: string | null }[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname
      requests.push({ method: request.method, path, authorization: request.headers.get("authorization") })
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
      return new Response(null, { status: 404 })
    },
  })
  return { state, requests, url: server.url.origin, [Symbol.dispose]: () => server.stop(true) }
}
