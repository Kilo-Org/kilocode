export namespace TestGroup {
  export type Spec = {
    name: string
    mode?: "domain" | "isolated"
    patterns: readonly string[]
  }

  const specs = [
    {
      name: "foundation",
      mode: "domain",
      patterns: [
        "permission-task.test.ts",
        "{account,agent,auth,bun,format,ide,installation,patch,permission,question,reference,suggestion,v2}/**/*.test.{ts,tsx}",
      ],
    },
    {
      name: "foundation-runtime",
      mode: "isolated",
      patterns: ["{background,bus,effect,share,sync}/**/*.test.{ts,tsx}"],
    },
    {
      name: "configuration",
      mode: "isolated",
      patterns: ["{config,plugin,provider}/**/*.test.{ts,tsx}"],
    },
    {
      name: "cli",
      mode: "isolated",
      patterns: ["cli/**/*.test.{ts,tsx}"],
    },
    {
      name: "filesystem",
      mode: "isolated",
      patterns: ["{file,filesystem,fixture,git,image,project,snapshot,storage}/**/*.test.{ts,tsx}"],
    },
    {
      name: "native-process",
      mode: "isolated",
      patterns: ["{lsp,pty,shell}/**/*.test.{ts,tsx}"],
    },
    {
      name: "protocol",
      mode: "isolated",
      patterns: ["{acp,mcp}/**/*.test.{ts,tsx}"],
    },
    {
      name: "server",
      mode: "isolated",
      patterns: ["{control-plane,server}/**/*.test.{ts,tsx}"],
    },
    {
      name: "session",
      mode: "isolated",
      patterns: ["session/**/*.test.{ts,tsx}"],
    },
    {
      name: "tools",
      mode: "isolated",
      patterns: ["{skill,tool,util}/**/*.test.{ts,tsx}"],
    },
    {
      name: "kilo-core",
      mode: "isolated",
      patterns: ["kilocode/*.test.{ts,tsx}"],
    },
    {
      name: "kilo-cli",
      mode: "isolated",
      patterns: ["kilocode/cli/**/*.test.{ts,tsx}"],
    },
    {
      name: "kilo-config",
      mode: "isolated",
      patterns: ["kilocode/{acp,config,installation,permission,provider}/**/*.test.{ts,tsx}"],
    },
    {
      name: "kilo-memory",
      mode: "isolated",
      patterns: ["kilocode/{memory,tool}/**/*.test.{ts,tsx}"],
    },
    {
      name: "kilo-session",
      mode: "isolated",
      patterns: ["kilocode/{session,session-export,sessions}/**/*.test.{ts,tsx}"],
    },
    {
      name: "kilo-runtime",
      mode: "isolated",
      patterns: ["kilocode/{commit-message,sandbox,server,shell,storage}/**/*.test.{ts,tsx}"],
    },
    {
      name: "kilo-product",
      mode: "isolated",
      patterns: ["kilocode/{anaconda-desktop,suggestion,telemetry,util}/**/*.test.{ts,tsx}"],
    },
  ] as const satisfies readonly Spec[]

  export const excluded = new Map([
    ["mcp/oauth-browser.test.ts", "opens a real browser and races other OAuth tests on a fixed callback port"],
  ])

  export function resolve(all: readonly string[], input: readonly Spec[] = specs) {
    const files = all.map((file) => file.replaceAll("\\", "/")).toSorted()
    const groups = input.map((spec) => ({
      name: spec.name,
      mode: spec.mode ?? ("isolated" as const),
      files: files.filter((file) => spec.patterns.some((pattern) => new Bun.Glob(pattern).match(file))),
    }))
    const patterns = input.flatMap((spec) => spec.patterns.map((pattern) => ({ group: spec.name, pattern })))
    const stale = patterns.filter((item) => !files.some((file) => new Bun.Glob(item.pattern).match(file)))
    const assigned = new Map(
      files.map((file) => [file, groups.filter((group) => group.files.includes(file)).map((group) => group.name)]),
    )
    const missing = [...assigned].filter(([, names]) => names.length === 0).map(([file]) => file)
    const duplicate = [...assigned].filter(([, names]) => names.length > 1)
    const names = input.map((spec) => spec.name)
    const repeated = names.filter((name, index) => names.indexOf(name) !== index)
    const empty = groups.filter((group) => group.files.length === 0).map((group) => group.name)
    const errors = [
      stale.length > 0
        ? `Patterns matching no test files:\n${stale.map((item) => `- ${item.group}: ${item.pattern}`).join("\n")}`
        : "",
      missing.length > 0 ? `Unassigned test files:\n${missing.map((file) => `- ${file}`).join("\n")}` : "",
      duplicate.length > 0
        ? `Test files assigned to multiple groups:\n${duplicate.map(([file, found]) => `- ${file}: ${found.join(", ")}`).join("\n")}`
        : "",
      repeated.length > 0 ? `Duplicate group names: ${[...new Set(repeated)].join(", ")}` : "",
      empty.length > 0 ? `Groups matching no test files: ${empty.join(", ")}` : "",
    ].filter(Boolean)

    if (errors.length > 0) return { ok: false as const, error: errors.join("\n") }
    return { ok: true as const, groups }
  }
}
