import { UI } from "../ui"
import { cmd } from "./cmd"
import { AppRuntime } from "@/effect/app-runtime"
import { Git } from "@/git"
import { Instance } from "@/project/instance"
import { Process } from "@/util"
import { existsSync } from "node:fs" // kilocode_change

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
  command: `${subcommand} <number>`, // kilocode_change
  describe: "fetch and checkout a GitHub PR branch, then run kilo", // kilocode_change
  builder: (yargs) =>
    yargs.positional("number", {
      type: "number",
      describe: "PR number to checkout",
      demandOption: true,
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const project = Instance.project
        if (project.vcs !== "git") {
          UI.error("Could not find git repository. Please run this command from a git repository.")
          process.exit(1)
        }

        const prNumber = args.number
        const localBranchName = `pr/${prNumber}`
        const cli = cliCommand() // kilocode_change
        UI.println(`Fetching and checking out PR #${prNumber}...`)

        // Use gh pr checkout with custom branch name
        const result = await Process.run(
          ["gh", "pr", "checkout", `${prNumber}`, "--branch", localBranchName, "--force"],
          {
            nothrow: true,
          },
        )

        if (result.code !== 0) {
          UI.error(`Failed to checkout PR #${prNumber}. Make sure you have gh CLI installed and authenticated.`)
          process.exit(1)
        }

        // Fetch PR info for fork handling and session link detection
        const prInfoResult = await Process.text(
          [
            "gh",
            "pr",
            "view",
            `${prNumber}`,
            "--json",
            "headRepository,headRepositoryOwner,isCrossRepository,headRefName,body",
          ],
          { nothrow: true },
        )

        let sessionId: string | undefined

        if (prInfoResult.code === 0) {
          const prInfoText = prInfoResult.text
          if (prInfoText.trim()) {
            const prInfo = JSON.parse(prInfoText)

            // Handle fork PRs
            if (prInfo && prInfo.isCrossRepository && prInfo.headRepository && prInfo.headRepositoryOwner) {
              const forkOwner = prInfo.headRepositoryOwner.login
              const forkName = prInfo.headRepository.name
              const remoteName = forkOwner

              // Check if remote already exists
              const remotes = await AppRuntime.runPromise(
                Git.Service.use((git) => git.run(["remote"], { cwd: Instance.worktree })),
              ).then((x) => x.text().trim())
              if (!remotes.split("\n").includes(remoteName)) {
                await AppRuntime.runPromise(
                  Git.Service.use((git) =>
                    git.run(["remote", "add", remoteName, `https://github.com/${forkOwner}/${forkName}.git`], {
                      cwd: Instance.worktree,
                    }),
                  ),
                )
                UI.println(`Added fork remote: ${remoteName}`)
              }

              // Set upstream to the fork so pushes go there
              const headRefName = prInfo.headRefName
              await AppRuntime.runPromise(
                Git.Service.use((git) =>
                  git.run(["branch", `--set-upstream-to=${remoteName}/${headRefName}`, localBranchName], {
                    cwd: Instance.worktree,
                  }),
                ),
              )
            }

            // Check for opencode session link in PR body
            if (prInfo && prInfo.body) {
              const sessionMatch = prInfo.body.match(/https:\/\/app\.kilo\.ai\/s\/([a-zA-Z0-9_-]+)/)
              if (sessionMatch) {
                const sessionUrl = sessionMatch[0]
                // kilocode_change start
                UI.println(`Found session: ${sessionUrl}`)
                UI.println(`Importing session...`)

                const importResult = await Process.text([...cli, "import", sessionUrl], { nothrow: true })
                // kilocode_change end
                if (importResult.code === 0) {
                  const importOutput = importResult.text.trim()
                  // Extract session ID from the output (format: "Imported session: <session-id>")
                  const sessionIdMatch = importOutput.match(/Imported session: ([a-zA-Z0-9_-]+)/)
                  if (sessionIdMatch) {
                    sessionId = sessionIdMatch[1]
                    UI.println(`Session imported: ${sessionId}`)
                  }
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
        // kilocode_change start
        const opencodeProcess = Process.spawn(run, {
          // kilocode_change end
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
          cwd: process.cwd(),
        })
        const code = await opencodeProcess.exited
        if (code !== 0) throw new Error(`kilo exited with code ${code}`) // kilocode_change
      },
    })
  },
})
