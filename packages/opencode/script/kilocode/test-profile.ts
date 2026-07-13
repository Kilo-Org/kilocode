export namespace TestProfile {
  // Broad globs keep platform coverage maintainable as tests are added or renamed.
  // Full Linux and Windows runs remain the backstop for platform-neutral behavior.
  const profiles = {
    darwin: {
      description: "Darwin-native process, terminal, filesystem, worktree, and runtime coverage",
      groups: {
        cli: [
          "cli/acp/lifecycle.test.ts",
          "cli/run/run-process.test.ts",
          "cli/serve/*.test.ts",
          "cli/smokes/*.test.ts",
          "cli/tui/{plugin-lifecycle,plugin-loader-entrypoint,thread}.test.ts",
        ],
        config: [
          "config/{config,tui}.test.ts",
          "control-plane/workspace.test.ts",
        ],
        filesystem: [
          "filesystem/*.test.ts",
          "fixture/fixture.test.ts",
          "git/*.test.ts",
          "image/*.test.ts",
          "plugin/{install-concurrency,loader-shared}.test.ts",
          "reference/*.test.ts",
          "snapshot/*.test.ts",
          "tool/{apply_patch,edit,glob,grep,read,recall,registry,repo_clone,repo_overview,shell,skill,truncation,write}.test.ts",
          "util/{filesystem,glob,module,process,which}.test.ts",
        ],
        kilo: [
          "kilocode/{background-process,daemon,diff-full,external-directory-boundary,indexing-worker,indexing-worktree,interactive-terminal,mcp-oauth-callback,primary-worktree,project-id,read-directory,session-diff-restore,snapshot-cache,snapshot-freeze-repro,snapshot-revert-move,snapshot-seed,task-nesting}.test.ts",
          "kilocode/cli/cmd/serve.test.ts",
          "kilocode/cli/install-artifact.test.ts",
          "kilocode/config/config.test.ts",
          "kilocode/core-watcher.test.ts",
          "kilocode/sandbox/*.test.ts",
          "kilocode/server/{config-overlay,listener-runtime,tui-config,worktree-list}.test.ts",
          "kilocode/session-export/{e2e,sequence,worker,workspace-provider}.test.ts",
          "kilocode/session-export/worker/{storage,zstd}.test.ts",
          "kilocode/tool/repo_clone.test.ts",
          "kilocode/worktree*.test.ts",
        ],
        process: ["session/prompt.test.ts"],
        project: ["project/*.test.ts"],
        pty: ["pty/pty-*.test.ts", "server/httpapi-pty.test.ts"],
        server: [
          "server/{experimental-session-list,httpapi-experimental,httpapi-file,httpapi-listen,httpapi-workspace-routing,project-init-git,worktree-endpoint-repro}.test.ts",
        ],
      },
    },
  } as const

  export const names = Object.keys(profiles)

  export function resolve(name: string, all: readonly string[]) {
    const files = all.map((file) => file.replaceAll("\\", "/"))
    const profile = profiles[name as keyof typeof profiles]
    if (!profile) {
      return {
        ok: false as const,
        error: `Unknown test profile "${name}". Available profiles: ${names.join(", ")}`,
      }
    }

    const groups = Object.entries(profile.groups)
    const patterns = groups.flatMap(([, patterns]) => patterns)
    const malformed = patterns.filter(
      (pattern) =>
        pattern.startsWith("/") ||
        pattern.startsWith("test/") ||
        pattern.includes("\\") ||
        pattern.split("/").includes("..") ||
        !/\.test\.(ts|tsx|\{ts,tsx\})$/.test(pattern),
    )
    const seen = new Set<string>()
    const duplicates = patterns.filter((pattern) => {
      if (seen.has(pattern)) return true
      seen.add(pattern)
      return false
    })
    const unsorted = groups
      .filter(([, patterns]) =>
        patterns.some((pattern, index) => index > 0 && patterns[index - 1].localeCompare(pattern) > 0),
      )
      .map(([group]) => group)
    const globs = patterns.map((pattern) => ({ pattern, glob: new Bun.Glob(pattern) }))
    const unmatched = globs.filter((item) => !files.some((file) => item.glob.match(file))).map((item) => item.pattern)
    const errors = [
      malformed.length > 0 ? `Malformed patterns: ${malformed.join(", ")}` : "",
      duplicates.length > 0 ? `Duplicate patterns: ${duplicates.join(", ")}` : "",
      unmatched.length > 0 ? `Unmatched patterns: ${unmatched.join(", ")}` : "",
      unsorted.length > 0 ? `Unsorted groups: ${unsorted.join(", ")}` : "",
      patterns.length === 0 ? "Profile contains no patterns" : "",
    ].filter(Boolean)

    if (errors.length > 0) {
      return {
        ok: false as const,
        error: `Invalid test profile "${name}":\n${errors.map((error) => `- ${error}`).join("\n")}`,
      }
    }

    return {
      ok: true as const,
      description: profile.description,
      files: files.filter((file) => globs.some((item) => item.glob.match(file))),
    }
  }
}
