import { createMemo, createSignal } from "solid-js"
import type { Snapshot } from "../../../client"
import { useConfig } from "../../../context/config"
import { clean, csv, friendly, words } from "../../../shared/utils"

type Coll = Snapshot["overlay"]["collections"][string][number]
type Kind = "formatter" | "lsp"
type RowState = "active" | "connected" | "disabled" | "enabled" | "error" | "idle" | "missing"
type Builtin = {
  id: string
  title?: string
  ext: string[]
  req: string
  note?: string
}

export type ToolRow = Builtin & {
  command: string[]
  custom: boolean
  disabled: boolean
  entry?: Coll
  env: Record<string, string>
  init: Record<string, unknown>
  removable: boolean
  state: RowState
}

const fmts = [
  { id: "air", ext: [".R"], req: "air command available" },
  {
    id: "biome",
    ext: [".js", ".jsx", ".ts", ".tsx", ".html", ".css", ".md", ".json", ".yaml"],
    req: "biome.json(c) config file",
  },
  { id: "cargofmt", ext: [".rs"], req: "cargo fmt command available" },
  { id: "clang-format", ext: [".c", ".cpp", ".h", ".hpp", ".ino"], req: ".clang-format config file" },
  { id: "cljfmt", ext: [".clj", ".cljs", ".cljc", ".edn"], req: "cljfmt command available" },
  { id: "dart", ext: [".dart"], req: "dart command available" },
  { id: "dfmt", ext: [".d"], req: "dfmt command available" },
  { id: "gleam", ext: [".gleam"], req: "gleam command available" },
  { id: "gofmt", ext: [".go"], req: "gofmt command available" },
  { id: "htmlbeautifier", ext: [".erb", ".html.erb"], req: "htmlbeautifier command available" },
  { id: "ktlint", ext: [".kt", ".kts"], req: "ktlint command available" },
  { id: "latexindent", ext: [".tex"], req: "latexindent command available" },
  { id: "mix", ext: [".ex", ".exs", ".eex", ".heex", ".leex", ".neex", ".sface"], req: "mix command available" },
  { id: "nixfmt", ext: [".nix"], req: "nixfmt command available" },
  { id: "ocamlformat", ext: [".ml", ".mli"], req: "ocamlformat command and .ocamlformat config file" },
  { id: "ormolu", ext: [".hs"], req: "ormolu command available" },
  {
    id: "oxfmt",
    ext: [".js", ".jsx", ".ts", ".tsx"],
    req: "oxfmt dependency and experimental flag",
    note: "Experimental",
  },
  { id: "pint", ext: [".php"], req: "laravel/pint dependency in composer.json" },
  {
    id: "prettier",
    ext: [".js", ".jsx", ".ts", ".tsx", ".html", ".css", ".md", ".json", ".yaml"],
    req: "prettier dependency in package.json",
  },
  { id: "rubocop", ext: [".rb", ".rake", ".gemspec", ".ru"], req: "rubocop command available" },
  { id: "ruff", ext: [".py", ".pyi"], req: "ruff command available with config" },
  { id: "rustfmt", ext: [".rs"], req: "rustfmt command available" },
  { id: "shfmt", ext: [".sh", ".bash"], req: "shfmt command available" },
  { id: "standardrb", ext: [".rb", ".rake", ".gemspec", ".ru"], req: "standardrb command available" },
  { id: "terraform", ext: [".tf", ".tfvars"], req: "terraform command available" },
  { id: "uv", ext: [".py", ".pyi"], req: "uv command available" },
  { id: "zig", ext: [".zig", ".zon"], req: "zig command available" },
] satisfies Builtin[]

