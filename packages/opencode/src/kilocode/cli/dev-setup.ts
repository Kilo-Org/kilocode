import path from "path"
import os from "os"
import { existsSync } from "fs"
import { mkdir } from "fs/promises"
import { fileURLToPath } from "url"
import { cmd } from "@/cli/cmd/cmd"
import { UI } from "@/cli/ui"

type Shell = "zsh" | "bash" | "fish" | "powershell"

const MARKER_START = "# >>> kilodev launcher >>>"
const MARKER_END = "# <<< kilodev launcher <<<"

export const DevSetupCommand = cmd({
  command: "dev-setup",
  describe: "install a `kilodev` shell alias for this checkout",
  builder: (y) =>
    y
      .option("shell", {
        type: "string",
        describe: "shell flavor (auto-detected from $SHELL)",
        choices: ["zsh", "bash", "fish", "powershell"] as const,
      })
      .option("rc", {
        type: "string",
        describe: "rc file to modify (auto-detected)",
      })
      .option("yes", {
        type: "boolean",
        alias: "y",
        describe: "skip confirmation",
        default: false,
      })
      .option("print", {
        type: "boolean",
        describe: "just print the snippet, do not modify any file",
        default: false,
      })
      .option("dry-run", {
        type: "boolean",
        describe: "show what would change without writing",
        default: false,
      }),
  handler: async (args) => {
    const repo = await safeDetectRepo()
    if (!repo) return
    const shell = args.shell ? parse(args.shell) : detectShell()
    const snippet = aliasLine(shell, repo)

    if (args.print) {
      process.stdout.write(snippet + "\n")
      return
    }

    const rc = args.rc ? path.resolve(args.rc) : defaultRc(shell)

    // Non-TTY fallback: print instructions so the snippet is pipe-friendly.
    if (!process.stdin.isTTY && !args.yes && !args["dry-run"]) {
      const sh = Style.TEXT_HIGHLIGHT
      const n = Style.TEXT_NORMAL
      const dim = Style.TEXT_DIM
      process.stderr.write(
        [
          `${dim}# non-interactive shell detected${n}`,
          `${dim}# add this line to ${sh}${rc}${n}${dim} manually,${n}`,
          `${dim}# or re-run with ${sh}--yes${n}${dim} to apply automatically:${n}`,
          "",
          snippet,
          "",
        ].join("\n"),
      )
      return
    }

    UI.empty()
    UI.println(`  ${B}Kilo CLI dev launcher setup${N}`)
    UI.empty()
    UI.println(`  ${D}Repo:${N}    ${repo}`)
    UI.println(`  ${D}Shell:${N}   ${shell}${args.shell ? "" : `  ${D}(detected from $SHELL)${N}`}`)
    UI.println(`  ${D}Config:${N}  ${tildify(rc)}`)
    UI.empty()

    const existing = await readMarkerBlock(rc)
    if (existing && existing.line === snippet) {
      UI.println(`  ${S}✓${N} already installed in ${tildify(rc)} — nothing to do`)
      UI.empty()
      UI.println(`  ${D}To remove: edit the file and delete the block marked${N}`)
      UI.println(`  ${D}${MARKER_START} ... ${MARKER_END}${N}`)
      return
    }

    const action = existing ? "update" : "install"
    UI.println(
      `  ${action === "install" ? "This will add" : "This will replace"} one line so ${H}kilodev${N} runs this checkout from any directory:`,
    )
    UI.empty()
    UI.println(`      ${snippet}`)
    UI.empty()

    if (args["dry-run"]) {
      UI.println(`  ${D}(dry run) would ${action} the block above in ${tildify(rc)}${N}`)
      return
    }

    if (!args.yes) {
      const answer = (await UI.input(`  Proceed? [Y/n] `)).toLowerCase()
      if (answer && !["y", "yes"].includes(answer)) {
        UI.println(`  ${D}cancelled${N}`)
        return
      }
    }

    const result = await applyBlock(rc, snippet)
    UI.empty()
    UI.println(`  ${S}✓${N} ${result.created ? "created" : "updated"} ${tildify(rc)}`)
    if (result.backup) UI.println(`  ${S}✓${N} backup at ${tildify(result.backup)}`)
    UI.empty()
    UI.println(`  ${D}Reload your shell to activate:${N}`)
    UI.println(`      ${H}${reloadHint(shell, rc)}${N}`)
  },
})

// Deprecated: kept so `kilo dev-alias` keeps working for scripts/docs.
export const DevAliasCommand = cmd({
  command: "dev-alias [shell]",
  describe: false as const,
  builder: (y) =>
    y.positional("shell", {
      type: "string",
      choices: ["zsh", "bash", "fish", "powershell"] as const,
      default: "zsh",
    }),
  handler: async (args) => {
    const repo = await safeDetectRepo()
    if (!repo) return
    process.stdout.write(aliasLine(parse(args.shell), repo) + "\n")
  },
})

async function safeDetectRepo(): Promise<string | undefined> {
  try {
    return await detectRepo()
  } catch (err) {
    UI.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
    return undefined
  }
}

const { TEXT_HIGHLIGHT: H, TEXT_NORMAL: N, TEXT_DIM: D, TEXT_SUCCESS: S, TEXT_NORMAL_BOLD: B } = UI.Style
const Style = UI.Style

function parse(value: unknown): Shell {
  if (value === "bash") return value
  if (value === "fish") return value
  if (value === "powershell") return value
  return "zsh"
}

function detectShell(): Shell {
  if (process.platform === "win32") return "powershell"
  const sh = path.basename(process.env.SHELL ?? "")
  if (sh === "zsh") return "zsh"
  if (sh === "fish") return "fish"
  if (sh === "bash") return "bash"
  return "zsh"
}

