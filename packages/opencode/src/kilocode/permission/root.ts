import path from "path"

export namespace PermissionRoot {
  export function of(input: { worktree: string; directory: string }) {
    return input.worktree === "/" ? input.directory : input.worktree
  }

  export function relative(input: { worktree: string; directory: string }, target: string) {
    return path.relative(of(input), target)
  }
}
