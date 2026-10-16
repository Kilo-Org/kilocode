import { Resource } from "@opencode/console-resource"

const paths: Record<string, string | undefined> = {
  "POST /zen/v1/chat/completions": "/openai/v1/chat/completions",
  "POST /zen/v1/responses": "/openai/v1/responses",
  "POST /zen/v1/messages": "/anthropic/v1/messages",
  "POST /zen/v1/systemone": "/systemone/v1/systemone",
  "POST /zen/go/v1/chat/completions": "/go/openai/v1/chat/completions",
  "POST /zen/go/v1/responses": "/go/openai/v1/responses",
  "POST /zen/go/v1/messages": "/go/anthropic/v1/messages",
  "POST /zen/go/v1/systemone": "/go/systemone/v1/systemone",
  "GET /zen/v1/models": "/v1/models",
  "GET /zen/go/v1/models": "/go/v1/models",
  "GET /zen/go/v1/usage": "/go/v1/usage",
}

// New inference owns authentication, model availability, free-tier access, and billing.
export async function proxyInference(request: Request) {
  const url = new URL(request.url)
  const path =
    paths[`${request.method} ${url.pathname}`] ??
    (request.method === "POST" &&
    /^\/zen\/v1\/models\/[^/]+:(?:generateContent|streamGenerateContent)$/.test(url.pathname)
      ? url.pathname.replace("/zen/v1/models/", "/google/v1beta/models/")
      : undefined)
  if (!path) return new Response(null, { status: 404 })

  const key = url.pathname.endsWith("/messages")
    ? request.headers.get("x-api-key")
    : path.startsWith("/google/")
      ? request.headers.get("x-goog-api-key")
      : request.headers.get("authorization")?.split(" ")[1]

  const destination = new URL(Resource.ConsoleMigration.inferenceUrl)
  destination.pathname = `${destination.pathname.replace(/\/$/, "")}${path}`
  destination.search = url.search
  destination.hash = ""

  const forwarded = new Request(destination, request)
  for (const name of ["host", "content-length"]) forwarded.headers.delete(name)
  // Keyless requests must reach new inference without credentials; `public` is not an API key there.
  const anonymous = !key || key === "public"
  if (anonymous) for (const name of ["authorization", "x-api-key", "x-goog-api-key"]) forwarded.headers.delete(name)
  if (!anonymous) forwarded.headers.set("authorization", `Bearer ${key}`)
  const ip = request.headers.get("cf-connecting-ip")
  if (ip) forwarded.headers.set("x-real-ip", ip)
  const requestID = request.headers.get("x-opencode-request-id") ?? request.headers.get("x-opencode-request")
  if (requestID) forwarded.headers.set("x-opencode-request-id", requestID)

  const response = await (Resource.INFERENCE as { fetch: typeof fetch })
    .fetch(forwarded, { redirect: "manual" })
    .catch(() => undefined)
  if (!response)
    return Response.json(
      { error: { type: "api_error", message: "Inference routing is unavailable. Please retry later." } },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    )
  // SolidStart replaces 404 responses with its own route-not-found body, hiding the inference error.
  if (response.status !== 404) return response
  return new Response(response.body, { status: 400, statusText: "Bad Request", headers: response.headers })
}