function defaultRc(shell: Shell): string {
  const home = os.homedir()
  if (shell === "zsh") return path.join(home, ".zshrc")
  if (shell === "fish") return path.join(home, ".config", "fish", "config.fish")
  if (shell === "powershell") {
    // PowerShell 7+ uses Documents\PowerShell; Windows PowerShell 5.1 uses
    // Documents\WindowsPowerShell. Prefer whichever profile already exists;
    // on fresh installs, key off the active host via PSModulePath (each
    // PowerShell version prepends its own user module dir on startup) and
    // fall back to WPS when the signal is absent, since WPS ships on every
    // Windows install. On *nix, pwsh users should pass --rc explicitly.
    if (process.platform === "win32") {
      const ps7 = path.join(home, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1")
      const wps = path.join(home, "Documents", "WindowsPowerShell", "Microsoft.PowerShell_profile.ps1")
      if (existsSync(ps7)) return ps7
      if (existsSync(wps)) return wps
      const psmp = process.env.PSMODULEPATH ?? process.env.PSModulePath ?? ""
      const first = (psmp.split(";")[0] ?? "").toLowerCase()
      if (first.includes("\\windowspowershell\\")) return wps
      if (first.includes("\\powershell\\")) return ps7
      return wps
    }
    return path.join(home, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1")
  }
  // bash: prefer .bashrc, fall back to .bash_profile / .profile
  return path.join(home, ".bashrc")
}

function aliasLine(shell: Shell, repo: string): string {
  const sh = path.join(repo, "bin", "kilodev")
  const bat = path.join(repo, "bin", "kilodev.cmd")
  const q = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`
  if (shell === "fish") return `alias kilodev ${q(sh)}`
  if (shell === "powershell") return `function kilodev { & '${bat.replaceAll("'", "''")}' @args }`
  return `alias kilodev=${q(sh)}`
}

function reloadHint(shell: Shell, rc: string): string {
  if (shell === "fish") return `source ${tildify(rc)}`
  if (shell === "powershell") return `. $PROFILE`
  if (shell === "zsh") return `exec zsh`
  return `exec bash`
}

function tildify(p: string): string {
  const home = os.homedir()
  if (p.startsWith(home)) return "~" + p.slice(home.length)
  return p
}

async function readMarkerBlock(rc: string): Promise<{ line: string } | undefined> {
  const file = Bun.file(rc)
  if (!(await file.exists())) return undefined
  const text = await file.text()
  const start = text.indexOf(MARKER_START)
  if (start === -1) return undefined
  const end = text.indexOf(MARKER_END, start)
  if (end === -1) return undefined
  const body = text.slice(start + MARKER_START.length, end).trim()
  return { line: body }
}

async function applyBlock(rc: string, snippet: string): Promise<{ created: boolean; backup?: string }> {
  const file = Bun.file(rc)
  const exists = await file.exists()
  const prev = exists ? await file.text() : ""
  const block = `${MARKER_START}\n${snippet}\n${MARKER_END}\n`

  if (!exists) await mkdir(path.dirname(rc), { recursive: true })
  await Bun.write(rc, replaceOrAppend(prev, block))
  if (!exists) return { created: true }

  const backup = `${rc}.kilodev.bak.${stamp()}`
  await Bun.write(backup, prev)
  return { created: false, backup }
}

function replaceOrAppend(prev: string, block: string): string {
  const start = prev.indexOf(MARKER_START)
  if (start === -1) {
    const sep = prev.length === 0 || prev.endsWith("\n") ? "" : "\n"
    return `${prev}${sep}${prev.length === 0 ? "" : "\n"}${block}`
  }
  const end = prev.indexOf(MARKER_END, start)
  if (end === -1) return `${prev}\n${block}`
  const after = end + MARKER_END.length
  const tail = prev.slice(after).replace(/^\n/, "")
  return prev.slice(0, start) + block + (tail ? tail : "")
}

function stamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

// Walk up from `start` until we find a directory containing
// packages/opencode/package.json. Exported for test coverage.
export async function findRepoFrom(start: string): Promise<string | undefined> {
  let dir = start
  while (true) {
    const candidate = path.join(dir, "packages", "opencode", "package.json")
    if (await Bun.file(candidate).exists()) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

// bunfs single-file executable virtual roots — `import.meta.url` points here,
// which is not a real on-disk path and must be skipped.
function isBunfsPath(p: string): boolean {
  if (p.startsWith("/$bunfs/")) return true
  // Windows bunfs root, e.g. `B:/~BUN/root/...`. Drive letter may be any case.
  if (/^[A-Za-z]:[\\/]~BUN[\\/]/.test(p)) return true
  return false
}

// Exported for test coverage.
export async function detectRepo(): Promise<string> {
  const hint = process.env.KILO_DEV_REPO
  if (hint) return hint

  const candidates: string[] = []

  const meta = (() => {
    try {
      return fileURLToPath(import.meta.url)
    } catch {
      return undefined
    }
  })()
  if (meta && !isBunfsPath(meta)) candidates.push(path.dirname(meta))

  // process.execPath points at the binary itself; walk up from its directory.
  // For a local build it's <repo>/packages/opencode/dist/<target>/bin/kilo, so
  // findRepoFrom eventually hits the repo's packages/opencode/package.json.
  if (process.execPath) candidates.push(path.dirname(process.execPath))
  candidates.push(process.cwd())

  for (const start of candidates) {
    const found = await findRepoFrom(start)
    if (found) return found
  }

  throw new Error(
    "cannot locate kilocode source checkout; set KILO_DEV_REPO=/path/to/kilocode or run ./bin/kilodev dev-setup from the repo",
  )
}
