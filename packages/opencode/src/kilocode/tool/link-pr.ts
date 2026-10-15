import { Tool } from "@/tool/tool"
import { Instance } from "@/kilocode/instance"
import { enabled as prEnabled, linkMatchesWorktree, parsePrUrl } from "@/kilo-sessions/pr-link"
import { Effect, Schema } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import DESCRIPTION from "./link-pr.txt"

const log = Log.create({ service: "link-pr-tool" })

const Params = Schema.Struct({
  url: Schema.Trim.check(Schema.isMinLength(1)).check(
    Schema.makeFilter((value) => (value.trim() ? undefined : "URL must not be empty")),
  ),
})

type Meta = { ok: boolean; reason?: string; platform?: string; prNumber?: number; prUrl?: string }

const REJECTED_TEXT =
  "is not a pull request URL. Pass the full URL of the GitHub pull request, " +
  "GitLab merge request or Bitbucket pull request for this repository."

const FOREIGN_TEXT =
  "is not a pull request for this repository. Pass the full URL of the GitHub " +
  "pull request, GitLab merge request or Bitbucket pull request for this repository."

export const LinkPrTool = Tool.define<typeof Params, Meta, never, "link_pr">(
  "link_pr",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Params,
    execute: (params, ctx) =>
      Effect.gen(function* () {
        if (!prEnabled()) {
          return {
            title: "PR linking unavailable",
            output: "Session PR linking is only available in CLI backends.",
            metadata: { ok: false, reason: "unsupported_client" },
          }
        }
        const link = parsePrUrl(params.url)
        if (!link) {
          return {
            title: "PR link rejected",
            output: `${params.url} ${REJECTED_TEXT}`,
            metadata: { ok: false, reason: "invalid_url" },
          }
        }

        const worktree = Instance.worktree
        // A link for another host or project must not be pinned onto the session
        // (a mistaken or prompt-injected URL), the way a session-output link is
        // checked against the worktree's own repository. A worktree whose
        // repository cannot be resolved has nothing to compare against.
        const own = yield* Effect.tryPromise(() => linkMatchesWorktree(link, worktree)).pipe(
          Effect.orElseSucceed(() => true),
        )
        if (!own) {
          return {
            title: "PR link rejected",
            output: `${params.url} ${FOREIGN_TEXT}`,
            metadata: { ok: false, reason: "wrong_repo" },
          }
        }

        // Store the link against THIS session, never the worktree, so an
        // explicit link can never fan out to another session sharing the
        // checkout. `recordSessionLink` runs the same host/owner/repo check as
        // `linkMatchesWorktree` and refuses a link for a fork or another repo.
        const stored = yield* Effect.tryPromise({
          try: async () => {
            const { recordSessionLink } = await import("@/kilo-sessions/pr-link")
            return recordSessionLink(ctx.sessionID, { link, evidence: "user" }, worktree)
          },
          catch: (err) => err,
        }).pipe(
          Effect.map((record) => (record ? ("ok" as const) : ("refused" as const))),
          Effect.catch((err) =>
            Effect.sync(() => {
              log.warn("storing the session PR link failed", { err })
              return "error" as const
            }),
          ),
        )
        if (stored === "error") {
          return {
            title: "Link not stored",
            output: "Could not store the link; call link_pr again.",
            metadata: { ok: false, reason: "write_failed" },
          }
        }
        if (stored === "refused") {
          return {
            title: "PR link rejected",
            output: `${params.url} ${FOREIGN_TEXT}`,
            metadata: { ok: false, reason: "wrong_repo" },
          }
        }

        return {
          title: `Linked ${link.platform} pull request #${link.prNumber}`,
          output: `Linked ${link.prUrl}. This session now shows that pull request; an explicit link wins over any detected link.`,
          metadata: { ok: true, platform: link.platform, prNumber: link.prNumber, prUrl: link.prUrl },
        }
      }),
  }),
)