const servers = [
  { id: "astro", ext: [".astro"], req: "Auto-installs for Astro projects" },
  { id: "bash", ext: [".sh", ".bash", ".zsh", ".ksh"], req: "Auto-installs bash-language-server" },
  {
    id: "biome",
    ext: [".js", ".jsx", ".ts", ".tsx", ".json", ".jsonc", ".css"],
    req: "biome dependency or config available",
  },
  {
    id: "clangd",
    ext: [".c", ".cpp", ".cc", ".cxx", ".c++", ".h", ".hpp", ".hh", ".hxx", ".h++"],
    req: "Auto-installs for C/C++ projects",
  },
  { id: "clojure-lsp", ext: [".clj", ".cljs", ".cljc", ".edn"], req: "clojure-lsp command available" },
  { id: "csharp", title: "C#", ext: [".cs", ".csx"], req: ".NET SDK installed" },
  { id: "dart", ext: [".dart"], req: "dart command available" },
  { id: "deno", ext: [".ts", ".tsx", ".js", ".jsx", ".mjs"], req: "deno command available with deno.json/c" },
  {
    id: "dockerfile",
    title: "Dockerfile",
    ext: ["Dockerfile", ".dockerfile"],
    req: "Docker language server available",
  },
  { id: "elixir-ls", ext: [".ex", ".exs"], req: "elixir command available" },
  {
    id: "eslint",
    title: "ESLint",
    ext: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".vue"],
    req: "eslint dependency in project",
  },
  { id: "fsharp", title: "F#", ext: [".fs", ".fsi", ".fsx", ".fsscript"], req: ".NET SDK installed" },
  { id: "gleam", ext: [".gleam"], req: "gleam command available" },
  { id: "gopls", ext: [".go"], req: "go command available" },
  {
    id: "haskell-language-server",
    title: "HLS",
    ext: [".hs", ".lhs"],
    req: "haskell-language-server-wrapper command available",
  },
  { id: "jdtls", title: "JDTLS", ext: [".java"], req: "Java SDK 21+ installed" },
  { id: "julials", title: "JuliaLS", ext: [".jl"], req: "julia and LanguageServer.jl installed" },
  { id: "kotlin-ls", ext: [".kt", ".kts"], req: "Auto-installs for Kotlin projects" },
  { id: "lua-ls", ext: [".lua"], req: "Auto-installs for Lua projects" },
  { id: "nixd", ext: [".nix"], req: "nixd command available" },
  { id: "ocaml-lsp", ext: [".ml", ".mli"], req: "ocamllsp command available" },
  {
    id: "oxlint",
    ext: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".vue", ".astro", ".svelte"],
    req: "oxlint dependency in project",
  },
  { id: "php intelephense", title: "PHP Intelephense", ext: [".php"], req: "Auto-installs for PHP projects" },
  { id: "prisma", ext: [".prisma"], req: "prisma command available" },
  { id: "pyright", ext: [".py", ".pyi"], req: "pyright dependency installed" },
  { id: "razor", ext: [".razor", ".cshtml"], req: ".NET SDK and VS Code C# extension installed" },
  { id: "ruby-lsp", ext: [".rb", ".rake", ".gemspec", ".ru"], req: "ruby and gem commands available" },
  { id: "rust", ext: [".rs"], req: "rust-analyzer command available" },
  { id: "sourcekit-lsp", ext: [".swift", ".objc", ".objcpp"], req: "swift installed, Xcode on macOS" },
  { id: "svelte", ext: [".svelte"], req: "Auto-installs for Svelte projects" },
  { id: "terraform", ext: [".tf", ".tfvars"], req: "Auto-installs from GitHub releases" },
  { id: "texlab", ext: [".tex"], req: "Auto-installs texlab" },
  { id: "tinymist", ext: [".typ", ".typc"], req: "Auto-installs from GitHub releases" },
  { id: "ty", title: "Ty", ext: [".py", ".pyi"], req: "Experimental Python LSP", note: "Experimental" },
  {
    id: "typescript",
    title: "TypeScript",
    ext: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"],
    req: "typescript dependency in project",
  },
  { id: "vue", ext: [".vue"], req: "Auto-installs for Vue projects" },
  { id: "yaml-ls", title: "YAML LS", ext: [".yaml", ".yml"], req: "Auto-installs Red Hat yaml-language-server" },
  { id: "zls", title: "ZLS", ext: [".zig", ".zon"], req: "zig command available" },
] satisfies Builtin[]

const fmtIDs = new Set(fmts.map((item) => item.id))
const lspIDs = new Set(servers.map((item) => item.id))

function obj(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {}
  return input as Record<string, unknown>
}

function arr(input: unknown) {
  if (!Array.isArray(input)) return []
  return input.filter((item): item is string => typeof item === "string")
}

function map(input: Coll[]) {
  return new Map(input.map((item) => [item.key, item]))
}

function enabled(input: unknown) {
  return input === true || Boolean(input && typeof input === "object")
}

function off(input: Coll | undefined) {
  return obj(input?.value).disabled === true
}

function cmd(input: Coll | undefined) {
  return arr(obj(input?.value).command)
}

function env(input: Coll | undefined, key: "env" | "environment") {
  return Object.fromEntries(
    Object.entries(obj(obj(input?.value)[key])).filter((item): item is [string, string] => typeof item[1] === "string"),
  )
}

function init(input: Coll | undefined) {
  return obj(obj(input?.value).initialization)
}

function ext(input: Builtin, entry: Coll | undefined, live: string[]) {
  const cfg = arr(obj(entry?.value).extensions)
  if (cfg.length) return cfg
  if (live.length) return live
  return input.ext
}

