import { Effect } from "effect"
import type { Argv } from "yargs"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { effectCmd, fail } from "../effect-cmd"
import { Git } from "@/git"
import { InstanceRef } from "@/effect/instance-ref"
import { Process } from "@/util/process"
import { existsSync } from "node:fs" // kilocode_change
import { detectPrLink, parsePrUrl, readPrLinkOverride, writePrLinkOverride } from "@/kilo-sessions/pr-link" // kilocode_change

const subcommand = "pr" // kilocode_change

// kilocode_change start - resolve the currently running CLI instead of hardcoding opencode
export function cliCommand(
  input = {
    execPath: process.execPath,
    argv: process.argv,
    exists: existsSync,
  },
) {
  const script = input.argv[1]
  if (!script) return [input.execPath]
  if (script === subcommand) return [input.execPath] // kilocode_change
  if (script.startsWith("/$bunfs/root/")) return [input.execPath]
  if (script.startsWith("B:/~BUN/root/")) return [input.execPath]
  if (input.exists(script)) return [input.execPath, script]
  return [input.execPath]
}
// kilocode_change end

export const PrCommand = cmd({
  command: subcommand,
  describe: "manage pull requests", // kilocode_change
  builder: (yargs: Argv) =>
    yargs
      .command(PrCheckoutCommand)
      .command(PrLinkCommand)
      .command(PrUnlinkCommand)
      .command(PrStatusCommand)
      .demandCommand(),
  async handler() {},
})

export const PrCheckoutCommand = effectCmd({
  command: "checkout <number>",
  describe: "fetch and checkout a GitHub PR branch, then run kilo", // kilocode_change
  builder: (yargs) =>
    yargs.positional("number", {
      type: "number",
      describe: "PR number to checkout",
      demandOption: true,
    }),
  handler: Effect.fn("Cli.pr.checkout")(function* (args) {
    const ctx = yield* InstanceRef
    if (!ctx) return yield* fail("Could not load instance context")
    if (ctx.project.vcs !== "git") {
      return yield* fail("Could not find git repository. Please run this command from a git repository.")
    }

    const git = yield* Git.Service
    const worktree = ctx.worktree

    const prNumber = args.number
    const localBranchName = `pr/${prNumber}`
    const cli = cliCommand() // kilocode_change
    UI.println(`Fetching and checking out PR #${prNumber}...`)

    const checkout = yield* Effect.promise(() =>
      Process.run(["gh", "pr", "checkout", `${prNumber}`, "--branch", localBranchName, "--force"], { nothrow: true }),
    )
    if (checkout.code !== 0) {
      return yield* fail(`Failed to checkout PR #${prNumber}. Make sure you have gh CLI installed and authenticated.`)
    }

    const prInfoResult = yield* Effect.promise(() =>
      Process.text(
        [
          "gh",
          "pr",
          "view",
          `${prNumber}`,
          "--json",
          "headRepository,headRepositoryOwner,isCrossRepository,headRefName,body",
        ],
        { nothrow: true },
      ),
    )

    let sessionId: string | undefined

    if (prInfoResult.code === 0 && prInfoResult.text.trim()) {
      const prInfo = JSON.parse(prInfoResult.text)

      if (prInfo?.isCrossRepository && prInfo.headRepository && prInfo.headRepositoryOwner) {
        const forkOwner = prInfo.headRepositoryOwner.login
        const forkName = prInfo.headRepository.name
        const remoteName = forkOwner

        const remotes = (yield* git.run(["remote"], { cwd: worktree })).text().trim()
        if (!remotes.split("\n").includes(remoteName)) {
          yield* git.run(["remote", "add", remoteName, `https://github.com/${forkOwner}/${forkName}.git`], {
            cwd: worktree,
          })
          UI.println(`Added fork remote: ${remoteName}`)
        }

        yield* git.run(["branch", `--set-upstream-to=${remoteName}/${prInfo.headRefName}`, localBranchName], {
          cwd: worktree,
        })
      }

      if (prInfo?.body) {
        const sessionMatch = prInfo.body.match(/https:\/\/app\.kilo\.ai\/s\/([a-zA-Z0-9_-]+)/) // kilocode_change
        if (sessionMatch) {
          const sessionUrl = sessionMatch[0]
          // kilocode_change start
          UI.println(`Found session: ${sessionUrl}`)
          UI.println(`Importing session...`)

          const importResult = yield* Effect.promise(() =>
            Process.text([...cli, "import", sessionUrl], { nothrow: true }),
          )
          // kilocode_change end
          if (importResult.code === 0) {
            const sessionIdMatch = importResult.text.trim().match(/Imported session: ([a-zA-Z0-9_-]+)/)
            if (sessionIdMatch) {
              sessionId = sessionIdMatch[1]
              UI.println(`Session imported: ${sessionId}`)
            }
          }
        }
      }
    }

    UI.println(`Successfully checked out PR #${prNumber} as branch '${localBranchName}'`)
    UI.println()
    UI.println("Starting kilo...") // kilocode_change
    UI.println()

    const run = sessionId ? [...cli, "-s", sessionId] : cli // kilocode_change
    const code = yield* Effect.promise(
      () =>
        Process.spawn(run, {
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
          cwd: process.cwd(),
        }).exited,
    )
    // Match legacy throw semantics — propagate as a defect so the top-level
    // index.ts catch handles it identically (exit 1, "Unexpected error" banner).
    if (code !== 0) return yield* Effect.die(new Error(`kilo exited with code ${code}`)) // kilocode_change
  }),
})

