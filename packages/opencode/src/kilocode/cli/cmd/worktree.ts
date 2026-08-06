// kilocode_change - new file
// `kilo worktree list`/`remove`: CLI-side counterpart to `kilo --worktree <name>`
// (tui-worktree.ts) and the TUI's `/worktree` alias for the workspaces dialog
// (packages/tui/src/app.tsx). All three go through the same `Worktree.Service`.
import path from "path"
import { Effect } from "effect"
import { cmd } from "@/cli/cmd/cmd"
import { CliError, effectCmd, fail } from "@/cli/effect-cmd"
import { UI } from "@/cli/ui"
import { errorMessage } from "@/util/error"
import { slugify } from "@/kilocode/cli/cmd/tui-worktree"
import { Worktree } from "@/worktree"

const wrapErr = (message: string) => <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.mapError((error) => new CliError({ message: `${message}: ${errorMessage(error)}` })))

const listWorktrees = Worktree.Service.use((svc) => svc.list()).pipe(wrapErr("Failed to list worktrees"))

export const WorktreeCommand = cmd({
  command: "worktree",
  describe: "manage git worktrees",
  builder: (yargs) =>
    yargs.command(WorktreeCreateCommand).command(WorktreeListCommand).command(WorktreeRemoveCommand).demandCommand(),
  async handler() {},
})

export const WorktreeCreateCommand = cmd({
  command: "create <name>",
  describe: "create (or reuse) a git worktree by name",
  builder: (yargs) => yargs.positional("name", { type: "string", demandOption: true }),
  async handler(args) {
    // Plain cmd(), not effectCmd(): resolveWorktree loads/disposes its own
    // instance context (it's shared with `kilo --worktree`'s pre-TUI-launch
    // path in tui-worktree.ts), so it can't run inside effectCmd's own.
    const { resolveWorktree } = await import("@/kilocode/cli/cmd/tui-worktree")
    await resolveWorktree(args.name, process.cwd()).catch((error) => {
      UI.error(errorMessage(error))
      process.exitCode = 1
    })
  },
})

export const WorktreeListCommand = effectCmd({
  command: "list",
  describe: "list git worktrees for the current project",
  handler: Effect.fn("Cli.worktree.list")(function* () {
    const list = yield* listWorktrees
    if (!list.length) {
      UI.println("No worktrees found.")
      return
    }
    for (const w of list) UI.println(`${w.name}${w.branch ? ` (${w.branch})` : ""}  ${w.directory}`)
  }),
})

export const WorktreeRemoveCommand = effectCmd({
  command: "remove <name>",
  describe: "remove a git worktree by name",
  builder: (yargs) => yargs.positional("name", { type: "string", demandOption: true }),
  handler: Effect.fn("Cli.worktree.remove")(function* (args) {
    const slug = slugify(args.name)
    if (!slug) {
      yield* fail(`Invalid worktree name "${args.name}"`)
      return
    }
    const list = yield* listWorktrees
    // Matches the reuse logic in tui-worktree.ts: list() remaps `name` to the
    // project ID when a worktree's basename collides with the primary
    // checkout's, so also match on the directory basename.
    const found = list.find((w) => w.name.toLowerCase() === slug || path.basename(w.directory).toLowerCase() === slug)
    if (!found) {
      yield* fail(`No worktree named "${args.name}" found.`)
      return
    }
    yield* Worktree.Service.use((svc) => svc.remove({ directory: found.directory })).pipe(
      wrapErr(`Failed to remove worktree "${args.name}"`),
    )
    UI.println(`Removed worktree "${found.name}" at ${found.directory}`)
  }),
})
