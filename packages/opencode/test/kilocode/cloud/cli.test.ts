import { expect } from "bun:test"
import { AgentStartRequestSchema, MessageIdSchema, type AgentStartRequest } from "@/kilocode/cloud/contracts"
import { Effect } from "effect"
import { cliIt } from "../../lib/cli-process"

const TOKEN = "cloud-cli-test-token"
const ORG = "11111111-1111-4111-8111-111111111111"
const SESSION = "agent_12345678-1234-1234-1234-123456789abc"
const PROMPT = "Inspect the GitLab repository"
const REPO = "https://gitlab.com/Kilo-Org/kilocode.git"
const BRANCH = "feature/cloud-cli"
const MODEL = "anthropic/claude-sonnet-4"
const MODE = "debug"

cliIt.live(
  "cloud start maps explicit CLI flags into one authenticated request",
  ({ opencode }) => {
    const starts: AgentStartRequest[] = []
    return Effect.acquireUseRelease(
      Effect.sync(() =>
        Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          async fetch(request) {
            const url = new URL(request.url)
            if (url.pathname === "/api/profile") {
              return Response.json({ user: { email: "cloud-cli@example.com" }, organizations: [] })
            }
            if (url.pathname === `/api/organizations/${ORG}/models`) {
              return Response.json({ data: [{ id: MODEL, supported_parameters: ["tools"] }] })
            }
            if (url.pathname === `/api/organizations/${ORG}/defaults`) {
              return Response.json({ defaultModel: MODEL })
            }
            if (url.pathname === "/trpc/start") {
              const input = AgentStartRequestSchema.parse((await request.json()) as unknown)
              const id = MessageIdSchema.parse(input.message.id)
              starts.push(input)
              return Response.json({
                result: {
                  data: {
                    cloudAgentSessionId: SESSION,
                    kiloSessionId: "ses_cloud_cli_test",
                    messageId: id,
                    delivery: "queued",
                  },
                },
              })
            }
            return new Response(null, { status: 404 })
          },
        }),
      ),
      (server) =>
        Effect.gen(function* () {
          const result = yield* opencode.spawn(
            [
              "cloud",
              "start",
              "--prompt",
              PROMPT,
              "--repo",
              REPO,
              "--repo-type",
              "gitlab",
              "--branch",
              BRANCH,
              "--model",
              `kilo/${MODEL}`,
              "--mode",
              MODE,
              "--org-id",
              ORG,
            ],
            {
              env: {
                KILO_AUTH_CONTENT: JSON.stringify({ kilo: { type: "api", key: TOKEN } }),
                KILO_API_URL: server.url.origin,
                CLOUD_AGENT_NEXT_BASE_URL: server.url.origin,
                KILO_TELEMETRY_LEVEL: "off",
              },
            },
          )

          opencode.expectExit(result, 0, "cloud start")
          expect(starts).toHaveLength(1)

          const input = starts[0]
          const id = MessageIdSchema.parse(input.message.id)
          expect(input).toEqual({
            message: { prompt: PROMPT, id },
            agent: { mode: MODE, model: MODEL },
            repository: { type: "gitlab", url: REPO, branch: BRANCH },
            options: {
              createdOnPlatform: "kilo-cli",
              kilocodeOrganizationId: ORG,
            },
          })

          const output = {
            cloudAgentSessionId: SESSION,
            kiloSessionId: "ses_cloud_cli_test",
            messageId: id,
            delivery: "queued",
          }
          expect(result.stdout).toBe(JSON.stringify(output) + "\n")
          expect(JSON.parse(result.stdout) as unknown).toEqual(output)
        }),
      (server) => Effect.promise(() => server.stop(true)),
    )
  },
  60_000,
)
