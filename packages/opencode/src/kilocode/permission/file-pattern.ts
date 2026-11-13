export namespace FilePermission {
  /**
   * Directory that file permission patterns are relative to. Outside git the
   * worktree is "/", so patterns became absolute paths and project rules such
   * as ".local/*.md" only matched after `git init`.
   */
  export function root(instance: { readonly worktree: string; readonly directory: string }): string {
    return instance.worktree === "/" ? instance.directory : instance.worktree
  }
}