// kilocode_change start - link/unlink/status write and read the manual PR override in Storage
export const PrLinkCommand = effectCmd({
  command: "link <url>",
  describe: "link the current worktree to a pull request",
  builder: (yargs) =>
    yargs.positional("url", {
      type: "string",
      describe: "PR URL to link",
      demandOption: true,
    }),
  handler: Effect.fn("Cli.pr.link")(function* (args) {
    const ctx = yield* InstanceRef
    if (!ctx) return yield* fail("Could not load instance context")

    const link = parsePrUrl(args.url)
    if (!link) return yield* fail(`Invalid PR URL: ${args.url}`)

    yield* Effect.promise(() => writePrLinkOverride(ctx.worktree, link))
    UI.println(`Linked PR #${link.prNumber} (${link.platform})`)
    UI.println(link.prUrl)
  }),
})

export const PrUnlinkCommand = effectCmd({
  command: "unlink",
  describe: "clear the linked pull request",
  handler: Effect.fn("Cli.pr.unlink")(function* () {
    const ctx = yield* InstanceRef
    if (!ctx) return yield* fail("Could not load instance context")

    yield* Effect.promise(() => writePrLinkOverride(ctx.worktree, { cleared: true }))
    UI.println("PR link cleared")
  }),
})

export const prStatusHandler = Effect.fn("Cli.pr.status")(function* () {
  const ctx = yield* InstanceRef
  if (!ctx) return yield* fail("Could not load instance context")

  const override = yield* Effect.promise(() => readPrLinkOverride(ctx.worktree))
  if (override && "cleared" in override) {
    UI.println("PR link cleared")
    return
  }
  if (override) {
    UI.println(`Linked PR #${override.prNumber} (${override.platform})`)
    UI.println(override.prUrl)
    return
  }

  const detected = yield* Effect.promise(() => detectPrLink())
  if (detected) {
    UI.println(`Detected PR #${detected.prNumber} (${detected.platform})`)
    UI.println(detected.prUrl)
    return
  }
  UI.println("no PR linked")
})

export const PrStatusCommand = effectCmd({
  command: "status",
  describe: "show the linked pull request",
  handler: prStatusHandler,
})
// kilocode_change end