function lines(input: Record<string, string>) {
  return Object.entries(input)
    .map((item) => `${item[0]}=${item[1]}`)
    .join("\n")
}

function json(input: Record<string, unknown>) {
  if (!Object.keys(input).length) return ""
  return JSON.stringify(input, null, 2)
}

function parseEnv(input: string) {
  const all = input.split("\n").map(clean).filter(Boolean)
  const bad = all.find((line) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(line))
  if (bad) return { error: `Invalid environment variable: ${bad}` }
  return {
    value: Object.fromEntries(
      all.map((line) => {
        const index = line.indexOf("=")
        return [line.slice(0, index), line.slice(index + 1)]
      }),
    ),
  }
}

function parseInit(input: string) {
  const raw = clean(input)
  if (!raw) return { value: undefined }
  try {
    const data = JSON.parse(raw) as unknown
    if (!data || typeof data !== "object" || Array.isArray(data))
      return { error: "Initialization must be a JSON object." }
    return { value: data as Record<string, unknown> }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Invalid initialization JSON." }
  }
}

function removable(input: Coll | undefined) {
  return Boolean(input?.editable && !input.inherited)
}

function label(input: Builtin) {
  return input.title ?? friendly(input.id)
}

export function useFormatterSettings() {
  const ctx = useConfig()
  const snap = () => ctx.data()
  const [mode, setMode] = createSignal<Kind | undefined>()
  const [edit, setEdit] = createSignal<ToolRow | undefined>()
  const [name, setName] = createSignal("")
  const [command, setCommand] = createSignal("")
  const [extensions, setExtensions] = createSignal("")
  const [environment, setEnvironment] = createSignal("")
  const [initialization, setInitialization] = createSignal("")
  const [disabled, setDisabled] = createSignal(false)

  const formatter = createMemo(() => snap()?.overlay.collections.formatter ?? [])
  const lsp = createMemo(() => snap()?.overlay.collections.lsp ?? [])
  const fmtOn = createMemo(() => enabled(snap()?.effective.formatter))
  const lspOn = createMemo(() => enabled(snap()?.effective.lsp))
  const fmtEntries = createMemo(() => map(formatter()))
  const lspEntries = createMemo(() => map(lsp()))
  const fmtStatus = createMemo(() => new Map((snap()?.formatter ?? []).map((item) => [item.name, item])))
  const lspStatus = createMemo(() => new Map((snap()?.lsp ?? []).map((item) => [item.id, item])))

  const fmtRows = createMemo(() => {
    const builtin = fmts.map((item): ToolRow => {
      const entry = fmtEntries().get(item.id)
      const live = fmtStatus().get(item.id)
      const state = !fmtOn() || off(entry) ? "disabled" : live?.enabled ? "active" : live ? "missing" : "enabled"
      return {
        ...item,
        command: cmd(entry),
        custom: false,
        disabled: off(entry),
        entry,
        env: env(entry, "environment"),
        ext: ext(item, entry, live?.extensions ?? []),
        init: {},
        removable: removable(entry),
        state,
        title: label(item),
      }
    })
    const custom = formatter()
      .filter((item) => !fmtIDs.has(item.key))
      .map((entry): ToolRow => {
        const value = obj(entry.value)
        const live = fmtStatus().get(entry.key)
        const state =
          !fmtOn() || value.disabled === true ? "disabled" : live?.enabled ? "active" : live ? "missing" : "enabled"
        return {
          id: entry.key,
          title: friendly(entry.key),
          command: cmd(entry),
          custom: true,
          disabled: value.disabled === true,
          entry,
          env: env(entry, "environment"),
          ext: ext({ id: entry.key, ext: [], req: "Custom formatter" }, entry, live?.extensions ?? []),
          init: {},
          removable: removable(entry),
          req: "Custom formatter",
          state,
        }
      })
    return [...builtin, ...custom]
  })

  const lspRows = createMemo(() => {
    const builtin = servers.map((item): ToolRow => {
      const entry = lspEntries().get(item.id)
      const live = lspStatus().get(item.id)
      const state =
        !lspOn() || off(entry) ? "disabled" : live?.status === "error" ? "error" : live ? "connected" : "idle"
      return {
        ...item,
        command: cmd(entry),
        custom: false,
        disabled: off(entry),
        entry,
        env: env(entry, "env"),
        init: init(entry),
        removable: removable(entry),
        state,
        title: label(item),
      }
    })
    const custom = lsp()
      .filter((item) => !lspIDs.has(item.key))
      .map((entry): ToolRow => {
        const value = obj(entry.value)
        const live = lspStatus().get(entry.key)
        const state =
          !lspOn() || value.disabled === true
            ? "disabled"
            : live?.status === "error"
              ? "error"
              : live
                ? "connected"
                : "idle"
        return {
          id: entry.key,
          title: friendly(entry.key),
          command: cmd(entry),
          custom: true,
          disabled: value.disabled === true,
          entry,
          env: env(entry, "env"),
          ext: ext({ id: entry.key, ext: [], req: "Custom LSP server" }, entry, []),
          init: init(entry),
          removable: removable(entry),
          req: "Custom LSP server",
          state,
        }
      })
    return [...builtin, ...custom]
  })

  const customFmt = createMemo(() => fmtRows().filter((item) => item.custom))
  const customLsp = createMemo(() => lspRows().filter((item) => item.custom))
  const builtinFmt = createMemo(() => fmtRows().filter((item) => !item.custom))
  const builtinLsp = createMemo(() => lspRows().filter((item) => !item.custom))
  const locked = createMemo(() => Boolean(edit()))

  function open(kind: Kind, row?: ToolRow) {
    setMode(kind)
    setEdit(row)
    setName(row?.id ?? "")
    setCommand(row?.command.join(" ") ?? "")
    setExtensions(row?.ext.join(", ") ?? "")
    setEnvironment(lines(row?.env ?? {}))
    setInitialization(json(row?.init ?? {}))
    setDisabled(row?.disabled ?? false)
  }

  function close() {
    setMode(undefined)
    setEdit(undefined)
    setName("")
    setCommand("")
    setExtensions("")
    setEnvironment("")
    setInitialization("")
    setDisabled(false)
  }

  function saveFormatter() {
    const key = clean(name())
    const commandList = words(command())
    const extensionList = csv(extensions())
    const parsed = parseEnv(environment())
    if (!key) {
      ctx.fail("Enter a formatter name before saving.")
      return
    }
    if (!edit() && commandList.length === 0) {
      ctx.fail("Enter a formatter command before saving.")
      return
    }
    if (!edit() && extensionList.length === 0) {
      ctx.fail("Enter at least one formatter extension before saving.")
      return
    }
    if (parsed.error) {
      ctx.fail(parsed.error)
      return
    }
    const cfg: { command?: string[]; disabled?: boolean; environment?: Record<string, string>; extensions?: string[] } =
      {}
    if (disabled()) cfg.disabled = true
    if (commandList.length) cfg.command = commandList
    if (extensionList.length) cfg.extensions = extensionList
    if (parsed.value && Object.keys(parsed.value).length) cfg.environment = parsed.value
    ctx.save({ formatter: { [key]: cfg } })
    close()
  }

  function saveLsp() {
    const key = clean(name())
    const commandList = words(command())
    const extensionList = csv(extensions())
    const vars = parseEnv(environment())
    const opts = parseInit(initialization())
    if (!key) {
      ctx.fail("Enter an LSP server name before saving.")
      return
    }
    if (vars.error) {
      ctx.fail(vars.error)
      return
    }
    if (opts.error) {
      ctx.fail(opts.error)
      return
    }
    if (disabled()) {
      ctx.save({ lsp: { [key]: { disabled: true as const } } })
      close()
      return
    }
    if (commandList.length === 0) {
      ctx.fail("Enter an LSP command before saving, or disable the server.")
      return
    }
    if (!edit() && extensionList.length === 0) {
      ctx.fail("Enter at least one extension for a custom LSP server.")
      return
    }
    const cfg: {
      command: string[]
      disabled?: boolean
      env?: Record<string, string>
      extensions?: string[]
      initialization?: Record<string, unknown>
    } = { command: commandList }
    if (extensionList.length) cfg.extensions = extensionList
    if (vars.value && Object.keys(vars.value).length) cfg.env = vars.value
    if (opts.value && Object.keys(opts.value).length) cfg.initialization = opts.value
    ctx.save({ lsp: { [key]: cfg } })
    close()
  }

  function remove(row: ToolRow) {
    const path = row.entry?.path
    if (!path) return
    ctx.unset([path])
  }

  return {
    builtinFmt,
    builtinLsp,
    close,
    command,
    customFmt,
    customLsp,
    ctx,
    disabled,
    enableFmt: () => ctx.save({ formatter: {} }),
    enableLsp: () => ctx.save({ lsp: {} }),
    environment,
    extensions,
    fmtOn,
    initialization,
    locked,
    lspOn,
    mode,
    name,
    open,
    remove,
    saveFormatter,
    saveLsp,
    setCommand,
    setDisabled,
    setEnvironment,
    setExtensions,
    setInitialization,
    setName,
    snap,
    disableFmt: () => ctx.save({ formatter: false }),
    disableLsp: () => ctx.save({ lsp: false }),
  }
}
