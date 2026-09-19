import { Tool } from "@/tool/tool"
import { Instance } from "@/kilocode/instance"
import { linkMatchesWorktree, parsePrUrl } from "@/kilo-sessions/pr-link"
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
    execute: (params) =>
      Effect.gen(function* () {
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

        const stored = yield* Effect.tryPromise({
          try: async () => {
            const { writePrLinkOverride } = await import("@/kilo-sessions/pr-link")
            await writePrLinkOverride(worktree, link)
          },
          catch: (err) => err,
        }).pipe(
          Effect.as(true),
          Effect.catch((err) =>
            Effect.sync(() => {
              log.warn("storing the PR link override failed", { err })
              return false
            }),
          ),
        )
        if (!stored) {
          return {
            title: "Link not stored",
            output: "Could not store the link; call link_pr again.",
            metadata: { ok: false, reason: "write_failed" },
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
