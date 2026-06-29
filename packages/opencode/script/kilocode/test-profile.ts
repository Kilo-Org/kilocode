export namespace TestProfile {
  // Broad globs keep platform coverage maintainable as tests are added or renamed.
  // Full macOS runs on main remain the backstop for tests outside these areas.
  const profiles = {
    darwin: {
      description: "Darwin-native process, terminal, filesystem, worktree, and runtime coverage",
      groups: {
        cli: [
          "cli/acp/*.test.ts",
          "cli/run/{footer.view,run-process,scrollback.surface}.test.{ts,tsx}",
          "cli/serve/*.test.ts",
          "cli/smokes/*.test.ts",
          "cli/tui/{app-lifecycle,dialog-prompt,diff-viewer-file-tree,diff-viewer,inline-tool-wrap-snapshot,keymap,plugin-loader-entrypoint,slot-replace,thread,use-event}.test.{ts,tsx}",
        ],
        filesystem: [
          "file/{index,path-traversal,ripgrep}.test.ts",
          "git/*.test.ts",
          "image/*.test.ts",
          "plugin/{install-concurrency,loader-shared}.test.ts",
          "reference/*.test.ts",
          "snapshot/*.test.ts",
          "tool/{external-directory,glob,grep,read,repo_clone,repo_overview,shell}.test.ts",
          "util/{filesystem,module,process,which}.test.ts",
        ],
        kilo: [
          "kilocode/{background-process,bin-tree-sitter-env,daemon,external-directory-boundary,indexing-worker,indexing-worktree,mcp-oauth-callback,primary-worktree,snapshot-freeze-repro,snapshot-revert-move,snapshot-seed}.test.ts",
          "kilocode/cli/install-artifact.test.ts",
          "kilocode/sandbox/*.test.ts",
          "kilocode/server/{listener-runtime,worktree-list}.test.ts",
          "kilocode/session-export/{e2e,sequence,worker,workspace-provider}.test.ts",
          "kilocode/session-export/worker/{storage,zstd}.test.ts",
          "kilocode/sessions/*.test.ts",
          "kilocode/worktree*.test.ts",
        ],
        process: ["provider/header-timeout.test.ts", "session/{prompt,retry}.test.ts", "shell/*.test.ts"],
        project: ["project/*.test.ts"],
        pty: ["pty/pty-*.test.ts", "server/httpapi-pty*.test.ts"],
        server: [
          "server/{httpapi-compression,httpapi-experimental,httpapi-file,httpapi-listen,httpapi-workspace-routing,project-init-git,workspace-proxy,worktree-endpoint-repro}.test.ts",
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
