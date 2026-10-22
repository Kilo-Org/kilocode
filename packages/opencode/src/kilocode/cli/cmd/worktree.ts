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

const wrapErr = (message: string) => <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.mapError((error) => new CliError({ message: `${message}: ${errorMessage(error)}` })))

// Lazy: this module is imported eagerly by KiloCli.register (see setup.ts), so
// `@/worktree`'s heavier transitive graph (Project, Provider, ...) must not
// load until a handler actually runs, matching tui-worktree.ts's own imports.
// `tryPromise` (not `promise`): a failed dynamic import must flow through each
// call site's own `wrapErr`, not become an unrecoverable defect.
const importWorktree = Effect.tryPromise(() => import("@/worktree"))

const listWorktrees = importWorktree.pipe(
  Effect.flatMap(({ Worktree }) => Worktree.Service.use((svc) => svc.list())),
  wrapErr("Failed to list worktrees"),
)

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
    const directory = await resolveWorktree(args.name, process.cwd()).catch((error) => {
      UI.error(errorMessage(error))
      process.exitCode = 1
    })
    // Prints only the resolved path on stdout (status messages already went
    // to stderr via resolveWorktree's own UI.println calls), so scripts can
    // do e.g. `cd "$(kilo worktree create foo)"`.
    if (directory) console.log(directory)
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
    // Data rows go to stdout (like `kilo session list`'s table/JSON), not
    // UI.println's stderr, so `kilo worktree list | ...` actually captures them.
    for (const w of list) console.log(`${w.name}${w.branch ? ` (${w.branch})` : ""}  ${w.directory}`)
  }),
})

export const WorktreeRemoveCommand = effectCmd({
  command: "remove <name>",
  // Worktree.Service.remove() force-deletes (`git branch -D`) the worktree's
  // branch too, with no way to opt out (matches the TUI workspaces dialog's
  // existing semantics) — make that explicit rather than surprise users.
  describe: "remove a git worktree by name, deleting its branch too",
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
    const removeMsg = `Failed to remove worktree "${args.name}"`
    const { Worktree } = yield* importWorktree.pipe(wrapErr(removeMsg))
    yield* Worktree.Service.use((svc) => svc.remove({ directory: found.directory })).pipe(wrapErr(removeMsg))
    const branchNote = found.branch ? ` and branch "${found.branch}"` : ""
    UI.println(`Removed worktree "${found.name}" at ${found.directory}${branchNote}`)
  }),
})
