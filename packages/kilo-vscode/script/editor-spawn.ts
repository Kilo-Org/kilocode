import type { SpawnOptionsWithoutStdio } from "node:child_process"

/**
 * Options for the detached editor launch.
 *
 * Keep this argument-array based: a shell re-joins arguments into one command line and
 * breaks paths containing spaces on Windows. `windowsHide` is deliberately omitted —
 * it maps to SW_HIDE and would hide VS Code's own GUI window.
 */
export function editorSpawn(app: string, args: string[], workspace: string, env: NodeJS.ProcessEnv) {
  return {
    command: app,
    args,
    options: {
      cwd: workspace,
      detached: true,
      env,
      stdio: "ignore",
    } satisfies SpawnOptionsWithoutStdio,
  }
}
