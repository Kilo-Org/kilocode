export namespace KiloRetentionTui {
  type Args = { session?: string; continue?: boolean; cloudFork?: boolean }

  // The TUI launcher protects a resumed session before its worker or the
  // daemon can start cleanup. Plain launches do not load the session modules.
  export async function resume(args: Args, cwd: string) {
    if (args.cloudFork || (!args.session && !args.continue)) return
    const { KiloSessionResume } = await import("./resume")
    const id = await KiloSessionResume.local(args, cwd)
    if (!id) return
    args.session = id
    args.continue = false
  }
}
