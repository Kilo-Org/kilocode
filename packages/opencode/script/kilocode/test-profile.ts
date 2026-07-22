export namespace TestProfile {
  // Broad globs keep platform coverage maintainable as tests are added or renamed.
  // Full Linux and Windows runs remain the backstop for platform-neutral behavior.
  const profiles = {
    darwin: {
      // Only tests whose failure would indicate a macOS-specific problem belong
      // here: the seatbelt sandbox, node-pty, FSEvents watching, process/terminal
      // spawning, and the darwin runtime artifact. Platform-neutral application
      // logic (session loops, snapshots, HTTP routing, config, worktrees) is
      // covered by the full Linux and Windows suites and must stay out — every
      // file in this profile costs ~3x its Linux duration on the macos-15 runner.
      description: "Darwin seatbelt sandbox, PTY, filesystem, and process runtime coverage",
      groups: {
        filesystem: [
          "filesystem/*.test.ts",
          "kilocode/{external-directory-boundary,read-directory}.test.ts",
          "util/filesystem.test.ts",
        ],
        pty: ["server/httpapi-pty.test.ts", "server/httpapi-v2-pty.test.ts"],
        runtime: [
          "cli/serve/*.test.ts",
          "kilocode/background-process.test.ts",
          "kilocode/cli/install-artifact.test.ts",
          "kilocode/core-watcher.test.ts",
          "kilocode/interactive-terminal.test.ts",
          "tool/shell.test.ts",
          "util/{process,which}.test.ts",
        ],
        sandbox: ["kilocode/sandbox/*.test.ts"],
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
