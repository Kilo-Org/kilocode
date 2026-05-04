# Upstream Manual Merge Decisions

Generated: 2026-05-04T13:30:57.204Z
Updated: 2026-05-04T14:02:20.278Z

## Summary

- Version: 1.14.30
- Upstream Commit: `eb4219304358`
- Base Branch: mark/upstream-manual-decisions
- Merge Branch: markijbema/kilo-opencode-v1.14.30
- Automation Report: `upstream-merge-report-1.14.30.md`
- Manual Files: 13
- Complete Decisions: 13/13
- High Risk Decisions: 0

## Decisions By Type

- hybrid: 7
- take-ours: 4
- take-theirs: 2
- regenerated: 0
- removed: 0
- renamed: 0
- other: 0

## File Decisions

### packages/opencode/script/publish.ts

- Conflict: UU (content)
- Recommendation: manual - Script file has kilocode_change markers — auto-transform skipped, needs manual review
- Base Hash: `ac43c5e38eb3`
- Ours Hash: `4972708672a6`
- Theirs Hash: `68ec3c741823`
<details><summary>Original diff3 conflict</summary>

```diff
<<<<<<< HEAD
const image = "ghcr.io/kilo-org/kilocode" // kilocode_change
||||||| c00058ed7a
const image = "ghcr.io/anomalyco/opencode" // kilocode_change
=======
const image = "ghcr.io/Kilo-Org/kilocode" // kilocode_change
>>>>>>> markijbema/opencode-v1.14.30

<<<<<<< HEAD
    `  homepage "https://kilo.ai"`, // kilocode_change
||||||| c00058ed7a
    `  homepage "https://github.com/anomalyco/opencode"`,
=======
    `  homepage "https://github.com/Kilo-Org/kilocode"`,
>>>>>>> markijbema/opencode-v1.14.30
```

</details>

- Decision: take-ours
- Risk: low
- Summary: Keep Kilo Docker image repo and homepage
- Rationale: Upstream's kilocode_change-marked ghcr.io/Kilo-Org/kilocode and GitHub-repo homepage replace our intentional Kilo branding (lowercase ghcr repo + https://kilo.ai). Keeping ours preserves the canonical Kilo publish artifacts.
- Alternatives: take-theirs would swap the Docker repo to mixed-case and point homebrew homepage at the GitHub repo — both regress Kilo branding
- Verification: bun run typecheck
- Resolution Hash: `4972708672a6`
<details><summary>Resolved content</summary>

```diff
#!/usr/bin/env bun
import { $ } from "bun"
import pkg from "../package.json"
import { Script } from "@opencode-ai/script"
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

async function published(name: string, version: string) {
  return (await $`npm view ${name}@${version} version`.nothrow()).exitCode === 0
}

async function publish(dir: string, name: string, version: string) {
  // GitHub artifact downloads can drop the executable bit, and Docker uses the
  // unpacked dist binaries directly rather than the published tarball.
  if (process.platform !== "win32") await $`chmod -R 755 .`.cwd(dir)
  if (await published(name, version)) {
    console.log(`already published ${name}@${version}`)
    return
  }
  await $`bun pm pack`.cwd(dir)
  await $`npm publish *.tgz --access public --tag ${Script.channel} --provenance`.cwd(dir) // kilocode_change
}

const binaries: Record<string, string> = {}
// kilocode_change start
for (const filepath of new Bun.Glob("*/*/package.json").scanSync({ cwd: "./dist" })) {
  // kilocode_change end
  const pkg = await Bun.file(`./dist/${filepath}`).json()
  binaries[pkg.name] = pkg.version
}
console.log("binaries", binaries)
const version = Object.values(binaries)[0]

await $`mkdir -p ./dist/${pkg.name}`
await $`cp -r ./bin ./dist/${pkg.name}/bin`
await $`cp ./script/postinstall.mjs ./dist/${pkg.name}/postinstall.mjs`
await Bun.file(`./dist/${pkg.name}/LICENSE`).write(await Bun.file("../../LICENSE").text())
await Bun.file(`./dist/${pkg.name}/README.md`).write(await Bun.file("./README.md").text()) // kilocode_change

await Bun.file(`./dist/${pkg.name}/package.json`).write(
  JSON.stringify(
    {
      name: pkg.name, // kilocode_change
      bin: {
        // kilocode_change start
        kilo: `./bin/kilo`,
        kilocode: `./bin/kilo`,
        // kilocode_change end
      },
      scripts: {
        postinstall: "bun ./postinstall.mjs || node ./postinstall.mjs",
      },
      version: version,
      license: pkg.license,
      optionalDependencies: binaries,
      // kilocode_change start
      repository: {
        type: "git",
        url: "https://github.com/Kilo-Org/kilocode",
      },
      // kilocode_change end
    },
    null,
    2,
  ),
)

const tasks = Object.entries(binaries).map(async ([name]) => {
  await publish(`./dist/${name}`, name, binaries[name])
})
await Promise.all(tasks)
await publish(`./dist/${pkg.name}`, pkg.name, version) // kilocode_change

const image = "ghcr.io/kilo-org/kilocode" // kilocode_change
const platforms = "linux/amd64,linux/arm64"
const tags = [`${image}:${version}`, `${image}:${Script.channel}`]
const tagFlags = tags.flatMap((t) => ["-t", t])

// registries
if (!Script.preview) {
  await $`docker buildx build --platform ${platforms} ${tagFlags} --push .`
  // Calculate SHA values
  const arm64Sha = await $`sha256sum ./dist/kilo-linux-arm64.tar.gz | cut -d' ' -f1`.text().then((x) => x.trim())
  const x64Sha = await $`sha256sum ./dist/kilo-linux-x64.tar.gz | cut -d' ' -f1`.text().then((x) => x.trim())
  const macX64Sha = await $`sha256sum ./dist/kilo-darwin-x64.zip | cut -d' ' -f1`.text().then((x) => x.trim())
  const macArm64Sha = await $`sha256sum ./dist/kilo-darwin-arm64.zip | cut -d' ' -f1`.text().then((x) => x.trim())

  const [pkgver, _subver = ""] = Script.version.split(/(-.*)/, 2)

  // arch
  const binaryPkgbuild = [
    "# Maintainer: kilo", // kilocode_change
    "",
    "pkgname='kilo-bin'",
    `pkgver=${pkgver}`,
    `_subver=${_subver}`,
    "options=('!debug' '!strip')",
    "pkgrel=1",
    "pkgdesc='The AI coding agent built for the terminal.'",
    "url='https://github.com/Kilo-Org/kilocode'",
    "arch=('aarch64' 'x86_64')",
    "license=('MIT')",
    "provides=('kilo')",
    "conflicts=('kilo')",
    "depends=('ripgrep')",
    "",
    `source_aarch64=("\${pkgname}_\${pkgver}_aarch64.tar.gz::https://github.com/Kilo-Org/kilocode/releases/download/v\${pkgver}\${_subver}/kilo-linux-arm64.tar.gz")`,
    `sha256sums_aarch64=('${arm64Sha}')`,

    `source_x86_64=("\${pkgname}_\${pkgver}_x86_64.tar.gz::https://github.com/Kilo-Org/kilocode/releases/download/v\${pkgver}\${_subver}/kilo-linux-x64.tar.gz")`,
    `sha256sums_x86_64=('${x64Sha}')`,
    "",
    "package() {",
    '  install -Dm755 ./kilo "${pkgdir}/usr/bin/kilo"',
    "}",
    "",
  ].join("\n")

  for (const [pkg, pkgbuild] of [["kilo-bin", binaryPkgbuild]]) {
    for (let i = 0; i < 30; i++) {
      try {
        await $`rm -rf ./dist/aur-${pkg}`
        await $`git clone ssh://aur@aur.archlinux.org/${pkg}.git ./dist/aur-${pkg}`
        await $`cd ./dist/aur-${pkg} && git checkout master`
        await Bun.file(`./dist/aur-${pkg}/PKGBUILD`).write(pkgbuild)
        await $`cd ./dist/aur-${pkg} && makepkg --printsrcinfo > .SRCINFO`
        await $`cd ./dist/aur-${pkg} && git add PKGBUILD .SRCINFO`
        if ((await $`cd ./dist/aur-${pkg} && git diff --cached --quiet`.nothrow()).exitCode === 0) break
        await $`cd ./dist/aur-${pkg} && git commit -m "Update to v${Script.version}"`
        await $`cd ./dist/aur-${pkg} && git push`
        break
      } catch {
        continue
      }
    }
  }

  // Homebrew formula
  const homebrewFormula = [
    "# typed: false",
    "# frozen_string_literal: true",
    "",
    "# This file was generated by GoReleaser. DO NOT EDIT.",
    "class Kilo < Formula", // kilocode_change
    `  desc "The AI coding agent built for the terminal."`,
    `  homepage "https://kilo.ai"`, // kilocode_change
    `  version "${Script.version.split("-")[0]}"`,
    "",
    `  depends_on "ripgrep"`,
    "",
    "  on_macos do",
    "    if Hardware::CPU.intel?",
    `      url "https://github.com/Kilo-Org/kilocode/releases/download/v${Script.version}/kilo-darwin-x64.zip"`,
    `      sha256 "${macX64Sha}"`,
    "",
    "      def install",
    '        bin.install "kilo"',
    "      end",
    "    end",
    "    if Hardware::CPU.arm?",
    `      url "https://github.com/Kilo-Org/kilocode/releases/download/v${Script.version}/kilo-darwin-arm64.zip"`,
    `      sha256 "${macArm64Sha}"`,
    "",
    "      def install",
    '        bin.install "kilo"',
    "      end",
    "    end",
    "  end",
    "",
    "  on_linux do",
    "    if Hardware::CPU.intel? and Hardware::CPU.is_64_bit?",
    `      url "https://github.com/Kilo-Org/kilocode/releases/download/v${Script.version}/kilo-linux-x64.tar.gz"`,
    `      sha256 "${x64Sha}"`,
    "      def install",
    '        bin.install "kilo"',
    "      end",
    "    end",
    "    if Hardware::CPU.arm? and Hardware::CPU.is_64_bit?",
    `      url "https://github.com/Kilo-Org/kilocode/releases/download/v${Script.version}/kilo-linux-arm64.tar.gz"`,
    `      sha256 "${arm64Sha}"`,
    "      def install",
    '        bin.install "kilo"',
    "      end",
    "    end",
    "  end",
    "end",
    "",
    "",
  ].join("\n")

  const token = process.env.GITHUB_TOKEN
  if (!token) {
    console.error("GITHUB_TOKEN is required to update homebrew tap")
    process.exit(1)
  }
  const tap = `https://x-access-token:${token}@github.com/Kilo-Org/homebrew-tap.git` // kilocode_change
  await $`rm -rf ./dist/homebrew-tap`
  await $`git clone ${tap} ./dist/homebrew-tap`
  await Bun.file("./dist/homebrew-tap/kilo.rb").write(homebrewFormula) // kilocode_change
  await $`cd ./dist/homebrew-tap && git add kilo.rb` // kilocode_change
  if ((await $`cd ./dist/homebrew-tap && git diff --cached --quiet`.nothrow()).exitCode !== 0) {
    await $`cd ./dist/homebrew-tap && git commit -m "Update to v${Script.version}"`
    await $`cd ./dist/homebrew-tap && git push`
  }
}
```

</details>


### packages/opencode/src/cli/cmd/tui/component/dialog-session-list.tsx

- Conflict: UU (content)
- Recommendation: manual - Code files need manual review for kilocode_change markers
- Base Hash: `fb2462437040`
- Ours Hash: `4f18b253ccfb`
- Theirs Hash: `160f4f88dc53`
<details><summary>Original diff3 conflict</summary>

```diff
<<<<<<< HEAD
  // kilocode_change start - always fetch from experimental endpoint (returns GlobalSession with worktree info)
  const [searchResults, searchActions] = createResource(
    () => search(),
    async (query) => {
      const result = await sdk.client.experimental.session.list(
        {
          search: query || undefined,
          roots: true,
          worktrees: true,
          limit: 30,
        },
        { throwOnError: true },
      )
      return result.data ?? []
    },
  )
  // kilocode_change end
||||||| c00058ed7a
  const [searchResults, { refetch }] = createResource(search, async (query) => {
    if (!query) return undefined
    const result = await sdk.client.session.list({ search: query, limit: 30 })
    return result.data ?? []
  })
=======
  const [searchResults, { refetch }] = createResource(
    () => ({ query: search(), filter: sync.session.query() }),
    async (input) => {
      if (!input.query) return undefined
      const result = await sdk.client.session.list({ search: input.query, limit: 30, ...input.filter })
      return result.data ?? []
    },
  )
>>>>>>> markijbema/opencode-v1.14.30
```

</details>

- Decision: take-ours
- Risk: medium
- Summary: Keep Kilo's experimental session list
- Rationale: Our session dialog calls sdk.client.experimental.session.list with roots/worktrees to drive global cross-worktree filtering and uses searchActions.refetch() throughout the component. Upstream switched to sdk.client.session.list plus sync.session.query() filtering, which discards the experimental/global API Kilo relies on. Preserving ours keeps the multi-worktree session switcher working.
- Alternatives: take-theirs would drop the experimental API and break the always-global session list; the per-sync filter has no equivalent path in our flow
- Verification: bun run typecheck
- Resolution Hash: `4f18b253ccfb`
<details><summary>Resolved content</summary>

```diff
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { createMemo, createResource, createSignal, onMount } from "solid-js"
import { Locale } from "@/util/locale"
import { useProject } from "@tui/context/project"
import { useKeybind } from "../context/keybind"
import { useTheme } from "../context/theme"
import { useSDK } from "../context/sdk"
import { Flag } from "@opencode-ai/core/flag/flag"
import { DialogSessionRename } from "./dialog-session-rename"
import { Keybind } from "@/util/keybind"
import { createDebouncedSignal } from "../util/signal"
import { useToast } from "../ui/toast"
import { DialogWorkspaceCreate, openWorkspaceSession, restoreWorkspaceSession } from "./dialog-workspace-create"
import { Spinner } from "./spinner"
import path from "path" // kilocode_change
import { errorMessage } from "@/util/error"
import { DialogSessionDeleteFailed } from "./dialog-session-delete-failed"

type WorkspaceStatus = "connected" | "connecting" | "disconnected" | "error"

export function DialogSessionList() {
  const dialog = useDialog()
  const route = useRoute()
  const sync = useSync()
  const project = useProject()
  const keybind = useKeybind()
  const { theme } = useTheme()
  const sdk = useSDK()
  const toast = useToast()
  const [toDelete, setToDelete] = createSignal<string>()
  const [search, setSearch] = createDebouncedSignal("", 150)
  const [global, setGlobal] = createSignal(true) // kilocode_change - show all worktrees by default

  // kilocode_change start - always fetch from experimental endpoint (returns GlobalSession with worktree info)
  const [searchResults, searchActions] = createResource(
    () => search(),
    async (query) => {
      const result = await sdk.client.experimental.session.list(
        {
          search: query || undefined,
          roots: true,
          worktrees: true,
          limit: 30,
        },
        { throwOnError: true },
      )
      return result.data ?? []
    },
  )
  // kilocode_change end

  const currentSessionID = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))

  // kilocode_change start - client-side worktree filtering when global is off
  const sessions = createMemo(() => {
    const all = searchResults() ?? []
    if (global()) return all
    const root = project.instance.path().worktree
    if (!root || root === "/") return all
    return all.filter((s) => s.directory === root || s.directory.startsWith(root + path.sep))
  })
  // kilocode_change end

  function createWorkspace() {
    dialog.replace(() => (
      <DialogWorkspaceCreate
        onSelect={(workspaceID) =>
          openWorkspaceSession({
            dialog,
            route,
            sdk,
            sync,
            toast,
            workspaceID,
          })
        }
      />
    ))
  }

  function recover(session: NonNullable<ReturnType<typeof sessions>[number]>) {
    const workspace = project.workspace.get(session.workspaceID!)
    const list = () => dialog.replace(() => <DialogSessionList />)
    dialog.replace(() => (
      <DialogSessionDeleteFailed
        session={session.title}
        workspace={workspace?.name ?? session.workspaceID!}
        onDone={list}
        onDelete={async () => {
          const current = currentSessionID()
          const info = current ? sync.data.session.find((item) => item.id === current) : undefined
          const result = await sdk.client.experimental.workspace.remove({ id: session.workspaceID! })
          if (result.error) {
            toast.show({
              variant: "error",
              title: "Failed to delete workspace",
              message: errorMessage(result.error),
            })
            return false
          }
          await project.workspace.sync()
          await sync.session.refresh()
          if (search()) await searchActions.refetch() // kilocode_change - use createResource actions
          if (info?.workspaceID === session.workspaceID) {
            route.navigate({ type: "home" })
          }
          return true
        }}
        onRestore={() => {
          dialog.replace(() => (
            <DialogWorkspaceCreate
              onSelect={(workspaceID) =>
                restoreWorkspaceSession({
                  dialog,
                  sdk,
                  sync,
                  project,
                  toast,
                  workspaceID,
                  sessionID: session.id,
                  done: list,
                })
              }
            />
          ))
          return false
        }}
      />
    ))
  }

  const options = createMemo(() => {
    const today = new Date().toDateString()
    const all = global() // kilocode_change
    return sessions()
      .filter((x) => x.parentID === undefined)
      .toSorted((a, b) => {
        const updatedDay = new Date(b.time.updated).setHours(0, 0, 0, 0) - new Date(a.time.updated).setHours(0, 0, 0, 0)
        if (updatedDay !== 0) return updatedDay
        return b.time.created - a.time.created
      })
      .map((x) => {
        const workspace = x.workspaceID ? project.workspace.get(x.workspaceID) : undefined

        let workspaceStatus: WorkspaceStatus | null = null
        if (x.workspaceID) {
          workspaceStatus = project.workspace.status(x.workspaceID) || "error"
        }

        let footer = ""
        if (Flag.KILO_EXPERIMENTAL_WORKSPACES) {
          if (x.workspaceID) {
            let desc = "unknown"
            if (workspace) {
              desc = `${workspace.type}: ${workspace.name}`
            }

            footer = (
              <>
                {desc}{" "}
                <span
                  style={{
                    fg: workspaceStatus === "connected" ? theme.success : theme.error,
                  }}
                >
                  ●
                </span>
              </>
            )
          }
        } else {
          footer = Locale.time(x.time.updated)
        }

        const date = new Date(x.time.updated)
        let category = date.toDateString()
        if (category === today) {
          category = "Today"
        }
        const isDeleting = toDelete() === x.id
        const status = sync.data.session_status?.[x.id]
        const isWorking = status?.type === "busy"
        return {
          title: isDeleting ? `Press ${keybind.print("session_delete")} again to confirm` : x.title,
          description: all && x.worktreeName ? `(${x.worktreeName})` : undefined, // kilocode_change - worktree label
          bg: isDeleting ? theme.error : undefined,
          value: x.id,
          category,
          footer,
          gutter: isWorking ? <Spinner /> : undefined,
        }
      })
  })

  onMount(() => {
    dialog.setSize("large")
  })

  return (
    <DialogSelect
      title={global() ? "Sessions (all worktrees)" : "Sessions (current worktree)"} // kilocode_change
      options={options()}
      skipFilter={true}
      current={currentSessionID()}
      onFilter={setSearch}
      onMove={() => {
        setToDelete(undefined)
      }}
      onSelect={(option) => {
        route.navigate({
          type: "session",
          sessionID: option.value,
        })
        dialog.clear()
      }}
      keybind={[
        {
          keybind: keybind.all.session_delete?.[0],
          title: "delete",
          onTrigger: async (option) => {
            if (toDelete() === option.value) {
              const session = sessions().find((item) => item.id === option.value)
              const status = session?.workspaceID ? project.workspace.status(session.workspaceID) : undefined

              try {
                const result = await sdk.client.session.delete({
                  sessionID: option.value,
                })
                if (result.error) {
                  if (session?.workspaceID) {
                    recover(session)
                  } else {
                    toast.show({
                      variant: "error",
                      title: "Failed to delete session",
                      message: errorMessage(result.error),
                    })
                  }
                  setToDelete(undefined)
                  return
                }
              } catch (err) {
                if (session?.workspaceID) {
                  recover(session)
                } else {
                  toast.show({
                    variant: "error",
                    title: "Failed to delete session",
                    message: errorMessage(err),
                  })
                }
                setToDelete(undefined)
                return
              }
              if (status && status !== "connected") {
                await sync.session.refresh()
              }
              void searchActions.refetch() // kilocode_change
              setToDelete(undefined)
              return
            }
            setToDelete(option.value)
          },
        },
        {
          keybind: keybind.all.session_rename?.[0],
          title: "rename", // kilocode_change
          // kilocode_change start
          onTrigger: async (option) => {
            const item = sessions().find((x) => x.id === option.value)
            dialog.replace(() => (
              <DialogSessionRename
                session={option.value}
                title={item?.title}
                onConfirm={() => {
                  void searchActions.refetch()
                }}
              />
            ))
          },
        },
        {
          keybind: { name: "a", ctrl: true, meta: false, shift: false, leader: false },
          title: global() ? "current" : "all",
          onTrigger: async () => {
            setToDelete(undefined)
            setGlobal((v) => !v)
          },
        },
        // kilocode_change end
        {
          keybind: Keybind.parse("ctrl+w")[0],
          title: "new workspace",
          side: "right",
          disabled: !Flag.KILO_EXPERIMENTAL_WORKSPACES,
          onTrigger: () => {
            createWorkspace()
          },
        },
      ]}
    />
  )
}
```

</details>


### packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx

- Conflict: UU (content)
- Recommendation: manual - Code files need manual review for kilocode_change markers
- Base Hash: `25fa08a4d112`
- Ours Hash: `7b4a7d091f8f`
- Theirs Hash: `7fbc628d36b4`
<details><summary>Original diff3 conflict</summary>

```diff
<<<<<<< HEAD
                  (lineCount >= 5 || pastedContent.length > 800) && // kilocode_change #7252 delay paste summary
                  !sync.data.config.experimental?.disable_paste_summary
||||||| c00058ed7a
                  (lineCount >= 3 || pastedContent.length > 150) &&
                  !sync.data.config.experimental?.disable_paste_summary
=======
                  (lineCount >= 3 || pastedContent.length > 150) &&
                  kv.get("paste_summary_enabled", !sync.data.config.experimental?.disable_paste_summary)
>>>>>>> markijbema/opencode-v1.14.30
```

</details>

- Decision: hybrid
- Risk: low
- Summary: Keep Kilo paste threshold, adopt upstream kv gating
- Rationale: Kilo issue #7252 raised the paste-summary thresholds (5 lines or 800 chars, from upstream's 3/150) to avoid spamming the paste dialog on typical edits. Upstream added a kv-backed toggle (kv.get('paste_summary_enabled', ...)) so users can override via the new key/value store. kv is already used elsewhere in this file, so we combine both: our higher thresholds plus upstream's kv fallback.
- Alternatives: take-ours loses the kv toggle; take-theirs regresses the #7252 UX fix
- Verification: bun run typecheck
- Resolution Hash: `0f33a70c19f9`
<details><summary>Resolved content</summary>

```diff
import { BoxRenderable, RGBA, TextareaRenderable, MouseEvent, PasteEvent, decodePasteBytes } from "@opentui/core"
import { createEffect, createMemo, onMount, createSignal, onCleanup, on, Show, Switch, Match } from "solid-js"
import "opentui-spinner/solid"
import path from "path"
import { fileURLToPath } from "url"
import { Filesystem } from "@/util/filesystem"
import { useLocal } from "@tui/context/local"
import { tint, useTheme } from "@tui/context/theme"
import { EmptyBorder, SplitBorder } from "@tui/component/border"
import { useSDK } from "@tui/context/sdk"
import { useRoute } from "@tui/context/route"
import { useProject } from "@tui/context/project"
import { useSync } from "@tui/context/sync"
import { useEvent } from "@tui/context/event"
import { useEditorContext, type EditorSelection } from "@tui/context/editor"
import { MessageID, PartID } from "@/session/schema"
import { createStore, produce, unwrap } from "solid-js/store"
import { useKeybind } from "@tui/context/keybind"
import { usePromptHistory, type PromptInfo } from "./history"
import { assign } from "./part"
import { usePromptStash } from "./stash"
import { DialogStash } from "../dialog-stash"
import { type AutocompleteRef, Autocomplete } from "./autocomplete"
import { useCommandDialog } from "../dialog-command"
import { useRenderer, useTerminalDimensions, type JSX } from "@opentui/solid"
import * as Editor from "@tui/util/editor"
import { useExit } from "../../context/exit"
import * as Clipboard from "../../util/clipboard"
import type { AssistantMessage, FilePart, UserMessage } from "@kilocode/sdk/v2"
import { TuiEvent } from "../../event"
import { iife } from "@/util/iife"
import { Locale } from "@/util/locale"
import { formatDuration } from "@/util/format"
import { createColors, createFrames } from "../../ui/spinner.ts"
import { useDialog } from "@tui/ui/dialog"
import { DialogProvider as DialogProviderConnect } from "../dialog-provider"
import { DialogAlert } from "../../ui/dialog-alert"
import { useToast } from "../../ui/toast"
import { useKV } from "../../context/kv"
import { createFadeIn } from "../../util/signal"
import { useTextareaKeybindings } from "../textarea-keybindings"
import { DialogSkill } from "../dialog-skill"
import { DialogWorkspaceCreate, restoreWorkspaceSession } from "../dialog-workspace-create"
import { DialogWorkspaceUnavailable } from "../dialog-workspace-unavailable"
import { useArgs } from "@tui/context/args"

export type PromptProps = {
  sessionID?: string
  workspaceID?: string
  visible?: boolean
  disabled?: boolean
  onSubmit?: () => void
  ref?: (ref: PromptRef | undefined) => void
  hint?: JSX.Element
  right?: JSX.Element
  showPlaceholder?: boolean
  placeholders?: {
    normal?: string[]
    shell?: string[]
  }
}

export type PromptRef = {
  focused: boolean
  current: PromptInfo
  set(prompt: PromptInfo): void
  reset(): void
  blur(): void
  focus(): void
  submit(): void
}

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

function randomIndex(count: number) {
  if (count <= 0) return 0
  return Math.floor(Math.random() * count)
}

function fadeColor(color: RGBA, alpha: number) {
  return RGBA.fromValues(color.r, color.g, color.b, color.a * alpha)
}

function getEditorSelectionKey(selection: EditorSelection) {
  return [
    selection.filePath,
    selection.text,
    selection.source ?? "",
    selection.selection.start.line,
    selection.selection.start.character,
    selection.selection.end.line,
    selection.selection.end.character,
  ].join("-")
}

let stashed: { prompt: PromptInfo; cursor: number } | undefined

export function Prompt(props: PromptProps) {
  let input: TextareaRenderable
  let anchor: BoxRenderable
  let autocomplete: AutocompleteRef

  const keybind = useKeybind()
  const local = useLocal()
  const args = useArgs()
  const sdk = useSDK()
  const editor = useEditorContext()
  const route = useRoute()
  const project = useProject()
  const sync = useSync()
  const dialog = useDialog()
  const toast = useToast()
  const status = createMemo(() => sync.data.session_status?.[props.sessionID ?? ""] ?? { type: "idle" })
  const history = usePromptHistory()
  const stash = usePromptStash()
  const command = useCommandDialog()
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const { theme, syntax } = useTheme()
  const kv = useKV()
  const animationsEnabled = createMemo(() => kv.get("animations_enabled", true))
  const list = createMemo(() => props.placeholders?.normal ?? [])
  const shell = createMemo(() => props.placeholders?.shell ?? [])
  const fileContextEnabled = createMemo(() => kv.get("file_context_enabled", true))
  const editorPath = createMemo(() => (fileContextEnabled() ? editor.selection()?.filePath : undefined))
  const editorSelectionLabel = createMemo(() => {
    const selection = fileContextEnabled() ? editor.selection()?.selection : undefined
    if (!selection) return
    if (selection.start.line === selection.end.line && selection.start.character === selection.end.character) return
    if (selection.start.line === selection.end.line) return `#${selection.start.line}`
    return `#${selection.start.line}-${selection.end.line}`
  })
  const editorFileLabel = createMemo(() => {
    const value = editorPath()
    if (!value) return
    const filename = path.basename(value)
    const file = /^index\.[^./]+$/.test(filename)
      ? [path.basename(path.dirname(value)), filename].filter(Boolean).join("/")
      : filename
    return `${file.split(path.sep).join("/")}${editorSelectionLabel() ?? ""}`
  })
  const editorFileLabelDisplay = createMemo(() => {
    const file = editorFileLabel()
    if (!file) return
    return Locale.truncateMiddle(file, Math.max(12, Math.min(48, Math.floor(dimensions().width / 3))))
  })
  let lastSubmittedEditorSelectionKey: string | undefined
  const [auto, setAuto] = createSignal<AutocompleteRef>()
  const currentProviderLabel = createMemo(() => local.model.parsed().provider)
  const hasRightContent = createMemo(() => Boolean(props.right))

  function promptModelWarning() {
    toast.show({
      variant: "warning",
      message: "Connect a provider to send prompts",
      duration: 3000,
    })
    if (sync.data.provider.length === 0) {
      dialog.replace(() => <DialogProviderConnect />)
    }
  }

  const textareaKeybindings = useTextareaKeybindings()

  const fileStyleId = syntax().getStyleId("extmark.file")!
  const agentStyleId = syntax().getStyleId("extmark.agent")!
  const pasteStyleId = syntax().getStyleId("extmark.paste")!
  let promptPartTypeId = 0
  const event = useEvent()

  event.on(TuiEvent.PromptAppend.type, (evt) => {
    if (!input || input.isDestroyed) return
    input.insertText(evt.properties.text)
    setTimeout(() => {
      // setTimeout is a workaround and needs to be addressed properly
      if (!input || input.isDestroyed) return
      input.getLayoutNode().markDirty()
      input.gotoBufferEnd()
      renderer.requestRender()
    }, 0)
  })

  createEffect(() => {
    if (props.disabled) input.cursorColor = theme.backgroundElement
    if (!props.disabled) input.cursorColor = theme.text
  })

  const lastUserMessage = createMemo(() => {
    if (!props.sessionID) return undefined
    const messages = sync.data.message[props.sessionID]
    if (!messages) return undefined
    return messages.findLast((m): m is UserMessage => m.role === "user")
  })

  const usage = createMemo(() => {
    if (!props.sessionID) return
    const msg = sync.data.message[props.sessionID] ?? []
    const last = msg.findLast((item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0)
    if (!last) return

    const tokens =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    if (tokens <= 0) return

    const model = sync.data.provider.find((item) => item.id === last.providerID)?.models[last.modelID]
    const pct = model?.limit.context ? `${Math.round((tokens / model.limit.context) * 100)}%` : undefined
    const cost = msg.reduce((sum, item) => sum + (item.role === "assistant" ? item.cost : 0), 0)
    return {
      context: pct ? `${Locale.number(tokens)} (${pct})` : Locale.number(tokens),
      cost: cost > 0 ? money.format(cost) : undefined,
    }
  })

  const [store, setStore] = createStore<{
    prompt: PromptInfo
    mode: "normal" | "shell"
    extmarkToPartIndex: Map<number, number>
    interrupt: number
    exitPress: number // kilocode_change - track double ctrl+c to exit
    placeholder: number
  }>({
    placeholder: randomIndex(list().length),
    prompt: {
      input: "",
      parts: [],
    },
    mode: "normal",
    extmarkToPartIndex: new Map(),
    interrupt: 0,
    exitPress: 0, // kilocode_change
  })

  createEffect(
    on(
      () => props.sessionID,
      () => {
        setStore("placeholder", randomIndex(list().length))
      },
      { defer: true },
    ),
  )

  // kilocode_change start - sync local agent/model whenever newest user message changes
  let syncedKey: string | undefined
  createEffect(() => {
    const sessionID = props.sessionID
    const msg = lastUserMessage()
    if (!sessionID || !msg) return

    const key = [sessionID, msg.id].join(":")
    if (key === syncedKey) return
    syncedKey = key

    // Only set agent if it's a primary agent (not a subagent)
    const primary = local.agent.list().find((x) => x.name === msg.agent)
    if (msg.agent && primary) {
      // Keep command line --agent if specified.
      if (!args.agent) local.agent.set(msg.agent)
      if (msg.model && !primary.model && !args.agent) {
        local.model.set(msg.model)
        local.model.variant.set(msg.model.variant)
      }
    }
  })
  // kilocode_change end

  command.register(() => {
    return [
      {
        title: "Clear prompt",
        value: "prompt.clear",
        category: "Prompt",
        hidden: true,
        onSelect: (dialog) => {
          input.extmarks.clear()
          input.clear()
          dialog.clear()
        },
      },
      {
        title: "Submit prompt",
        value: "prompt.submit",
        keybind: "input_submit",
        category: "Prompt",
        hidden: true,
        onSelect: async (dialog) => {
          if (!input.focused) return
          const handled = await submit()
          if (!handled) return

          dialog.clear()
        },
      },
      {
        title: "Paste",
        value: "prompt.paste",
        keybind: "input_paste",
        category: "Prompt",
        hidden: true,
        onSelect: async () => {
          const content = await Clipboard.read()
          if (content?.mime.startsWith("image/")) {
            await pasteAttachment({
              filename: "clipboard",
              mime: content.mime,
              content: content.data,
            })
          }
        },
      },
      {
        title: "Interrupt session",
        value: "session.interrupt",
        keybind: "session_interrupt",
        category: "Session",
        hidden: true,
        enabled: status().type !== "idle",
        onSelect: (dialog) => {
          if (autocomplete.visible) return
          if (!input.focused) return
          // TODO: this should be its own command
          if (store.mode === "shell") {
            setStore("mode", "normal")
            return
          }
          if (!props.sessionID) return

          setStore("interrupt", store.interrupt + 1)

          setTimeout(() => {
            setStore("interrupt", 0)
          }, 5000)

          if (store.interrupt >= 2) {
            void sdk.client.session.abort({
              sessionID: props.sessionID,
            })
            setStore("interrupt", 0)
          }
          dialog.clear()
        },
      },
      {
        title: "Open editor",
        category: "Session",
        keybind: "editor_open",
        value: "prompt.editor",
        slash: {
          name: "editor",
        },
        onSelect: async (dialog) => {
          dialog.clear()

          // replace summarized text parts with the actual text
          const text = store.prompt.parts
            .filter((p) => p.type === "text")
            .reduce((acc, p) => {
              if (!p.source) return acc
              return acc.replace(p.source.text.value, p.text)
            }, store.prompt.input)

          const nonTextParts = store.prompt.parts.filter((p) => p.type !== "text")

          const value = text
          const content = await Editor.open({ value, renderer })
          if (!content) return

          input.setText(content)

          // Update positions for nonTextParts based on their location in new content
          // Filter out parts whose virtual text was deleted
          // this handles a case where the user edits the text in the editor
          // such that the virtual text moves around or is deleted
          const updatedNonTextParts = nonTextParts
            .map((part) => {
              let virtualText = ""
              if (part.type === "file" && part.source?.text) {
                virtualText = part.source.text.value
              } else if (part.type === "agent" && part.source) {
                virtualText = part.source.value
              }

              if (!virtualText) return part

              const newStart = content.indexOf(virtualText)
              // if the virtual text is deleted, remove the part
              if (newStart === -1) return null

              const newEnd = newStart + virtualText.length

              if (part.type === "file" && part.source?.text) {
                return {
                  ...part,
                  source: {
                    ...part.source,
                    text: {
                      ...part.source.text,
                      start: newStart,
                      end: newEnd,
                    },
                  },
                }
              }

              if (part.type === "agent" && part.source) {
                return {
                  ...part,
                  source: {
                    ...part.source,
                    start: newStart,
                    end: newEnd,
                  },
                }
              }

              return part
            })
            .filter((part) => part !== null)

          setStore("prompt", {
            input: content,
            // keep only the non-text parts because the text parts were
            // already expanded inline
            parts: updatedNonTextParts,
          })
          restoreExtmarksFromParts(updatedNonTextParts)
          input.cursorOffset = Bun.stringWidth(content)
        },
      },
      {
        title: "Skills",
        value: "prompt.skills",
        category: "Prompt",
        slash: {
          name: "skills",
        },
        onSelect: () => {
          dialog.replace(() => (
            <DialogSkill
              onSelect={(skill) => {
                input.setText(`/${skill} `)
                setStore("prompt", {
                  input: `/${skill} `,
                  parts: [],
                })
                input.gotoBufferEnd()
              }}
            />
          ))
        },
      },
    ]
  })

  const ref: PromptRef = {
    get focused() {
      return input.focused
    },
    get current() {
      return store.prompt
    },
    focus() {
      input.focus()
    },
    blur() {
      input.blur()
    },
    set(prompt) {
      input.setText(prompt.input)
      setStore("prompt", prompt)
      restoreExtmarksFromParts(prompt.parts)
      input.gotoBufferEnd()
    },
    reset() {
      input.clear()
      input.extmarks.clear()
      setStore("prompt", {
        input: "",
        parts: [],
      })
      setStore("extmarkToPartIndex", new Map())
    },
    submit() {
      void submit()
    },
  }

  onMount(() => {
    const saved = stashed
    stashed = undefined
    if (store.prompt.input) return
    if (sa

... truncated after 16000 characters ...
```

</details>


### packages/opencode/src/cli/cmd/tui/context/sync.tsx

- Conflict: UU (content)
- Recommendation: manual - Code files need manual review for kilocode_change markers
- Base Hash: `c26d8696036d`
- Ours Hash: `900fd996151b`
- Theirs Hash: `d34e5e8bbdf2`
<details><summary>Original diff3 conflict</summary>

```diff
<<<<<<< HEAD
    const toast = useToast() // kilocode_change

    // kilocode_change start
    function evict(sessionID: string) {
      // Collect child session IDs so we can evict them too.
      const children = store.session.filter((s) => s.parentID === sessionID).map((s) => s.id)
      setStore(
        produce((draft) => {
          const messages = draft.message[sessionID]
          if (messages) {
            for (const msg of messages) delete draft.part[msg.id]
          }
          delete draft.message[sessionID]
          delete draft.session_diff[sessionID]
          delete draft.session_status[sessionID]
          delete draft.todo[sessionID]
          delete draft.permission[sessionID]
          delete draft.question[sessionID]
          delete draft.suggestion[sessionID]
          delete draft.network[sessionID]
        }),
      )
      fullSyncedSessions.delete(sessionID)
      for (const child of children) evict(child)
    }

    // Strip summary.diffs from user messages — the TUI never reads them
    // and they can carry multi-MB before/after file content strings.
    function strip(msg: Message): Message {
      if (msg.role !== "user" || !msg.summary?.diffs) return msg
      return { ...msg, summary: { ...msg.summary, diffs: [] } } as Message
    }
    // kilocode_change end
||||||| c00058ed7a
=======
    const kv = useKV()
>>>>>>> markijbema/opencode-v1.14.30
```

</details>

- Decision: hybrid
- Risk: low
- Summary: Keep Kilo evict/strip helpers, add upstream kv wiring
- Rationale: Our block defines evict() for recursive session cleanup and strip() to drop multi-MB diffs from user messages before TUI state — both are required by downstream call sites. Upstream introduced useKV() wiring that the merged sessionListQuery() (already in the file) depends on. Keep both: our helpers plus upstream's kv handle.
- Alternatives: take-ours: loses kv and breaks sessionListQuery(); take-theirs: loses evict/strip used throughout the sync context
- Verification: bun run typecheck
- Resolution Hash: `97389f4afc16`
<details><summary>Resolved content</summary>

```diff
import type {
  Message,
  Agent,
  Provider,
  Session,
  Part,
  Config,
  Todo,
  Command,
  PermissionRequest,
  QuestionRequest,
  SuggestionRequest, // kilocode_change
  SessionNetworkWait, // kilocode_change
  LspStatus,
  McpStatus,
  McpResource,
  FormatterStatus,
  SessionStatus,
  ProviderListResponse,
  ProviderAuthMethod,
  VcsInfo,
} from "@kilocode/sdk/v2"
import { createStore, produce, reconcile } from "solid-js/store"
import { useProject } from "@tui/context/project"
import { useEvent } from "@tui/context/event"
import { useSDK } from "@tui/context/sdk"
import { Binary } from "@opencode-ai/core/util/binary"
import { createSimpleContext } from "./helper"
import type { Snapshot } from "@/snapshot"
import { useExit } from "./exit"
import { useArgs } from "./args"
import { batch, createEffect, on, onMount } from "solid-js" // kilocode_change - add createEffect/on for workspace re-bootstrap
import { handleSuggestionEvent } from "@/kilocode/suggestion/tui/sync" // kilocode_change
import { useToast } from "@tui/ui/toast" // kilocode_change
import * as Log from "@opencode-ai/core/util/log"
import { emptyConsoleState, type ConsoleState } from "@/config/console-state"
import type { IndexingStatus } from "@kilocode/kilo-indexing/status" // kilocode_change
import { KiloIndexing } from "@/kilocode/indexing" // kilocode_change
import path from "path"
import { useKV } from "./kv"

export const { use: useSync, provider: SyncProvider } = createSimpleContext({
  name: "Sync",
  init: () => {
    const [store, setStore] = createStore<{
      status: "loading" | "partial" | "complete"
      provider: Provider[]
      provider_default: Record<string, string>
      provider_next: ProviderListResponse
      console_state: ConsoleState
      provider_auth: Record<string, ProviderAuthMethod[]>
      agent: Agent[]
      command: Command[]
      permission: {
        [sessionID: string]: PermissionRequest[]
      }
      question: {
        [sessionID: string]: QuestionRequest[]
      }
      // kilocode_change start
      suggestion: {
        [sessionID: string]: SuggestionRequest[]
      }
      network: {
        [sessionID: string]: SessionNetworkWait[]
      }
      // kilocode_change end
      config: Config
      session: Session[]
      session_status: {
        [sessionID: string]: SessionStatus
      }
      session_diff: {
        [sessionID: string]: Omit<Snapshot.FileDiff, "before" | "after">[] // kilocode_change
      }
      todo: {
        [sessionID: string]: Todo[]
      }
      message: {
        [sessionID: string]: Message[]
      }
      part: {
        [messageID: string]: Part[]
      }
      lsp: LspStatus[]
      mcp: {
        [key: string]: McpStatus
      }
      mcp_resource: {
        [key: string]: McpResource
      }
      formatter: FormatterStatus[]
      vcs: VcsInfo | undefined
      indexing: IndexingStatus // kilocode_change
    }>({
      provider_next: {
        all: [],
        default: {},
        connected: [],
      },
      console_state: emptyConsoleState,
      provider_auth: {},
      config: {},
      status: "loading",
      agent: [],
      permission: {},
      question: {},
      // kilocode_change start
      suggestion: {},
      network: {},
      // kilocode_change end
      command: [],
      provider: [],
      provider_default: {},
      session: [],
      session_status: {},
      session_diff: {},
      todo: {},
      message: {},
      part: {},
      lsp: [],
      mcp: {},
      mcp_resource: {},
      formatter: [],
      vcs: undefined,
      indexing: { state: "Disabled", message: "Indexing disabled.", processedFiles: 0, totalFiles: 0, percent: 0 }, // kilocode_change
    })

    const event = useEvent()
    const project = useProject()
    const sdk = useSDK()
    const toast = useToast() // kilocode_change
    const kv = useKV()

    // kilocode_change start
    function evict(sessionID: string) {
      // Collect child session IDs so we can evict them too.
      const children = store.session.filter((s) => s.parentID === sessionID).map((s) => s.id)
      setStore(
        produce((draft) => {
          const messages = draft.message[sessionID]
          if (messages) {
            for (const msg of messages) delete draft.part[msg.id]
          }
          delete draft.message[sessionID]
          delete draft.session_diff[sessionID]
          delete draft.session_status[sessionID]
          delete draft.todo[sessionID]
          delete draft.permission[sessionID]
          delete draft.question[sessionID]
          delete draft.suggestion[sessionID]
          delete draft.network[sessionID]
        }),
      )
      fullSyncedSessions.delete(sessionID)
      for (const child of children) evict(child)
    }

    // Strip summary.diffs from user messages — the TUI never reads them
    // and they can carry multi-MB before/after file content strings.
    function strip(msg: Message): Message {
      if (msg.role !== "user" || !msg.summary?.diffs) return msg
      return { ...msg, summary: { ...msg.summary, diffs: [] } } as Message
    }
    // kilocode_change end

    const fullSyncedSessions = new Set<string>()
    let syncedWorkspace = project.workspace.current()

    function sessionListQuery(): { scope?: "project"; path?: string } {
      if (!kv.get("session_directory_filter_enabled", true)) return { scope: "project" }
      if (!project.data.instance.path.worktree || !project.data.instance.path.directory) return { scope: "project" }
      return {
        path: path
          .relative(path.resolve(project.data.instance.path.worktree), project.data.instance.path.directory)
          .replaceAll("\\", "/"),
      }
    }

    function listSessions() {
      return sdk.client.session
        .list({ start: Date.now() - 30 * 24 * 60 * 60 * 1000, ...sessionListQuery() })
        .then((x) => (x.data ?? []).toSorted((a, b) => a.id.localeCompare(b.id)))
    }

    event.subscribe((event) => {
      switch (event.type) {
        case "server.instance.disposed":
          void bootstrap()
          break
        case "permission.replied": {
          const requests = store.permission[event.properties.sessionID]
          if (!requests) break
          const match = Binary.search(requests, event.properties.requestID, (r) => r.id)
          if (!match.found) break
          setStore(
            "permission",
            event.properties.sessionID,
            produce((draft) => {
              draft.splice(match.index, 1)
            }),
          )
          break
        }

        case "permission.asked": {
          const request = event.properties
          const requests = store.permission[request.sessionID]
          if (!requests) {
            setStore("permission", request.sessionID, [request])
            break
          }
          const match = Binary.search(requests, request.id, (r) => r.id)
          if (match.found) {
            setStore("permission", request.sessionID, match.index, reconcile(request))
            break
          }
          setStore(
            "permission",
            request.sessionID,
            produce((draft) => {
              draft.splice(match.index, 0, request)
            }),
          )
          break
        }

        case "question.replied":
        case "question.rejected": {
          const requests = store.question[event.properties.sessionID]
          if (!requests) break
          const match = Binary.search(requests, event.properties.requestID, (r) => r.id)
          if (!match.found) break
          setStore(
            "question",
            event.properties.sessionID,
            produce((draft) => {
              draft.splice(match.index, 1)
            }),
          )
          break
        }

        case "question.asked": {
          const request = event.properties
          const requests = store.question[request.sessionID]
          if (!requests) {
            setStore("question", request.sessionID, [request])
            break
          }
          const match = Binary.search(requests, request.id, (r) => r.id)
          if (match.found) {
            setStore("question", request.sessionID, match.index, reconcile(request))
            break
          }
          setStore(
            "question",
            request.sessionID,
            produce((draft) => {
              draft.splice(match.index, 0, request)
            }),
          )
          break
        } // kilocode_change

        // kilocode_change start
        case "session.network.replied":
        case "session.network.rejected": {
          const requests = store.network[event.properties.sessionID]
          if (!requests) break
          const match = Binary.search(requests, event.properties.requestID, (r) => r.id)
          if (!match.found) break
          setStore(
            "network",
            event.properties.sessionID,
            produce((draft) => {
              draft.splice(match.index, 1)
            }),
          )
          break
        }

        // kilocode_change start
        case "suggestion.accepted":
        case "suggestion.dismissed":
        case "suggestion.shown": {
          handleSuggestionEvent(event, store, setStore)
          break
        }
        // kilocode_change end

        case "session.network.restored": {
          const requests = store.network[event.properties.sessionID]
          if (!requests) break
          const match = Binary.search(requests, event.properties.requestID, (r) => r.id)
          if (match.found) {
            setStore("network", event.properties.sessionID, match.index, "restored", true)
          }
          break
        }

        case "session.network.asked": {
          const request = event.properties
          const requests = store.network[request.sessionID]
          if (!requests) {
            setStore("network", request.sessionID, [request])
            break
          }
          const match = Binary.search(requests, request.id, (r) => r.id)
          if (match.found) {
            setStore("network", request.sessionID, match.index, reconcile(request))
            break
          }
          setStore(
            "network",
            request.sessionID,
            produce((draft) => {
              draft.splice(match.index, 0, request)
            }),
          )
          break
        }
        // kilocode_change end
        case "todo.updated":
          setStore("todo", event.properties.sessionID, event.properties.todos)
          break

        case "session.diff":
          setStore("session_diff", event.properties.sessionID, event.properties.diff)
          break

        // kilocode_change start
        case "session.deleted": {
          const sid = event.properties.info.id
          const match = Binary.search(store.session, sid, (s) => s.id)
          if (match.found) {
            setStore(
              "session",
              produce((draft) => {
                draft.splice(match.index, 1)
              }),
            )
          }
          evict(sid)
          break
        }
        // kilocode_change end
        case "session.updated": {
          const result = Binary.search(store.session, event.properties.info.id, (s) => s.id)
          if (result.found) {
            setStore("session", result.index, reconcile(event.properties.info))
            break
          }
          setStore(
            "session",
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.info)
            }),
          )
          break
        }

        case "session.status": {
          setStore("session_status", event.properties.sessionID, event.properties.status)
          break
        }

        // kilocode_change start
        case "message.updated": {
          const info = strip(event.properties.info)
          const messages = store.message[info.sessionID]
          if (!messages) {
            setStore("message", info.sessionID, [info])
            break
          }
          const result = Binary.search(messages, info.id, (m) => m.id)
          if (result.found) {
            setStore("message", info.sessionID, result.index, reconcile(info))
            break
          }
          setStore(
            "message",
            info.sessionID,
            produce((draft) => {
              draft.splice(result.index, 0, info)
            }),
          )
          const updated = store.message[info.sessionID]
          if (updated.length > 100) {
            const oldest = updated[0]
            batch(() => {
              setStore(
                "message",
                info.sessionID,
                produce((draft) => {
                  draft.shift()
                }),
              )
              setStore(
                "part",
                produce((draft) => {
                  delete draft[oldest.id]
                }),
              )
            })
          }
          break
        }
        // kilocode_change end
        case "message.removed": {
          const messages = store.message[event.properties.sessionID]
          const result = Binary.search(messages, event.properties.messageID, (m) => m.id)
          if (result.found) {
            setStore(
              "message",
              event.properties.sessionID,
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          }
          break
        }
        case "message.part.updated": {
          const parts = store.part[event.properties.part.messageID]
          if (!parts) {
            setStore("part", event.properties.part.messageID, [event.properties.part])
            break
          }
          const result = Binary.search(parts, event.properties.part.id, (p) => p.id)
          if (result.found) {
            setStore("part", event.properties.part.messageID, result.index, reconcile(event.properties.part))
            break
          }
          setStore(
            "part",
            event.properties.part.messageID,
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.part)
            }),
          )
          break
        }

        case "message.part.delta": {
          const parts = store.part[event.properties.messageID]
          if (!parts) break
          const result = Binary.search(parts, event.properties.partID, (p) => p.id)
          if (!result.found) break
          setStore(
            "part",
            event.properties.messageID,
            produce((draft) => {
              const part = draft[result.index]
              const field = event.properties.field as keyof typeof part
              const existing = part[field] as string | undefined
              ;(part[field] as string) = (existing ?? "") + event.properties.delta
            }),
          )
          break
        }

        case "message.part.removed": {
          const parts = store.part[event.properties.messageID]
          const result = Binary.search(parts, event.properties.partID, (p) => p.id)
          if (result.found)
            setStore(
              "part",
              event.properties.messageID,
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          break
        }

        case "lsp.updated": {
          const workspace = project.workspace.current()
          void sdk.client.lsp.status({ workspace }).then((x) => setStore("lsp", x.data ?? []))
          break
        }

        case "vcs.branch.updated": {
          setStore("vcs", { branch: event.properties.branch })
          break
        }

        // kilocode_change start
        case "global.config.updated": {
          sdk.client.config.get().then((x) => {
            if (x.data) setStore("config", reconcile(x.data))
          })
          break
        }
        case "indexing.status": {
          setStore("indexing", reconcile(event.properties.status))

... truncated after 16000 characters ...
```

</details>


### packages/opencode/src/cli/cmd/tui/context/theme.tsx

- Conflict: UU (content)
- Recommendation: manual - Code files need manual review for kilocode_change markers
- Base Hash: `4f8ac0a9f59b`
- Ours Hash: `51767ee84482`
- Theirs Hash: `9e1c589b3f5e`
<details><summary>Original diff3 conflict</summary>

```diff
<<<<<<< HEAD
      // kilocode_change start - validate custom theme JSON and protect built-in keys
      if (name in DEFAULT_THEMES) continue
      const json = await Filesystem.readJson(item).catch(() => null)
      if (!isValidTheme(json)) continue
      result[name] = json
      // kilocode_change end
||||||| c00058ed7a
      result[name] = await Filesystem.readJson(item)
=======
      const theme = await Filesystem.readJson(item)
      if (isTheme(theme)) result[name] = theme
>>>>>>> markijbema/opencode-v1.14.30
```

</details>

- Decision: take-ours
- Risk: low
- Summary: Keep Kilo theme validation + default-key protection
- Rationale: Our loader rejects custom theme files whose name collides with DEFAULT_THEMES and runs a stricter isValidTheme() check (requires theme.background/text/primary) rather than upstream's looser isTheme() (record-shape only). Upstream's check is a subset of ours; keeping ours also blocks shadowing of built-in theme names.
- Alternatives: take-theirs would let a custom themes/opencode.json shadow the built-in theme and accept structurally-valid but color-less theme JSON
- Verification: bun run typecheck
- Resolution Hash: `51767ee84482`
<details><summary>Resolved content</summary>

```diff
import { CliRenderEvents, SyntaxStyle, RGBA, type TerminalColors } from "@opentui/core"
import path from "path"
import { createEffect, createMemo, onCleanup, onMount } from "solid-js"
import { createSimpleContext } from "./helper"
import { Glob } from "@opencode-ai/core/util/glob"
import aura from "./theme/aura.json" with { type: "json" }
import ayu from "./theme/ayu.json" with { type: "json" }
import catppuccin from "./theme/catppuccin.json" with { type: "json" }
import catppuccinFrappe from "./theme/catppuccin-frappe.json" with { type: "json" }
import catppuccinMacchiato from "./theme/catppuccin-macchiato.json" with { type: "json" }
import cobalt2 from "./theme/cobalt2.json" with { type: "json" }
import cursor from "./theme/cursor.json" with { type: "json" }
import dracula from "./theme/dracula.json" with { type: "json" }
import everforest from "./theme/everforest.json" with { type: "json" }
import flexoki from "./theme/flexoki.json" with { type: "json" }
import github from "./theme/github.json" with { type: "json" }
import gruvbox from "./theme/gruvbox.json" with { type: "json" }
import kanagawa from "./theme/kanagawa.json" with { type: "json" }
import kilo from "./theme/kilo.json" with { type: "json" } // kilocode_change
import material from "./theme/material.json" with { type: "json" }
import matrix from "./theme/matrix.json" with { type: "json" }
import mercury from "./theme/mercury.json" with { type: "json" }
import monokai from "./theme/monokai.json" with { type: "json" }
import nightowl from "./theme/nightowl.json" with { type: "json" }
import nord from "./theme/nord.json" with { type: "json" }
import osakaJade from "./theme/osaka-jade.json" with { type: "json" }
import onedark from "./theme/one-dark.json" with { type: "json" }
import opencode from "./theme/opencode.json" with { type: "json" }
import orng from "./theme/orng.json" with { type: "json" }
import lucentOrng from "./theme/lucent-orng.json" with { type: "json" }
import palenight from "./theme/palenight.json" with { type: "json" }
import rosepine from "./theme/rosepine.json" with { type: "json" }
import solarized from "./theme/solarized.json" with { type: "json" }
import synthwave84 from "./theme/synthwave84.json" with { type: "json" }
import tokyonight from "./theme/tokyonight.json" with { type: "json" }
import vercel from "./theme/vercel.json" with { type: "json" }
import vesper from "./theme/vesper.json" with { type: "json" }
import zenburn from "./theme/zenburn.json" with { type: "json" }
import carbonfox from "./theme/carbonfox.json" with { type: "json" }
import colorblind from "./theme/colorblind.json" with { type: "json" } // kilocode_change
import { useKV } from "./kv"
import { useRenderer } from "@opentui/solid"
import { createStore, produce } from "solid-js/store"
import { Global } from "@opencode-ai/core/global"
import { Filesystem } from "@/util/filesystem"
import { useTuiConfig } from "./tui-config"
import { isRecord } from "@/util/record"
import type { TuiThemeCurrent } from "@kilocode/plugin/tui"

type Theme = TuiThemeCurrent & {
  _hasSelectedListItemText: boolean
}
type ThemeColor = Exclude<keyof TuiThemeCurrent, "thinkingOpacity">

export function selectedForeground(theme: Theme, bg?: RGBA): RGBA {
  // If theme explicitly defines selectedListItemText, use it
  if (theme._hasSelectedListItemText) {
    return theme.selectedListItemText
  }

  // For transparent backgrounds, calculate contrast based on the actual bg (or fallback to primary)
  if (theme.background.a === 0) {
    const targetColor = bg ?? theme.primary
    const { r, g, b } = targetColor
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b
    return luminance > 0.5 ? RGBA.fromInts(0, 0, 0) : RGBA.fromInts(255, 255, 255)
  }

  // Fall back to background color
  return theme.background
}

type HexColor = `#${string}`
type RefName = string
type Variant = {
  dark: HexColor | RefName
  light: HexColor | RefName
}
type ColorValue = HexColor | RefName | Variant | RGBA
export type ThemeJson = {
  $schema?: string
  defs?: Record<string, HexColor | RefName>
  theme: Omit<Record<ThemeColor, ColorValue>, "selectedListItemText" | "backgroundMenu"> & {
    selectedListItemText?: ColorValue
    backgroundMenu?: ColorValue
    thinkingOpacity?: number
  }
}

export const DEFAULT_THEMES: Record<string, ThemeJson> = {
  aura,
  ayu,
  catppuccin,
  ["catppuccin-frappe"]: catppuccinFrappe,
  ["catppuccin-macchiato"]: catppuccinMacchiato,
  cobalt2,
  cursor,
  dracula,
  everforest,
  flexoki,
  github,
  gruvbox,
  kanagawa,
  kilo, // kilocode_change
  material,
  matrix,
  mercury,
  monokai,
  nightowl,
  nord,
  ["one-dark"]: onedark,
  ["osaka-jade"]: osakaJade,
  opencode,
  orng,
  ["lucent-orng"]: lucentOrng,
  palenight,
  rosepine,
  solarized,
  synthwave84,
  tokyonight,
  vesper,
  vercel,
  zenburn,
  carbonfox,
  colorblind, // kilocode_change
}

// kilocode_change start
function isValidTheme(t: unknown): t is ThemeJson {
  if (t == null || typeof t !== "object" || !("theme" in t)) return false
  const theme = (t as Record<string, unknown>).theme
  if (theme == null || typeof theme !== "object") return false
  return "background" in theme && "text" in theme && "primary" in theme
}
// kilocode_change end

type State = {
  themes: Record<string, ThemeJson>
  mode: "dark" | "light"
  lock: "dark" | "light" | undefined
  active: string
  ready: boolean
}

const pluginThemes: Record<string, ThemeJson> = {}
let customThemes: Record<string, ThemeJson> = {}
let systemTheme: ThemeJson | undefined

function listThemes() {
  // Priority: defaults < plugin installs < custom files < generated system.
  const themes = {
    ...DEFAULT_THEMES,
    ...pluginThemes,
    ...customThemes,
  }
  if (!systemTheme) return themes
  return {
    ...themes,
    system: systemTheme,
  }
}

function syncThemes() {
  setStore("themes", listThemes())
}

const [store, setStore] = createStore<State>({
  themes: listThemes(),
  mode: "dark",
  lock: undefined,
  active: "opencode",
  ready: false,
})

export function allThemes() {
  return store.themes
}

function isTheme(theme: unknown): theme is ThemeJson {
  if (!isRecord(theme)) return false
  if (!isRecord(theme.theme)) return false
  return true
}

export function hasTheme(name: string) {
  if (!name) return false
  return allThemes()[name] !== undefined
}

export function addTheme(name: string, theme: unknown) {
  if (!name) return false
  if (!isTheme(theme)) return false
  if (hasTheme(name)) return false
  pluginThemes[name] = theme
  syncThemes()
  return true
}

export function upsertTheme(name: string, theme: unknown) {
  if (!name) return false
  if (!isTheme(theme)) return false
  if (customThemes[name] !== undefined) {
    customThemes[name] = theme
  } else {
    pluginThemes[name] = theme
  }
  syncThemes()
  return true
}

export function resolveTheme(theme: ThemeJson, mode: "dark" | "light") {
  const defs = theme.defs ?? {}
  function resolveColor(c: ColorValue, chain: string[] = []): RGBA {
    if (c instanceof RGBA) return c
    if (typeof c === "string") {
      if (c === "transparent" || c === "none") return RGBA.fromInts(0, 0, 0, 0)

      if (c.startsWith("#")) return RGBA.fromHex(c)

      if (chain.includes(c)) {
        throw new Error(`Circular color reference: ${[...chain, c].join(" -> ")}`)
      }

      const next = defs[c] ?? theme.theme[c as ThemeColor]
      if (next === undefined) {
        throw new Error(`Color reference "${c}" not found in defs or theme`)
      }
      return resolveColor(next, [...chain, c])
    }
    if (typeof c === "number") {
      return ansiToRgba(c)
    }
    return resolveColor(c[mode], chain)
  }

  const resolved = Object.fromEntries(
    Object.entries(theme.theme)
      .filter(([key]) => key !== "selectedListItemText" && key !== "backgroundMenu" && key !== "thinkingOpacity")
      .map(([key, value]) => {
        return [key, resolveColor(value as ColorValue)]
      }),
  ) as Partial<Record<ThemeColor, RGBA>>

  // Handle selectedListItemText separately since it's optional
  const hasSelectedListItemText = theme.theme.selectedListItemText !== undefined
  if (hasSelectedListItemText) {
    resolved.selectedListItemText = resolveColor(theme.theme.selectedListItemText!)
  } else {
    // Backward compatibility: if selectedListItemText is not defined, use background color
    // This preserves the current behavior for all existing themes
    resolved.selectedListItemText = resolved.background
  }

  // Handle backgroundMenu - optional with fallback to backgroundElement
  if (theme.theme.backgroundMenu !== undefined) {
    resolved.backgroundMenu = resolveColor(theme.theme.backgroundMenu)
  } else {
    resolved.backgroundMenu = resolved.backgroundElement
  }

  // Handle thinkingOpacity - optional with default of 0.6
  const thinkingOpacity = theme.theme.thinkingOpacity ?? 0.6

  return {
    ...resolved,
    _hasSelectedListItemText: hasSelectedListItemText,
    thinkingOpacity,
  } as Theme
}

function ansiToRgba(code: number): RGBA {
  // Standard ANSI colors (0-15)
  if (code < 16) {
    const ansiColors = [
      "#000000", // Black
      "#800000", // Red
      "#008000", // Green
      "#808000", // Yellow
      "#000080", // Blue
      "#800080", // Magenta
      "#008080", // Cyan
      "#c0c0c0", // White
      "#808080", // Bright Black
      "#ff0000", // Bright Red
      "#00ff00", // Bright Green
      "#ffff00", // Bright Yellow
      "#0000ff", // Bright Blue
      "#ff00ff", // Bright Magenta
      "#00ffff", // Bright Cyan
      "#ffffff", // Bright White
    ]
    return RGBA.fromHex(ansiColors[code] ?? "#000000")
  }

  // 6x6x6 Color Cube (16-231)
  if (code < 232) {
    const index = code - 16
    const b = index % 6
    const g = Math.floor(index / 6) % 6
    const r = Math.floor(index / 36)

    const val = (x: number) => (x === 0 ? 0 : x * 40 + 55)
    return RGBA.fromInts(val(r), val(g), val(b))
  }

  // Grayscale Ramp (232-255)
  if (code < 256) {
    const gray = (code - 232) * 10 + 8
    return RGBA.fromInts(gray, gray, gray)
  }

  // Fallback for invalid codes
  return RGBA.fromInts(0, 0, 0)
}

export const { use: useTheme, provider: ThemeProvider } = createSimpleContext({
  name: "Theme",
  init: (props: { mode: "dark" | "light" }) => {
    const renderer = useRenderer()
    const config = useTuiConfig()
    const kv = useKV()
    const pick = (value: unknown) => {
      if (value === "dark" || value === "light") return value
      return
    }

    setStore(
      produce((draft) => {
        const lock = pick(kv.get("theme_mode_lock"))
        const mode = lock ?? pick(renderer.themeMode) ?? props.mode
        if (!lock && pick(kv.get("theme_mode")) !== undefined) {
          kv.set("theme_mode", undefined)
        }
        draft.mode = mode
        draft.lock = lock
        const active = config.theme ?? kv.get("theme", "kilo") // kilocode_change
        draft.active = typeof active === "string" ? active : "kilo" // kilocode_change
        draft.ready = false
      }),
    )

    createEffect(() => {
      const theme = config.theme
      if (theme) setStore("active", theme)
    })

    function init() {
      void Promise.allSettled([
        resolveSystemTheme(store.mode),
        getCustomThemes()
          .then((custom) => {
            customThemes = custom
            syncThemes()
          })
          .catch(() => {
            setStore("active", "kilo") // kilocode_change
          }),
      ]).finally(() => {
        setStore("ready", true)
      })
    }

    onMount(init)

    function resolveSystemTheme(mode: "dark" | "light" = store.mode) {
      return renderer
        .getPalette({
          size: 16,
        })
        .then((colors: TerminalColors) => {
          if (!colors.palette[0]) {
            systemTheme = undefined
            syncThemes()
            if (store.active === "system") {
              setStore("active", "kilo") // kilocode_change
            }
            return
          }
          systemTheme = generateSystem(colors, mode)
          syncThemes()
        })
        .catch(() => {
          systemTheme = undefined
          syncThemes()
          if (store.active === "system") {
            setStore("active", "opencode")
          }
        })
    }

    function apply(mode: "dark" | "light") {
      if (store.lock !== undefined) kv.set("theme_mode", mode)
      if (store.mode === mode) return
      setStore("mode", mode)
      renderer.clearPaletteCache()
      void resolveSystemTheme(mode)
    }

    function pin(mode: "dark" | "light" = store.mode) {
      setStore("lock", mode)
      kv.set("theme_mode_lock", mode)
      apply(mode)
    }

    function free() {
      setStore("lock", undefined)
      kv.set("theme_mode_lock", undefined)
      kv.set("theme_mode", undefined)
      const mode = renderer.themeMode
      if (mode) apply(mode)
    }

    const handle = (mode: "dark" | "light") => {
      if (store.lock) return
      apply(mode)
    }
    renderer.on(CliRenderEvents.THEME_MODE, handle)

    const refresh = () => {
      renderer.clearPaletteCache()
      init()
    }
    process.on("SIGUSR2", refresh)

    onCleanup(() => {
      renderer.off(CliRenderEvents.THEME_MODE, handle)
      process.off("SIGUSR2", refresh)
    })

    // kilocode_change start - safe fallback to kilo import if store lookup fails
    const values = createMemo(() => {
      const active = store.themes[store.active]
      if (active) return resolveTheme(active, store.mode)

      const saved = kv.get("theme")
      if (typeof saved === "string") {
        const theme = store.themes[saved]
        if (theme) return resolveTheme(theme, store.mode)
      }

      return resolveTheme(store.themes.kilo, store.mode) // kilocode_change
    })
    // kilocode_change end

    createEffect(() => {
      renderer.setBackgroundColor(values().background)
    })

    const syntax = createMemo(() => generateSyntax(values()))
    const subtleSyntax = createMemo(() => generateSubtleSyntax(values()))

    // kilocode_change - use empty object as proxy target; all reads go through the getter
    return {
      theme: new Proxy({} as Theme, {
        get(_target, prop) {
          // @ts-expect-error
          return values()[prop]
        },
      }),
      get selected() {
        return store.active
      },
      all() {
        return allThemes()
      },
      has(name: string) {
        return hasTheme(name)
      },
      syntax,
      subtleSyntax,
      mode() {
        return store.mode
      },
      locked() {
        return store.lock !== undefined
      },
      lock() {
        pin(store.mode)
      },
      unlock() {
        free()
      },
      setMode(mode: "dark" | "light") {
        pin(mode)
      },
      set(theme: string) {
        if (!hasTheme(theme)) return false
        setStore("active", theme)
        kv.set("theme", theme)
        return true
      },
      get ready() {
        return store.ready
      },
    }
  },
})

async function getCustomThemes() {
  const directories = [
    Global.Path.config,
    ...(await Array.fromAsync(
      Filesystem.up({
        targets: [".kilo", ".opencode"], // kilocode_change
        start: process.cwd(),
      }),
    )),
  ]

  const result: Record<string, ThemeJson> = {}
  for (const dir of directories) {
    for (const item of await Glob.scan("themes/*.json", {
      cwd: dir,
      absolute: true,
      dot: true,
      symlink: true,
    })) {
      const name = path.basename(item, ".json")
      // kilocode_change start - validate custom theme JSON and protect built-in keys
      if (name in DEFAULT_THEMES) continue
      const json = await Filesystem.readJson(item).catch(() => null)
      if (!isValidTheme(json)) continue
      result[name] = json
      // kilocode_change end
    }
  }
  return result
}

export function tint(base: RGBA, overlay: RGBA, alpha: number): RGBA {
  const r = base.r + (overlay.r - base.r) * alpha
  con

... truncated after 16000 characters ...
```

</details>


### packages/opencode/src/server/proxy.ts

- Conflict: UU (content)
- Recommendation: manual - Code files need manual review for kilocode_change markers
- Base Hash: `fe1692e65113`
- Ours Hash: `ac7a53f1af47`
- Theirs Hash: `6d5353f16caa`
<details><summary>Original diff3 conflict</summary>

```diff
<<<<<<< HEAD
type Msg = string | ArrayBuffer

function headers(req: Request, extra?: HeadersInit) {
  const out = new Headers(req.headers)
  for (const key of hop) out.delete(key)
  out.delete("accept-encoding")
  out.delete("x-kilo-directory")
  out.delete("x-kilo-workspace")
  if (!extra) return out
  for (const [key, value] of new Headers(extra).entries()) {
    out.set(key, value)
  }
  return out
}

function protocols(req: Request) {
  const value = req.headers.get("sec-websocket-protocol")
  if (!value) return []
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function socket(url: string | URL) {
  const next = new URL(url)
  if (next.protocol === "http:") next.protocol = "ws:"
  if (next.protocol === "https:") next.protocol = "wss:"
  return next.toString()
}
||||||| c00058ed7a
type Msg = string | ArrayBuffer | Uint8Array

function headers(req: Request, extra?: HeadersInit) {
  const out = new Headers(req.headers)
  for (const key of hop) out.delete(key)
  out.delete("accept-encoding")
  out.delete("x-opencode-directory")
  out.delete("x-opencode-workspace")
  if (!extra) return out
  for (const [key, value] of new Headers(extra).entries()) {
    out.set(key, value)
  }
  return out
}

function protocols(req: Request) {
  const value = req.headers.get("sec-websocket-protocol")
  if (!value) return []
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function socket(url: string | URL) {
  const next = new URL(url)
  if (next.protocol === "http:") next.protocol = "ws:"
  if (next.protocol === "https:") next.protocol = "wss:"
  return next.toString()
}
=======
type Msg = string | ArrayBuffer | Uint8Array
>>>>>>> markijbema/opencode-v1.14.30

<<<<<<< HEAD
export async function http(url: string | URL, extra: HeadersInit | undefined, req: Request, workspaceID: WorkspaceID) {
  if (!(await Workspace.isSyncing(workspaceID))) {
    // kilocode_change missing await
    return new Response(`broken sync connection for workspace: ${workspaceID}`, {
      status: 503,
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    })
||||||| c00058ed7a
export async function http(url: string | URL, extra: HeadersInit | undefined, req: Request, workspaceID: WorkspaceID) {
  if (!Workspace.isSyncing(workspaceID)) {
    return new Response(`broken sync connection for workspace: ${workspaceID}`, {
      status: 503,
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    })
=======
function statusText(response: unknown) {
  return (response as { source?: Response }).source?.statusText
}

export function httpEffect(url: string | URL, extra: HeadersInit | undefined, req: Request, workspaceID: WorkspaceID) {
  if (!Workspace.isSyncing(workspaceID)) {
    return Effect.succeed(
      new Response(`broken sync connection for workspace: ${workspaceID}`, {
        status: 503,
        headers: {
          "content-type": "text/plain; charset=utf-8",
        },
      }),
    )
>>>>>>> markijbema/opencode-v1.14.30

<<<<<<< HEAD
  next.set("x-kilo-proxy-url", socket(target))
||||||| c00058ed7a
  next.set("x-opencode-proxy-url", socket(target))
=======
  next.set("x-kilo-proxy-url", ProxyUtil.websocketTargetURL(target))
>>>>>>> markijbema/opencode-v1.14.30
```

</details>

- Decision: hybrid
- Risk: medium
- Summary: Adopt upstream Effect proxy refactor; keep Kilo Msg type and await on isSyncing
- Rationale: Upstream extracted the proxy headers/protocols/socket helpers into ProxyUtil (which already has Kilo-branded x-kilo-directory/workspace sanitization) and rewrote http() as an Effect pipeline (httpEffect + thin http wrapper). We adopt the refactor and keep two Kilo deltas: (1) Msg stays 'string | ArrayBuffer' (not upstream's '| Uint8Array') because the queue consumer at onMessage always converts Uint8Array to ArrayBuffer before pushing — tsgo rejects Uint8Array via ws.send() in the replay loop; (2) Workspace.isSyncing is async, so the 503 branch now runs 'yield* Effect.promise(() => Workspace.isSyncing(...))' instead of the sync Promise-truthy check. The x-kilo-proxy-url header stays and uses ProxyUtil.websocketTargetURL.
- Alternatives: take-ours would keep inline helpers and a standalone async http() — diverging further from upstream's Effect pipeline and stale ProxyUtil; take-theirs drops the await fix and regresses the sync-ready check (Promise is always truthy → 503 never fires); take-theirs would let Uint8Array into Msg (breaks tsgo ws.send typing) and regresses the isSyncing async check; take-ours keeps inline helpers and standalone async http(), diverging from upstream's Effect pipeline
- Verification: bun run typecheck; bun test test/server/httpapi-bridge.test.ts; bun run typecheck (turbo) — passes
- Resolution Hash: `302602e28965`
<details><summary>Resolved content</summary>

```diff
import { Hono } from "hono"
import type { UpgradeWebSocket } from "hono/ws"
import * as Log from "@opencode-ai/core/util/log"
import * as Fence from "./fence"
import type { WorkspaceID } from "@/control-plane/schema"
import { Workspace } from "@/control-plane/workspace"
import { ProxyUtil } from "./proxy-util"
import { Effect, Stream } from "effect"
import { FetchHttpClient, HttpBody, HttpClient, HttpClientRequest } from "effect/unstable/http"

type Msg = string | ArrayBuffer // kilocode_change - Uint8Array is converted to ArrayBuffer before push

function send(ws: { send(data: string | ArrayBuffer): void }, data: any) {
  if (data instanceof Blob) {
    return data.arrayBuffer().then((x) => ws.send(x))
  }
  if (data instanceof Uint8Array) {
    return ws.send(data.buffer as ArrayBuffer)
  }
  return ws.send(data)
}

const app = (upgrade: UpgradeWebSocket) =>
  new Hono().get(
    "/__workspace_ws",
    upgrade((c) => {
      const url = c.req.header("x-kilo-proxy-url")
      const queue: Msg[] = []
      let remote: WebSocket | undefined
      return {
        onOpen(_, ws) {
          if (!url) {
            ws.close(1011, "missing proxy target")
            return
          }
          remote = new WebSocket(url, ProxyUtil.websocketProtocols(c.req.raw))
          remote.binaryType = "arraybuffer"
          remote.onopen = () => {
            for (const item of queue) remote?.send(item)
            queue.length = 0
          }
          remote.onmessage = (event) => {
            void send(ws, event.data)
          }
          remote.onerror = () => {
            ws.close(1011, "proxy error")
          }
          remote.onclose = (event) => {
            ws.close(event.code, event.reason)
          }
        },
        onMessage(event) {
          const raw = event.data
          if (typeof raw !== "string" && !(raw instanceof Uint8Array) && !(raw instanceof ArrayBuffer)) return
          const data: Msg = raw instanceof Uint8Array ? (raw.buffer as ArrayBuffer) : raw
          if (remote?.readyState === WebSocket.OPEN) {
            remote.send(data)
            return
          }
          queue.push(data)
        },
        onClose(event) {
          remote?.close(event.code, event.reason)
        },
      }
    }),
  )

const log = Log.create({ service: "server-proxy" })

function statusText(response: unknown) {
  return (response as { source?: Response }).source?.statusText
}

export function httpEffect(url: string | URL, extra: HeadersInit | undefined, req: Request, workspaceID: WorkspaceID) {
  return Effect.gen(function* () {
    // kilocode_change: await isSyncing (async) before checking
    const syncing = yield* Effect.promise(() => Workspace.isSyncing(workspaceID))
    if (!syncing) {
      return new Response(`broken sync connection for workspace: ${workspaceID}`, {
        status: 503,
        headers: {
          "content-type": "text/plain; charset=utf-8",
        },
      })
    }
    const response = yield* HttpClient.execute(
      HttpClientRequest.make(req.method as never)(url, {
        headers: ProxyUtil.headers(req, extra),
        body:
          req.method === "GET" || req.method === "HEAD"
            ? HttpBody.empty
            : HttpBody.raw(req.body, {
                contentType: req.headers.get("content-type") ?? undefined,
                contentLength: req.headers.get("content-length")
                  ? Number(req.headers.get("content-length"))
                  : undefined,
              }),
      }),
    )
    const next = new Headers(response.headers as HeadersInit)
    const sync = Fence.parse(next)
    next.delete("content-encoding")
    next.delete("content-length")

    if (sync) yield* Effect.promise(() => Fence.wait(workspaceID, sync, req.signal))
    const body = yield* Stream.toReadableStreamEffect(response.stream.pipe(Stream.catchCause(() => Stream.empty)))
    return new Response(body, {
      status: response.status,
      statusText: statusText(response),
      headers: next,
    })
  }).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.catch(() => Effect.succeed(new Response(null, { status: 500 }))),
  )
}

export function http(url: string | URL, extra: HeadersInit | undefined, req: Request, workspaceID: WorkspaceID) {
  return Effect.runPromise(httpEffect(url, extra, req, workspaceID))
}

export function websocket(
  upgrade: UpgradeWebSocket,
  target: string | URL,
  extra: HeadersInit | undefined,
  req: Request,
  env: unknown,
) {
  const proxy = new URL(req.url)
  proxy.pathname = "/__workspace_ws"
  proxy.search = ""
  const next = new Headers(req.headers)
  next.set("x-kilo-proxy-url", ProxyUtil.websocketTargetURL(target)) // kilocode_change header name
  for (const [key, value] of new Headers(extra).entries()) {
    next.set(key, value)
  }
  log.info("proxy websocket", {
    request: req.url,
    target: String(target),
  })
  return app(upgrade).fetch(
    new Request(proxy, {
      method: req.method,
      headers: next,
      signal: req.signal,
    }),
    env as never,
  )
}

export * as ServerProxy from "./proxy"
```

</details>


### packages/opencode/src/server/routes/instance/httpapi/groups/permission.ts

- Conflict: UU (content)
- Recommendation: manual - Code files need manual review for kilocode_change markers
- Base Hash: `8ddc4353358b`
- Ours Hash: `d8b8dc82354a`
- Theirs Hash: `3c7d00c67f09`
<details><summary>Original diff3 conflict</summary>

```diff
<<<<<<< HEAD:packages/opencode/src/server/routes/instance/httpapi/permission.ts
import { Effect, Layer, Schema } from "effect"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi" // kilocode_change
import { Authorization } from "./auth"
||||||| c00058ed7a:packages/opencode/src/server/routes/instance/httpapi/permission.ts
import { Effect, Layer, Schema } from "effect"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "./auth"
=======
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware } from "../middleware/workspace-routing"
import { described } from "./metadata"
>>>>>>> markijbema/opencode-v1.14.30:packages/opencode/src/server/routes/instance/httpapi/groups/permission.ts

<<<<<<< HEAD:packages/opencode/src/server/routes/instance/httpapi/permission.ts
// kilocode_change start
const SaveAlwaysRulesBody = Schema.Struct({
  approvedAlways: Schema.Array(Schema.String).pipe(Schema.optional),
  deniedAlways: Schema.Array(Schema.String).pipe(Schema.optional),
})
// kilocode_change end
||||||| c00058ed7a:packages/opencode/src/server/routes/instance/httpapi/permission.ts
=======
const ReplyPayload = Schema.Struct({
  reply: Permission.Reply,
  message: Schema.optional(Schema.String),
})
>>>>>>> markijbema/opencode-v1.14.30:packages/opencode/src/server/routes/instance/httpapi/groups/permission.ts

<<<<<<< HEAD:packages/opencode/src/server/routes/instance/httpapi/permission.ts
          payload: Permission.ReplyBody,
          success: Schema.Boolean,
          error: [HttpApiError.NotFoundNoContent],
||||||| c00058ed7a:packages/opencode/src/server/routes/instance/httpapi/permission.ts
          payload: Permission.ReplyBody,
          success: Schema.Boolean,
=======
          payload: ReplyPayload,
          success: described(Schema.Boolean, "Permission processed successfully"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
>>>>>>> markijbema/opencode-v1.14.30:packages/opencode/src/server/routes/instance/httpapi/groups/permission.ts

<<<<<<< HEAD:packages/opencode/src/server/routes/instance/httpapi/permission.ts

export const permissionHandlers = Layer.unwrap(
  Effect.gen(function* () {
    const svc = yield* Permission.Service

    const list = Effect.fn("PermissionHttpApi.list")(function* () {
      return yield* svc.list()
    })

    // kilocode_change start
    const reply = Effect.fn("PermissionHttpApi.reply")(function* (ctx: {
      params: { requestID: PermissionID }
      payload: Permission.ReplyBody
    }) {
      const ok = yield* svc.reply({
        requestID: ctx.params.requestID,
        reply: ctx.payload.reply,
        message: ctx.payload.message,
      })
      if (!ok) return yield* new HttpApiError.NotFound({})
      return true
    })
    // kilocode_change end

    // kilocode_change start
    const saveAlwaysRules = Effect.fn("PermissionHttpApi.saveAlwaysRules")(function* (ctx: {
      params: { requestID: PermissionID }
      payload: Schema.Schema.Type<typeof SaveAlwaysRulesBody>
    }) {
      const ok = yield* svc.saveAlwaysRules({
        requestID: ctx.params.requestID,
        approvedAlways: ctx.payload.approvedAlways ? [...ctx.payload.approvedAlways] : undefined,
        deniedAlways: ctx.payload.deniedAlways ? [...ctx.payload.deniedAlways] : undefined,
      })
      if (!ok) return yield* new HttpApiError.NotFound({})
      return true
    })
    // kilocode_change end

    return HttpApiBuilder.group(
      PermissionApi,
      "permission",
      (handlers) => handlers.handle("list", list).handle("reply", reply).handle("saveAlwaysRules", saveAlwaysRules), // kilocode_change
    )
  }),
).pipe(Layer.provide(Permission.defaultLayer))
||||||| c00058ed7a:packages/opencode/src/server/routes/instance/httpapi/permission.ts

export const permissionHandlers = Layer.unwrap(
  Effect.gen(function* () {
    const svc = yield* Permission.Service

    const list = Effect.fn("PermissionHttpApi.list")(function* () {
      return yield* svc.list()
    })

    const reply = Effect.fn("PermissionHttpApi.reply")(function* (ctx: {
      params: { requestID: PermissionID }
      payload: Permission.ReplyBody
    }) {
      yield* svc.reply({
        requestID: ctx.params.requestID,
        reply: ctx.payload.reply,
        message: ctx.payload.message,
      })
      return true
    })

    return HttpApiBuilder.group(PermissionApi, "permission", (handlers) =>
      handlers.handle("list", list).handle("reply", reply),
    )
  }),
).pipe(Layer.provide(Permission.defaultLayer))
=======
>>>>>>> markijbema/opencode-v1.14.30:packages/opencode/src/server/routes/instance/httpapi/groups/permission.ts
```

</details>

- Decision: hybrid
- Risk: medium
- Summary: Rewrite on upstream groups/handlers split, keep Kilo endpoints
- Rationale: Upstream split the old httpapi/permission.ts into groups/*.ts (API schema only) and handlers/*.ts (Effect Layer implementations) and switched to shared middlewares under middleware/. Rewrote groups/permission.ts following the groups/config.ts pattern and kept Kilo's saveAlwaysRules endpoint plus the reply endpoint's 404 contract (HttpApiError.NotFoundNoContent). Also updated handlers/permission.ts to port our reply() 404 return and saveAlwaysRules handler, re-exporting SaveAlwaysRulesBody as a type from the groups file so the handler file can use it.
- Target: packages/opencode/src/server/routes/instance/httpapi/groups/permission.ts
- Alternatives: take-ours would re-introduce HttpApiBuilder/Layer.unwrap in the groups file, breaking the new api.ts registration that expects a plain API; take-theirs drops Kilo saveAlwaysRules endpoint and the 404 contract on reply() that the TUI uses to clean up stale permission UI
- Verification: bun run typecheck
- Resolution Hash: `8f4d25766ba8`
<details><summary>Resolved content</summary>

```diff
import { Permission } from "@/permission"
import { PermissionID } from "@/permission/schema"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/permission"
// kilocode_change start
const SaveAlwaysRulesBody = Schema.Struct({
  approvedAlways: Schema.Array(Schema.String).pipe(Schema.optional),
  deniedAlways: Schema.Array(Schema.String).pipe(Schema.optional),
})
// kilocode_change end

export const PermissionApi = HttpApi.make("permission")
  .add(
    HttpApiGroup.make("permission")
      .add(
        HttpApiEndpoint.get("list", root, {
          success: described(Schema.Array(Permission.Request), "List of pending permissions"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "permission.list",
            summary: "List pending permissions",
            description: "Get all pending permission requests across all sessions.",
          }),
        ),
        // kilocode_change start - Kilo returns false/404 when request is gone
        HttpApiEndpoint.post("reply", `${root}/:requestID/reply`, {
          params: { requestID: PermissionID },
          payload: Permission.ReplyBody,
          success: described(Schema.Boolean, "Permission processed successfully"),
          error: [HttpApiError.NotFoundNoContent],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "permission.reply",
            summary: "Respond to permission request",
            description: "Approve or deny a permission request from the AI assistant.",
          }),
        ),
        // kilocode_change end
        // kilocode_change start
        HttpApiEndpoint.post("saveAlwaysRules", `${root}/:requestID/always-rules`, {
          params: { requestID: PermissionID },
          payload: SaveAlwaysRulesBody,
          success: Schema.Boolean,
          error: [HttpApiError.NotFoundNoContent],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "permission.saveAlwaysRules",
            summary: "Save always-allow/deny permission rules",
            description: "Save approved/denied always-rules for a pending permission request.",
          }),
        ),
        // kilocode_change end
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "permission",
          description: "Experimental HttpApi permission routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )

// kilocode_change start - re-export schema type for handler
export type SaveAlwaysRulesPayload = Schema.Schema.Type<typeof SaveAlwaysRulesBody>
// kilocode_change end
```

</details>


### packages/opencode/src/server/routes/instance/httpapi/server.ts

- Conflict: UU (content)
- Recommendation: manual - Code files need manual review for kilocode_change markers
- Base Hash: `69c5fa1bc92a`
- Ours Hash: `81875feb9546`
- Theirs Hash: `04333c44f1a8`
<details><summary>Original diff3 conflict</summary>

```diff
<<<<<<< HEAD

const Query = Schema.Struct({
  directory: Schema.optional(Schema.String),
  workspace: Schema.optional(Schema.String),
  auth_token: Schema.optional(Schema.String),
})

const Headers = Schema.Struct({
  authorization: Schema.optional(Schema.String),
  "x-kilo-directory": Schema.optional(Schema.String),
})
||||||| c00058ed7a

const Query = Schema.Struct({
  directory: Schema.optional(Schema.String),
  workspace: Schema.optional(Schema.String),
  auth_token: Schema.optional(Schema.String),
})

const Headers = Schema.Struct({
  authorization: Schema.optional(Schema.String),
  "x-opencode-directory": Schema.optional(Schema.String),
})
=======
import * as ServerBackend from "@/server/backend"
>>>>>>> markijbema/opencode-v1.14.30

<<<<<<< HEAD
function decode(input: string) {
  try {
    return decodeURIComponent(input)
  } catch {
    return input
  }
}

const instance = HttpRouter.middleware()(
  Effect.gen(function* () {
    return (effect) =>
      Effect.gen(function* () {
        const query = yield* HttpServerRequest.schemaSearchParams(Query)
        const headers = yield* HttpServerRequest.schemaHeaders(Headers)
        const raw = query.directory || headers["x-kilo-directory"] || process.cwd()
        const workspace = query.workspace || undefined
        const ctx = yield* Effect.promise(() =>
          Instance.provide({
            directory: Filesystem.resolve(decode(raw)),
            init: () => AppRuntime.runPromise(InstanceBootstrap),
            fn: () => Instance.current,
          }),
        )

        const next = workspace ? effect.pipe(Effect.provideService(WorkspaceRef, workspace)) : effect
        return yield* next.pipe(Effect.provideService(InstanceRef, ctx))
      })
  }),
||||||| c00058ed7a
function decode(input: string) {
  try {
    return decodeURIComponent(input)
  } catch {
    return input
  }
}

const instance = HttpRouter.middleware()(
  Effect.gen(function* () {
    return (effect) =>
      Effect.gen(function* () {
        const query = yield* HttpServerRequest.schemaSearchParams(Query)
        const headers = yield* HttpServerRequest.schemaHeaders(Headers)
        const raw = query.directory || headers["x-opencode-directory"] || process.cwd()
        const workspace = query.workspace || undefined
        const ctx = yield* Effect.promise(() =>
          Instance.provide({
            directory: Filesystem.resolve(decode(raw)),
            init: () => AppRuntime.runPromise(InstanceBootstrap),
            fn: () => Instance.current,
          }),
        )

        const next = workspace ? effect.pipe(Effect.provideService(WorkspaceRef, workspace)) : effect
        return yield* next.pipe(Effect.provideService(InstanceRef, ctx))
      })
  }),
=======
const runtime = HttpRouter.middleware()(
  Effect.succeed((effect) =>
    Effect.gen(function* () {
      const selected = ServerBackend.select()
      yield* Effect.annotateCurrentSpan(ServerBackend.attributes(ServerBackend.force(selected, "effect-httpapi")))
      return yield* effect
    }),
  ),
>>>>>>> markijbema/opencode-v1.14.30
```

</details>

- Decision: take-theirs
- Risk: medium
- Summary: Adopt upstream ServerBackend + middleware layer refactor
- Rationale: Upstream replaced the inline Instance/Workspace middleware with a ServerBackend.select()-driven runtime middleware and routed all instance/workspace scoping through the new authorizationLayer + instanceContextLayer + workspaceRoutingLayer (files already in tree with x-kilo-directory preserved). Since the new middleware files already read x-kilo-directory and ServerBackend.select() reads Flag.KILO_EXPERIMENTAL_HTTPAPI, the upstream server assembly works unchanged.
- Alternatives: take-ours would keep the local Query/Headers Schema and hand-rolled instance middleware, forking the entire httpapi assembly from upstream
- Verification: bun run typecheck
- Resolution Hash: `04333c44f1a8`
<details><summary>Resolved content</summary>

```diff
import { Context, Effect, Layer } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import * as Socket from "effect/unstable/socket/Socket"
import { Account } from "@/account/account"
import { Agent } from "@/agent/agent"
import { Auth } from "@/auth"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { Command } from "@/command"
import * as Observability from "@opencode-ai/core/effect/observability"
import { File } from "@/file"
import { Ripgrep } from "@/file/ripgrep"
import { Format } from "@/format"
import { LSP } from "@/lsp/lsp"
import { MCP } from "@/mcp"
import { Permission } from "@/permission"
import { Installation } from "@/installation"
import { Project } from "@/project/project"
import { ProviderAuth } from "@/provider/auth"
import { Provider } from "@/provider/provider"
import { Pty } from "@/pty"
import { Question } from "@/question"
import { Session } from "@/session/session"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { SessionSummary } from "@/session/summary"
import { Todo } from "@/session/todo"
import { Skill } from "@/skill"
import { ToolRegistry } from "@/tool/registry"
import { lazy } from "@/util/lazy"
import { Vcs } from "@/project/vcs"
import { Worktree } from "@/worktree"
import { InstanceHttpApi, RootHttpApi } from "./api"
import { authorizationLayer } from "./middleware/authorization"
import { eventRoute } from "./event"
import { configHandlers } from "./handlers/config"
import { controlHandlers } from "./handlers/control"
import { experimentalHandlers } from "./handlers/experimental"
import { fileHandlers } from "./handlers/file"
import { globalHandlers } from "./handlers/global"
import { instanceHandlers } from "./handlers/instance"
import { mcpHandlers } from "./handlers/mcp"
import { permissionHandlers } from "./handlers/permission"
import { projectHandlers } from "./handlers/project"
import { providerHandlers } from "./handlers/provider"
import { ptyConnectRoute, ptyHandlers } from "./handlers/pty"
import { questionHandlers } from "./handlers/question"
import { sessionHandlers } from "./handlers/session"
import { syncHandlers } from "./handlers/sync"
import { tuiHandlers } from "./handlers/tui"
import { workspaceHandlers } from "./handlers/workspace"
import { instanceContextLayer, instanceRouterMiddleware } from "./middleware/instance-context"
import { workspaceRouterMiddleware, workspaceRoutingLayer } from "./middleware/workspace-routing"
import { disposeMiddleware } from "./lifecycle"
import { memoMap } from "@opencode-ai/core/effect/memo-map"
import * as ServerBackend from "@/server/backend"

export const context = Context.empty() as Context.Context<unknown>

const runtime = HttpRouter.middleware()(
  Effect.succeed((effect) =>
    Effect.gen(function* () {
      const selected = ServerBackend.select()
      yield* Effect.annotateCurrentSpan(ServerBackend.attributes(ServerBackend.force(selected, "effect-httpapi")))
      return yield* effect
    }),
  ),
).layer

const rootApiRoutes = HttpApiBuilder.layer(RootHttpApi).pipe(Layer.provide([controlHandlers, globalHandlers]))
const instanceApiRoutes = HttpApiBuilder.layer(InstanceHttpApi).pipe(
  Layer.provide([
    configHandlers,
    experimentalHandlers,
    fileHandlers,
    instanceHandlers,
    mcpHandlers,
    projectHandlers,
    ptyHandlers,
    questionHandlers,
    permissionHandlers,
    providerHandlers,
    sessionHandlers,
    syncHandlers,
    tuiHandlers,
    workspaceHandlers,
  ]),
)

const rawInstanceRoutes = Layer.mergeAll(eventRoute, ptyConnectRoute).pipe(
  Layer.provide(
    instanceRouterMiddleware
      .combine(workspaceRouterMiddleware)
      .layer.pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal)),
  ),
)
const instanceRoutes = Layer.mergeAll(rawInstanceRoutes, instanceApiRoutes).pipe(
  Layer.provide([
    authorizationLayer,
    workspaceRoutingLayer.pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal)),
    instanceContextLayer,
  ]),
)

export const routes = Layer.mergeAll(rootApiRoutes, instanceRoutes).pipe(
  Layer.provide([
    runtime,
    Account.defaultLayer,
    Agent.defaultLayer,
    Auth.defaultLayer,
    Command.defaultLayer,
    Config.defaultLayer,
    File.defaultLayer,
    Format.defaultLayer,
    LSP.defaultLayer,
    Installation.defaultLayer,
    MCP.defaultLayer,
    Permission.defaultLayer,
    Project.defaultLayer,
    ProviderAuth.defaultLayer,
    Provider.defaultLayer,
    Pty.defaultLayer,
    Question.defaultLayer,
    Ripgrep.defaultLayer,
    Session.defaultLayer,
    SessionRunState.defaultLayer,
    SessionStatus.defaultLayer,
    SessionSummary.defaultLayer,
    Skill.defaultLayer,
    Todo.defaultLayer,
    ToolRegistry.defaultLayer,
    Vcs.defaultLayer,
    Worktree.defaultLayer,
    Bus.layer,
    HttpServer.layerServices,
  ]),
  Layer.provideMerge(Observability.layer),
)

export const webHandler = lazy(() =>
  HttpRouter.toWebHandler(routes, {
    memoMap,
    middleware: disposeMiddleware,
  }),
)

export * as ExperimentalHttpApiServer from "./server"
```

</details>


### packages/opencode/src/server/server.ts

- Conflict: UU (content)
- Recommendation: manual - Code files need manual review for kilocode_change markers
- Base Hash: `a1e82a191005`
- Ours Hash: `6dd905872b60`
- Theirs Hash: `33b6cfe9dfea`
<details><summary>Original diff3 conflict</summary>

```diff
<<<<<<< HEAD
const DefaultHono = lazy(() => createHono({}))
const DefaultHttpApi = lazy(() => createHttpApi())
export const Default = () => (Flag.KILO_EXPERIMENTAL_HTTPAPI ? DefaultHttpApi() : DefaultHono())
||||||| c00058ed7a
const DefaultHono = lazy(() => createHono({}))
const DefaultHttpApi = lazy(() => createHttpApi())
export const Default = () => (Flag.OPENCODE_EXPERIMENTAL_HTTPAPI ? DefaultHttpApi() : DefaultHono())
=======
const DefaultHono = lazy(() =>
  withBackend({ backend: "hono", reason: "stable" }, createHono({}, { backend: "hono", reason: "stable" })),
)
const DefaultHttpApi = lazy(() => createDefaultHttpApi())

function select() {
  return ServerBackend.select()
}

export const backend = select

export const Default = () => {
  const selected = select()
  return selected.backend === "effect-httpapi" ? DefaultHttpApi() : DefaultHono()
}
>>>>>>> markijbema/opencode-v1.14.30

<<<<<<< HEAD
  if (Flag.KILO_EXPERIMENTAL_HTTPAPI) return createHttpApi()
  return createHono(opts)
||||||| c00058ed7a
  if (Flag.OPENCODE_EXPERIMENTAL_HTTPAPI) return createHttpApi()
  return createHono(opts)
=======
  const selected = select()
  return selected.backend === "effect-httpapi"
    ? withBackend(selected, createHttpApi())
    : withBackend(selected, createHono(opts, selected))
}

export function Legacy(opts: { cors?: string[] } = {}) {
  return withBackend({ backend: "hono", reason: "explicit" }, createHono(opts, { backend: "hono", reason: "explicit" }))
}

function createDefaultHttpApi() {
  return withBackend(select(), createHttpApi())
}

function withBackend<T extends { app: ServerApp; runtime: unknown }>(selection: ServerBackend.Selection, built: T) {
  log.info("server backend selected", ServerBackend.attributes(selection))
  return built
>>>>>>> markijbema/opencode-v1.14.30
```

</details>

- Decision: take-theirs
- Risk: low
- Summary: Adopt upstream ServerBackend-based server selection
- Rationale: Upstream moved from a single Flag.OPENCODE_EXPERIMENTAL_HTTPAPI check to ServerBackend.select() which returns {backend, reason} and powers the new Legacy()/createDefaultHttpApi()/withBackend() helpers plus backend logging. ServerBackend.select() already reads our Kilo-renamed Flag.KILO_EXPERIMENTAL_HTTPAPI, so taking upstream's code preserves our gating without code duplication. Flag.KILO_WORKSPACE_ID branch below the conflict is untouched.
- Alternatives: take-ours would keep the flag-only selector and miss the backend-selection logging, Legacy() export, and withBackend observability
- Verification: bun run typecheck; bun test test/server/httpapi-bridge.test.ts
- Resolution Hash: `3b79ba4e3cfc`
<details><summary>Resolved content</summary>

```diff
import { generateSpecs } from "hono-openapi"
import { Hono } from "hono"
import { adapter } from "#hono"
import { lazy } from "@/util/lazy"
import * as Log from "@opencode-ai/core/util/log"
import { Flag } from "@opencode-ai/core/flag/flag"
import { WorkspaceID } from "@/control-plane/schema"
import { MDNS } from "./mdns"
import { AuthMiddleware, CompressionMiddleware, CorsMiddleware, ErrorMiddleware, LoggerMiddleware } from "./middleware"
import { FenceMiddleware } from "./fence"
import { initProjectors } from "./projectors"
import { InstanceRoutes } from "./routes/instance"
import { ControlPlaneRoutes } from "./routes/control"
import { UIRoutes } from "./routes/ui"
import { GlobalRoutes } from "./routes/global"
import { WorkspaceRouterMiddleware } from "./workspace"
import { InstanceMiddleware } from "./routes/instance/middleware"
import { WorkspaceRoutes } from "./routes/control/workspace"
import * as KiloServer from "@/kilocode/server/server" // kilocode_change
import { ExperimentalHttpApiServer } from "./routes/instance/httpapi/server"
import * as ServerBackend from "./backend"

// @ts-ignore This global is needed to prevent ai-sdk from logging warnings to stdout https://github.com/vercel/ai/blob/2dc67e0ef538307f21368db32d5a12345d98831b/packages/ai/src/logger/log-warnings.ts#L85
globalThis.AI_SDK_LOG_WARNINGS = false

initProjectors()

const log = Log.create({ service: "server" })

export type Listener = {
  hostname: string
  port: number
  url: URL
  stop: (close?: boolean) => Promise<void>
}

type ServerApp = {
  fetch(request: Request): Response | Promise<Response>
  request(input: string | URL | Request, init?: RequestInit): Response | Promise<Response>
}

const DefaultHono = lazy(() =>
  withBackend({ backend: "hono", reason: "stable" }, createHono({}, { backend: "hono", reason: "stable" })),
)
const DefaultHttpApi = lazy(() => createDefaultHttpApi())

function select() {
  return ServerBackend.select()
}

export const backend = select

export const Default = () => {
  const selected = select()
  return selected.backend === "effect-httpapi" ? DefaultHttpApi() : DefaultHono()
}

function create(opts: { cors?: string[] }) {
  const selected = select()
  return selected.backend === "effect-httpapi"
    ? withBackend(selected, createHttpApi())
    : withBackend(selected, createHono(opts, selected))
}

export function Legacy(opts: { cors?: string[] } = {}) {
  return withBackend({ backend: "hono", reason: "explicit" }, createHono(opts, { backend: "hono", reason: "explicit" }))
}

function createDefaultHttpApi() {
  return withBackend(select(), createHttpApi())
}

function withBackend<T extends { app: ServerApp; runtime: unknown }>(selection: ServerBackend.Selection, built: T) {
  log.info("server backend selected", ServerBackend.attributes(selection))
  return built
}

function createHttpApi() {
  const handler = ExperimentalHttpApiServer.webHandler().handler
  const app: ServerApp = {
    fetch: (request: Request) => handler(request, ExperimentalHttpApiServer.context),
    request(input, init) {
      return app.fetch(input instanceof Request ? input : new Request(new URL(input, "http://localhost"), init))
    },
  }
  return {
    app,
    runtime: adapter.createFetch(app),
  }
}

function createHono(
  opts: { cors?: string[] },
  selection: ServerBackend.Selection = ServerBackend.force(select(), "hono"),
) {
  const backendAttributes = ServerBackend.attributes(selection)
  const app = new Hono()
    .onError(ErrorMiddleware)
    .use(AuthMiddleware)
    .use(LoggerMiddleware(backendAttributes))
    .use(CompressionMiddleware)
    .use(CorsMiddleware(opts))
    .route("/global", GlobalRoutes())

  const runtime = adapter.create(app)

  if (Flag.KILO_WORKSPACE_ID) {
    return {
      app: app
        .use(InstanceMiddleware(Flag.KILO_WORKSPACE_ID ? WorkspaceID.make(Flag.KILO_WORKSPACE_ID) : undefined))
        .use(FenceMiddleware)
        .route("/", InstanceRoutes(runtime.upgradeWebSocket)),
      runtime,
    }
  }

  const workspaceApp = new Hono()
  const workspaceLegacyApp = new Hono()
    .use(InstanceMiddleware())
    .route("/experimental/workspace", WorkspaceRoutes())
    .use(WorkspaceRouterMiddleware(runtime.upgradeWebSocket))
  workspaceApp.route("/", workspaceLegacyApp)

  return {
    app: app
      .route("/", ControlPlaneRoutes())
      .route("/", workspaceApp)
      .route("/", InstanceRoutes(runtime.upgradeWebSocket))
      .route("/", UIRoutes()),
    runtime,
  }
}

export async function openapi() {
  // Build a fresh app with all routes registered directly so
  // hono-openapi can see describeRoute metadata (`.route()` wraps
  // handlers when the sub-app has a custom errorHandler, which
  // strips the metadata symbol).
  const { app } = createHono({})
  const result = await generateSpecs(app, {
    documentation: {
      info: {
        title: KiloServer.DOC_TITLE, // kilocode_change
        version: "1.0.0",
        description: KiloServer.DOC_DESCRIPTION, // kilocode_change
      },
      openapi: "3.1.1",
    },
  })
  return result
}

export let url: URL

export async function listen(opts: {
  port: number
  hostname: string
  mdns?: boolean
  mdnsDomain?: string
  cors?: string[]
}): Promise<Listener> {
  const built = create(opts)
  const server = await built.runtime.listen(opts)

  const next = new URL("http://localhost")
  next.hostname = opts.hostname
  next.port = String(server.port)
  url = next

  const mdns =
    opts.mdns &&
    server.port &&
    opts.hostname !== "127.0.0.1" &&
    opts.hostname !== "localhost" &&
    opts.hostname !== "::1"
  if (mdns) {
    MDNS.publish(server.port, opts.mdnsDomain)
  } else if (opts.mdns) {
    log.warn("mDNS enabled but hostname is loopback; skipping mDNS publish")
  }

  let closing: Promise<void> | undefined
  return {
    hostname: opts.hostname,
    port: server.port,
    url: next,
    stop(close?: boolean) {
      closing ??= (async () => {
        if (mdns) MDNS.unpublish()
        await server.stop(close)
      })()
      return closing
    },
  }
}

export * as Server from "./server"
```

</details>


### packages/opencode/src/session/session.ts

- Conflict: UU (content)
- Recommendation: manual - Code files need manual review for kilocode_change markers
- Base Hash: `d7766a7c0e0a`
- Ours Hash: `9ebe7de92353`
- Theirs Hash: `e44ab3cffd16`
<details><summary>Original diff3 conflict</summary>

```diff
<<<<<<< HEAD
// kilocode_change - drop unused inArray/lt (listGlobal delegated to KiloSession)
import { eq, and, gte, isNull, desc, like } from "drizzle-orm"
||||||| c00058ed7a
import { eq } from "drizzle-orm"
import { and } from "drizzle-orm"
import { gte } from "drizzle-orm"
import { isNull } from "drizzle-orm"
import { desc } from "drizzle-orm"
import { like } from "drizzle-orm"
import { inArray } from "drizzle-orm"
import { lt } from "drizzle-orm"
=======
import { eq } from "drizzle-orm"
import { and } from "drizzle-orm"
import { gte } from "drizzle-orm"
import { isNull } from "drizzle-orm"
import { desc } from "drizzle-orm"
import { like } from "drizzle-orm"
import { inArray } from "drizzle-orm"
import { lt } from "drizzle-orm"
import { or } from "drizzle-orm"
>>>>>>> markijbema/opencode-v1.14.30

<<<<<<< HEAD
  additions: Schema.Number,
  deletions: Schema.Number,
  files: Schema.Number,
  diffs: optionalOmitUndefined(Schema.Array(Snapshot.SummaryFileDiff)), // kilocode_change - lightweight diff without patch
||||||| c00058ed7a
  additions: Schema.Number,
  deletions: Schema.Number,
  files: Schema.Number,
  diffs: optionalOmitUndefined(Schema.Array(Snapshot.FileDiff)),
=======
  additions: NonNegativeInt,
  deletions: NonNegativeInt,
  files: NonNegativeInt,
  diffs: optionalOmitUndefined(Schema.Array(Snapshot.FileDiff)),
>>>>>>> markijbema/opencode-v1.14.30

<<<<<<< HEAD
  // kilocode_change start - directory filtering handled by KiloSession.filters above
  // if (!Flag.KILO_EXPERIMENTAL_WORKSPACES) {
  //   if (input?.directory) {
  //     conditions.push(eq(SessionTable.directory, input.directory))
  //   }
  // }
  // kilocode_change end

||||||| c00058ed7a
  if (!Flag.OPENCODE_EXPERIMENTAL_WORKSPACES) {
    if (input?.directory) {
      conditions.push(eq(SessionTable.directory, input.directory))
    }
  }
=======
  if (input?.path !== undefined) {
    if (input.path) {
      const conds = [eq(SessionTable.path, input.path), like(SessionTable.path, `${input.path}/%`)]

      conditions.push(
        input.directory
          ? or(...conds, and(isNull(SessionTable.path), eq(SessionTable.directory, input.directory))!)!
          : or(...conds)!,
      )
    }
  } else if (input?.scope !== "project" && !Flag.KILO_EXPERIMENTAL_WORKSPACES) {
    if (input?.directory) {
      conditions.push(eq(SessionTable.directory, input.directory))
    }
  }
>>>>>>> markijbema/opencode-v1.14.30
```

</details>

- Decision: hybrid
- Risk: medium
- Summary: Adopt upstream path filter + NonNegativeInt, keep Kilo Summary diff + filters
- Rationale: Three conflicts: (1) imports — keep our consolidated drizzle-orm import and add upstream's 'or' since list() uses it; (2) Summary schema — take upstream's NonNegativeInt validation for additions/deletions/files but keep our Snapshot.SummaryFileDiff (patchless, used to keep payloads small for TUI); (3) list() filtering — keep KiloSession.filters (provides projectID+directory scoping) and port upstream's new 'path' input branch for path-prefix matching, dropping the redundant directory else branch since KiloSession.filters already covers it.
- Alternatives: take-ours drops upstream's path-based filter and NonNegativeInt validation; take-theirs drops KiloSession.filters (projectID scoping) and the SummaryFileDiff patch-stripping that keeps summary payloads small
- Verification: bun run typecheck; bun test test/session
- Resolution Hash: `d314a541251a`
<details><summary>Resolved content</summary>

```diff
import { Slug } from "@opencode-ai/core/util/slug"
import path from "path"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Decimal } from "decimal.js"
import z from "zod"
import { type ProviderMetadata, type LanguageModelUsage } from "ai"
import { Flag } from "@opencode-ai/core/flag/flag"
import { InstallationVersion } from "@opencode-ai/core/installation/version"

import { Database } from "@/storage/db"
import { NotFoundError } from "@/storage/storage"
// kilocode_change - drop unused inArray/lt (listGlobal delegated to KiloSession)
import { eq, and, gte, isNull, desc, like, or } from "drizzle-orm"
import { SyncEvent } from "../sync"
import { PartTable, SessionTable } from "./session.sql"
// kilocode_change - ProjectTable removed (unused)
import { Storage } from "@/storage/storage"
import * as Log from "@opencode-ai/core/util/log"
import { MessageV2 } from "./message-v2"
import { Instance } from "../project/instance"
import { InstanceState } from "@/effect/instance-state"
import { Snapshot } from "@/snapshot"
import { ProjectID } from "../project/schema"
import { WorkspaceID } from "../control-plane/schema"
import { SessionID, MessageID, PartID } from "./schema"

import type { Provider } from "@/provider/provider"
import { Permission } from "@/permission"
import { Global } from "@opencode-ai/core/global"
// kilocode_change start - legacy promise helpers + kilocode extensions
import { makeRuntime } from "@/effect/run-service"
import { KiloSession, kiloSessionFork } from "@/kilocode/session"
import { fn } from "@/util/fn"
// kilocode_change end
import { Effect, Layer, Option, Context, Schema, Types } from "effect"
import { zod } from "@/util/effect-zod"
import { NonNegativeInt, optionalOmitUndefined, withStatics } from "@/util/schema"

const log = Log.create({ service: "session" })

const parentTitlePrefix = "New session - "
const childTitlePrefix = "Child session - "

function createDefaultTitle(isChild = false) {
  return (isChild ? childTitlePrefix : parentTitlePrefix) + new Date().toISOString()
}

export function isDefaultTitle(title: string) {
  return new RegExp(
    `^(${parentTitlePrefix}|${childTitlePrefix})\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$`,
  ).test(title)
}

type SessionRow = typeof SessionTable.$inferSelect

export function fromRow(row: SessionRow): Info {
  const summary =
    row.summary_additions !== null || row.summary_deletions !== null || row.summary_files !== null
      ? {
          additions: row.summary_additions ?? 0,
          deletions: row.summary_deletions ?? 0,
          files: row.summary_files ?? 0,
          diffs: row.summary_diffs ?? undefined,
        }
      : undefined
  const share = row.share_url ? { url: row.share_url } : undefined
  const revert = row.revert ?? undefined
  return {
    id: row.id,
    slug: row.slug,
    projectID: row.project_id,
    workspaceID: row.workspace_id ?? undefined,
    directory: row.directory,
    path: row.path ?? undefined,
    parentID: row.parent_id ?? undefined,
    title: row.title,
    version: row.version,
    summary,
    share,
    revert,
    permission: row.permission ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      compacting: row.time_compacting ?? undefined,
      archived: row.time_archived ?? undefined,
    },
  }
}

export function toRow(info: Info) {
  return {
    id: info.id,
    project_id: info.projectID,
    workspace_id: info.workspaceID,
    parent_id: info.parentID,
    slug: info.slug,
    directory: info.directory,
    path: info.path,
    title: info.title,
    version: info.version,
    share_url: info.share?.url,
    summary_additions: info.summary?.additions,
    summary_deletions: info.summary?.deletions,
    summary_files: info.summary?.files,
    summary_diffs: info.summary?.diffs,
    revert: info.revert ?? null,
    permission: info.permission,
    time_created: info.time.created,
    time_updated: info.time.updated,
    time_compacting: info.time.compacting,
    time_archived: info.time.archived,
  }
}

function getForkedTitle(title: string): string {
  const match = title.match(/^(.+) \(fork #(\d+)\)$/)
  if (match) {
    const base = match[1]
    const num = parseInt(match[2], 10)
    return `${base} (fork #${num + 1})`
  }
  return `${title} (fork #1)`
}

function sessionPath(worktree: string, cwd: string) {
  return path.relative(path.resolve(worktree), cwd).replaceAll("\\", "/")
}

const Summary = Schema.Struct({
  additions: NonNegativeInt,
  deletions: NonNegativeInt,
  files: NonNegativeInt,
  diffs: optionalOmitUndefined(Schema.Array(Snapshot.SummaryFileDiff)), // kilocode_change - lightweight diff without patch
})

const Share = Schema.Struct({
  url: Schema.String,
})

const Time = Schema.Struct({
  created: NonNegativeInt,
  updated: NonNegativeInt,
  compacting: optionalOmitUndefined(NonNegativeInt),
  archived: optionalOmitUndefined(NonNegativeInt),
})

const Revert = Schema.Struct({
  messageID: MessageID,
  partID: optionalOmitUndefined(PartID),
  snapshot: optionalOmitUndefined(Schema.String),
  diff: optionalOmitUndefined(Schema.String),
})

export const Info = Schema.Struct({
  id: SessionID,
  slug: Schema.String,
  projectID: ProjectID,
  workspaceID: optionalOmitUndefined(WorkspaceID),
  directory: Schema.String,
  path: optionalOmitUndefined(Schema.String),
  parentID: optionalOmitUndefined(SessionID),
  summary: optionalOmitUndefined(Summary),
  share: optionalOmitUndefined(Share),
  title: Schema.String,
  version: Schema.String,
  time: Time,
  permission: optionalOmitUndefined(Permission.Ruleset),
  revert: optionalOmitUndefined(Revert),
})
  .annotate({ identifier: "Session" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Info = Types.DeepMutable<Schema.Schema.Type<typeof Info>>

export const ProjectInfo = Schema.Struct({
  id: ProjectID,
  name: optionalOmitUndefined(Schema.String),
  worktree: Schema.String,
})
  .annotate({ identifier: "ProjectSummary" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type ProjectInfo = Types.DeepMutable<Schema.Schema.Type<typeof ProjectInfo>>

export const GlobalInfo = Schema.Struct({
  ...Info.fields,
  project: Schema.NullOr(ProjectInfo),
  worktreeName: Schema.optional(Schema.String), // kilocode_change - basename of the specific worktree directory
})
  .annotate({ identifier: "GlobalSession" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type GlobalInfo = Types.DeepMutable<Schema.Schema.Type<typeof GlobalInfo>>

export const CreateInput = Schema.optional(
  Schema.Struct({
    parentID: Schema.optional(SessionID),
    title: Schema.optional(Schema.String),
    permission: Schema.optional(Permission.Ruleset),
    platform: Schema.optional(Schema.String), // kilocode_change - per-session platform override for telemetry attribution
    workspaceID: Schema.optional(WorkspaceID),
  }),
).pipe(withStatics((s) => ({ zod: zod(s) })))
export type CreateInput = Types.DeepMutable<Schema.Schema.Type<typeof CreateInput>>

export const ForkInput = Schema.Struct({
  sessionID: SessionID,
  messageID: Schema.optional(MessageID),
}).pipe(withStatics((s) => ({ zod: zod(s) })))
export const GetInput = SessionID
export const ChildrenInput = SessionID
export const RemoveInput = SessionID
export const SetTitleInput = Schema.Struct({ sessionID: SessionID, title: Schema.String }).pipe(
  withStatics((s) => ({ zod: zod(s) })),
)
export const SetArchivedInput = Schema.Struct({
  sessionID: SessionID,
  time: Schema.optional(NonNegativeInt),
}).pipe(withStatics((s) => ({ zod: zod(s) })))
export const SetPermissionInput = Schema.Struct({
  sessionID: SessionID,
  permission: Permission.Ruleset,
}).pipe(withStatics((s) => ({ zod: zod(s) })))
export const SetRevertInput = Schema.Struct({
  sessionID: SessionID,
  revert: Schema.optional(Revert),
  summary: Schema.optional(Summary),
}).pipe(withStatics((s) => ({ zod: zod(s) })))
export const MessagesInput = Schema.Struct({
  sessionID: SessionID,
  limit: Schema.optional(NonNegativeInt),
}).pipe(withStatics((s) => ({ zod: zod(s) })))

const CreatedEventSchema = Schema.Struct({
  sessionID: SessionID,
  info: Info,
})

const UpdatedShare = Schema.Struct({
  url: Schema.optional(Schema.NullOr(Schema.String)),
})

const UpdatedTime = Schema.Struct({
  created: Schema.optional(Schema.NullOr(NonNegativeInt)),
  updated: Schema.optional(Schema.NullOr(NonNegativeInt)),
  compacting: Schema.optional(Schema.NullOr(NonNegativeInt)),
  archived: Schema.optional(Schema.NullOr(NonNegativeInt)),
})

const UpdatedInfo = Schema.Struct({
  id: Schema.optional(Schema.NullOr(SessionID)),
  slug: Schema.optional(Schema.NullOr(Schema.String)),
  projectID: Schema.optional(Schema.NullOr(ProjectID)),
  workspaceID: Schema.optional(Schema.NullOr(WorkspaceID)),
  directory: Schema.optional(Schema.NullOr(Schema.String)),
  path: Schema.optional(Schema.NullOr(Schema.String)),
  parentID: Schema.optional(Schema.NullOr(SessionID)),
  summary: Schema.optional(Schema.NullOr(Summary)),
  share: Schema.optional(UpdatedShare),
  title: Schema.optional(Schema.NullOr(Schema.String)),
  version: Schema.optional(Schema.NullOr(Schema.String)),
  time: Schema.optional(UpdatedTime),
  permission: Schema.optional(Schema.NullOr(Permission.Ruleset)),
  revert: Schema.optional(Schema.NullOr(Revert)),
})

const UpdatedEventSchema = Schema.Struct({
  sessionID: SessionID,
  info: UpdatedInfo,
})

export const Event = {
  Created: SyncEvent.define({
    type: "session.created",
    version: 1,
    aggregate: "sessionID",
    schema: CreatedEventSchema,
  }),
  Updated: SyncEvent.define({
    type: "session.updated",
    version: 1,
    aggregate: "sessionID",
    schema: UpdatedEventSchema,
    busSchema: CreatedEventSchema,
  }),
  Deleted: SyncEvent.define({
    type: "session.deleted",
    version: 1,
    aggregate: "sessionID",
    schema: CreatedEventSchema,
  }),
  Diff: BusEvent.define(
    "session.diff",
    Schema.Struct({
      sessionID: SessionID,
      diff: Schema.Array(Snapshot.FileDiff),
    }),
  ),
  Error: BusEvent.define(
    "session.error",
    Schema.Struct({
      sessionID: Schema.optional(SessionID),
      // Reuses MessageV2.Assistant.fields.error (already Schema.optional) so
      // the derived zod keeps the same discriminated-union shape on the bus.
      error: MessageV2.Assistant.fields.error,
    }),
  ),
  // kilocode_change start
  TurnOpen: KiloSession.Event.TurnOpen,
  TurnClose: KiloSession.Event.TurnClose,
  // kilocode_change end
}

export function plan(input: { slug: string; time: { created: number } }) {
  const base = Instance.project.vcs
    ? path.join(Instance.worktree, ".kilo", "plans") // kilocode_change
    : path.join(Global.Path.data, "plans")
  return path.join(base, [input.time.created, input.slug].join("-") + ".md")
}

export const getUsage = (input: {
  model: Provider.Model
  usage: LanguageModelUsage
  metadata?: ProviderMetadata
  provider?: Provider.Info // kilocode_change
}) => {
  const safe = (value: number) => {
    if (!Number.isFinite(value)) return 0
    return value
  }
  const inputTokens = safe(input.usage.inputTokens ?? 0)
  const outputTokens = safe(input.usage.outputTokens ?? 0)
  const reasoningTokens = safe(input.usage.outputTokenDetails?.reasoningTokens ?? input.usage.reasoningTokens ?? 0)

  const cacheReadInputTokens = safe(
    input.usage.inputTokenDetails?.cacheReadTokens ?? input.usage.cachedInputTokens ?? 0,
  )
  const cacheWriteInputTokens = safe(
    Number(
      input.usage.inputTokenDetails?.cacheWriteTokens ??
        input.metadata?.["anthropic"]?.["cacheCreationInputTokens"] ??
        // google-vertex-anthropic returns metadata under "vertex" key
        // (AnthropicMessagesLanguageModel custom provider key from 'vertex.anthropic.messages')
        input.metadata?.["vertex"]?.["cacheCreationInputTokens"] ??
        // @ts-expect-error
        input.metadata?.["bedrock"]?.["usage"]?.["cacheWriteInputTokens"] ??
        // @ts-expect-error
        input.metadata?.["venice"]?.["usage"]?.["cacheCreationInputTokens"] ??
        0,
    ),
  )

  // AI SDK v6 normalized inputTokens to include cached tokens across all providers
  // (including Anthropic/Bedrock which previously excluded them). Always subtract cache
  // tokens to get the non-cached input count for separate cost calculation.
  const adjustedInputTokens = safe(inputTokens - cacheReadInputTokens - cacheWriteInputTokens)

  const total = input.usage.totalTokens

  const tokens = {
    total,
    input: adjustedInputTokens,
    output: safe(outputTokens - reasoningTokens),
    reasoning: reasoningTokens,
    cache: {
      write: cacheWriteInputTokens,
      read: cacheReadInputTokens,
    },
  }

  // kilocode_change start - Use provider-reported cost when available for OpenRouter/Kilo
  const reported = KiloSession.providerCost({
    metadata: input.metadata,
    provider: input.provider,
    providerID: input.model.providerID,
  })
  if (reported !== undefined) return { cost: safe(reported), tokens }
  // kilocode_change end

  const costInfo =
    input.model.cost?.experimentalOver200K && tokens.input + tokens.cache.read > 200_000
      ? input.model.cost.experimentalOver200K
      : input.model.cost
  return {
    cost: safe(
      new Decimal(0)
        .add(new Decimal(tokens.input).mul(costInfo?.input ?? 0).div(1_000_000))
        .add(new Decimal(tokens.output).mul(costInfo?.output ?? 0).div(1_000_000))
        .add(new Decimal(tokens.cache.read).mul(costInfo?.cache?.read ?? 0).div(1_000_000))
        .add(new Decimal(tokens.cache.write).mul(costInfo?.cache?.write ?? 0).div(1_000_000))
        // TODO: update models.dev to have better pricing model, for now:
        // charge reasoning tokens at the same rate as output tokens
        .add(new Decimal(tokens.reasoning).mul(costInfo?.output ?? 0).div(1_000_000))
        .toNumber(),
    ),
    tokens,
  }
}

export class BusyError extends Error {
  constructor(public readonly sessionID: string) {
    super(`Session ${sessionID} is busy`)
  }
}

export interface Interface {
  readonly create: (input?: {
    parentID?: SessionID
    title?: string
    permission?: Permission.Ruleset
    platform?: string // kilocode_change - per-session platform override for telemetry attribution
    workspaceID?: WorkspaceID
  }) => Effect.Effect<Info>
  readonly fork: (input: { sessionID: SessionID; messageID?: MessageID }) => Effect.Effect<Info>
  readonly touch: (sessionID: SessionID) => Effect.Effect<void>
  readonly get: (id: SessionID) => Effect.Effect<Info>
  readonly setTitle: (input: { sessionID: SessionID; title: string }) => Effect.Effect<void>
  readonly setArchived: (input: { sessionID: SessionID; time?: number }) => Effect.Effect<void>
  readonly setPermission: (input: { sessionID: SessionID; permission: Permission.Ruleset }) => Effect.Effect<void>
  readonly setRevert: (input: {
    sessionID: SessionID
    revert: Info["revert"]
    summary: Info["summary"]
  }) => Effect.Effect<void>
  readonly clearRevert: (sessionID: SessionID) => Effect.Effect<void>
  readonly setSummary: (input: { sessionID: SessionID; summary: Info["summary"] }) => Effect.Effect<void>
  readonly diff: (sessionID: SessionID) => Effect.Effect<Snapshot.FileDiff[]>
  readonly messages: (input: { sessionID: SessionID; limit?: number }) => Effect.Effect<MessageV2.WithParts[]>
  readonly children: (parentID: SessionID) => Effect.Effect<Info[]>
  readonly remove: (sessionID: SessionID) => Effect.Effect<void>
  readonly updateMessage: <T extends MessageV2.Info>(msg: T) => Effect.Effect<T>
  readonly removeMessage: (input: { sessionID: SessionID; messageID: MessageID }) => Effect.Effect<MessageID>
  readonly removePart: (input: { sessionID: SessionID; messageID: MessageID; partID: PartID }) => Effect.Effect<PartID>
  readonly getPart: (input: {
    sessionID: SessionID
    messageID: MessageID
    partID: PartID
  }) => Effect.Effect<MessageV2.Part |

... truncated after 16000 characters ...
```

</details>


### packages/opencode/src/tool/bash.ts

- Conflict: UU (content)
- Recommendation: manual - Code files need manual review for kilocode_change markers
- Base Hash: `89d62cebd0b1`
- Ours Hash: `a55ca87d3aa0`
- Theirs Hash: `dd9def136583`
<details><summary>Original diff3 conflict</summary>

```diff
<<<<<<< HEAD
              const root = yield* parse(params.command, ps)
              const scan = yield* collect(root, cwd, ps, shell)
              // kilocode_change start
              if (!Instance.containsPath(cwd)) {
                scan.dirs.add(cwd)
                scan.access = "unknown"
              }
              // kilocode_change end
              yield* ask(ctx, scan, params.command) // kilocode_change
||||||| c00058ed7a
              const root = yield* parse(params.command, ps)
              const scan = yield* collect(root, cwd, ps, shell)
              if (!Instance.containsPath(cwd)) scan.dirs.add(cwd)
              yield* ask(ctx, scan)
=======
              yield* Effect.scoped(
                Effect.gen(function* () {
                  const tree = yield* Effect.acquireRelease(parse(params.command, ps), (tree) =>
                    Effect.sync(() => tree.delete()),
                  )
                  const scan = yield* collect(tree.rootNode, cwd, ps, shell)
                  if (!Instance.containsPath(cwd)) scan.dirs.add(cwd)
                  yield* ask(ctx, scan)
                }),
              )
>>>>>>> markijbema/opencode-v1.14.30
```

</details>

- Decision: hybrid
- Risk: medium
- Summary: Adopt upstream scoped tree release, keep Kilo scan.access + command metadata
- Rationale: Upstream wrapped the parse/collect/ask flow in Effect.scoped with acquireRelease so the tree-sitter parse tree is always deleted. Kilo previously set scan.access = 'unknown' when the cwd was outside the Instance (so the ask() permission prompt surfaces unknown-access warnings) and passes params.command into ask() for the command metadata. We adopt the scoped release pattern and move both Kilo tweaks inside the acquireRelease body so resource cleanup still runs on every path.
- Alternatives: take-ours leaks tree-sitter parse trees (no .delete() on failure paths); take-theirs drops the scan.access='unknown' sentinel and the command metadata threaded into the ask() permission request
- Verification: bun run typecheck
- Resolution Hash: `e55e56c79546`
<details><summary>Resolved content</summary>

```diff
import { Schema } from "effect"
import { PositiveInt } from "@/util/schema"
import os from "os"
import { createWriteStream } from "node:fs"
import * as Tool from "./tool"
import path from "path"
import DESCRIPTION from "./bash.txt"
import * as Log from "@opencode-ai/core/util/log"
import { Instance } from "../project/instance"
import { lazy } from "@/util/lazy"
import { Language, type Node } from "web-tree-sitter"

import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { fileURLToPath } from "url"
import { Config } from "@/config/config"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Shell } from "@/shell/shell"

import { BashArity } from "@/permission/arity"
import * as Truncate from "./truncate"
import { Plugin } from "@/plugin"
import { Effect, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { InstanceState } from "@/effect/instance-state"

const MAX_METADATA_LENGTH = 30_000
const DEFAULT_TIMEOUT = Flag.KILO_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS || 2 * 60 * 1000
const CWD = new Set(["cd", "push-location", "set-location"])
const FILES = new Set([
  ...CWD,
  "rm",
  "cp",
  "mv",
  "mkdir",
  "touch",
  "chmod",
  "chown",
  "cat",
  // Leave PowerShell aliases out for now. Common ones like cat/cp/mv/rm/mkdir
  // already hit the entries above, and alias normalization should happen in one
  // place later so we do not risk double-prompting.
  "get-content",
  "set-content",
  "add-content",
  "copy-item",
  "move-item",
  "remove-item",
  "new-item",
  "rename-item",
])
// kilocode_change start
const READ = new Set(["cat", "get-content"])
// kilocode_change end
const FLAGS = new Set(["-destination", "-literalpath", "-path"])
const SWITCHES = new Set(["-confirm", "-debug", "-force", "-nonewline", "-recurse", "-verbose", "-whatif"])

export const Parameters = Schema.Struct({
  command: Schema.String.annotate({ description: "The command to execute" }),
  timeout: Schema.optional(PositiveInt).annotate({ description: "Optional timeout in milliseconds" }),
  workdir: Schema.optional(Schema.String).annotate({
    description: `The working directory to run the command in. Defaults to the current directory. Use this instead of 'cd' commands.`,
  }),
  description: Schema.optional(Schema.String).annotate({
    // kilocode_change
    // kilocode_change start
    description:
      "Recommended: a clear, concise description of what this command does in 5-10 words. Examples:\nInput: ls\nOutput: Lists files in current directory\n\nInput: git status\nOutput: Shows working tree status\n\nInput: npm install\nOutput: Installs package dependencies\n\nInput: mkdir foo\nOutput: Creates directory 'foo'",
    // kilocode_change end
  }),
})

type Part = {
  type: string
  text: string
}

// kilocode_change start
type Access = "read" | "unknown"
// kilocode_change end

type Scan = {
  dirs: Set<string>
  patterns: Set<string>
  always: Set<string>
  access: Access // kilocode_change
}

type Chunk = {
  text: string
  size: number
}

export const log = Log.create({ service: "bash-tool" })

const resolveWasm = (asset: string) => {
  if (asset.startsWith("file://")) return fileURLToPath(asset)
  if (asset.startsWith("/") || /^[a-z]:/i.test(asset)) return asset
  const url = new URL(asset, import.meta.url)
  return fileURLToPath(url)
}

function parts(node: Node) {
  const out: Part[] = []
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (!child) continue
    if (child.type === "command_elements") {
      for (let j = 0; j < child.childCount; j++) {
        const item = child.child(j)
        if (!item || item.type === "command_argument_sep" || item.type === "redirection") continue
        out.push({ type: item.type, text: item.text })
      }
      continue
    }
    if (
      child.type !== "command_name" &&
      child.type !== "command_name_expr" &&
      child.type !== "word" &&
      child.type !== "string" &&
      child.type !== "raw_string" &&
      child.type !== "concatenation"
    ) {
      continue
    }
    out.push({ type: child.type, text: child.text })
  }
  return out
}

function source(node: Node) {
  return (node.parent?.type === "redirected_statement" ? node.parent.text : node.text).trim()
}

// kilocode_change start
function access(cmd: string, node: Node): Access {
  if (!READ.has(cmd)) return "unknown"
  if (node.parent?.type === "redirected_statement") return "unknown"
  return "read"
}
// kilocode_change end

function commands(node: Node) {
  return node.descendantsOfType("command").filter((child): child is Node => Boolean(child))
}

function unquote(text: string) {
  if (text.length < 2) return text
  const first = text[0]
  const last = text[text.length - 1]
  if ((first === '"' || first === "'") && first === last) return text.slice(1, -1)
  return text
}

function home(text: string) {
  if (text === "~") return os.homedir()
  if (text.startsWith("~/") || text.startsWith("~\\")) return path.join(os.homedir(), text.slice(2))
  return text
}

function envValue(key: string) {
  if (process.platform !== "win32") return process.env[key]
  const name = Object.keys(process.env).find((item) => item.toLowerCase() === key.toLowerCase())
  return name ? process.env[name] : undefined
}

function auto(key: string, cwd: string, shell: string) {
  const name = key.toUpperCase()
  if (name === "HOME") return os.homedir()
  if (name === "PWD") return cwd
  if (name === "PSHOME") return path.dirname(shell)
}

function expand(text: string, cwd: string, shell: string) {
  const out = unquote(text)
    .replace(/\$\{env:([^}]+)\}/gi, (_, key: string) => envValue(key) || "")
    .replace(/\$env:([A-Za-z_][A-Za-z0-9_]*)/gi, (_, key: string) => envValue(key) || "")
    .replace(/\$(HOME|PWD|PSHOME)(?=$|[\\/])/gi, (_, key: string) => auto(key, cwd, shell) || "")
  return home(out)
}

function provider(text: string) {
  const match = text.match(/^([A-Za-z]+)::(.*)$/)
  if (match) {
    if (match[1].toLowerCase() !== "filesystem") return
    return match[2]
  }
  const prefix = text.match(/^([A-Za-z]+):(.*)$/)
  if (!prefix) return text
  if (prefix[1].length === 1) return text
  return
}

function dynamic(text: string, ps: boolean) {
  if (text.startsWith("(") || text.startsWith("@(")) return true
  if (text.includes("$(") || text.includes("${") || text.includes("`")) return true
  if (ps) return /\$(?!env:)/i.test(text)
  return text.includes("$")
}

function prefix(text: string) {
  const match = /[?*[]/.exec(text)
  if (!match) return text
  if (match.index === 0) return
  return text.slice(0, match.index)
}

function pathArgs(list: Part[], ps: boolean) {
  if (!ps) {
    return list
      .slice(1)
      .filter((item) => !item.text.startsWith("-") && !(list[0]?.text === "chmod" && item.text.startsWith("+")))
      .map((item) => item.text)
  }

  const out: string[] = []
  let want = false
  for (const item of list.slice(1)) {
    if (want) {
      out.push(item.text)
      want = false
      continue
    }
    if (item.type === "command_parameter") {
      const flag = item.text.toLowerCase()
      if (SWITCHES.has(flag)) continue
      want = FLAGS.has(flag)
      continue
    }
    out.push(item.text)
  }
  return out
}

function preview(text: string) {
  if (text.length <= MAX_METADATA_LENGTH) return text
  return "...\n\n" + text.slice(-MAX_METADATA_LENGTH)
}

function tail(text: string, maxLines: number, maxBytes: number) {
  const lines = text.split("\n")
  if (lines.length <= maxLines && Buffer.byteLength(text, "utf-8") <= maxBytes) {
    return {
      text,
      cut: false,
    }
  }

  const out: string[] = []
  let bytes = 0
  for (let i = lines.length - 1; i >= 0 && out.length < maxLines; i--) {
    const size = Buffer.byteLength(lines[i], "utf-8") + (out.length > 0 ? 1 : 0)
    if (bytes + size > maxBytes) {
      if (out.length === 0) {
        const buf = Buffer.from(lines[i], "utf-8")
        let start = buf.length - maxBytes
        if (start < 0) start = 0
        while (start < buf.length && (buf[start] & 0xc0) === 0x80) start++
        out.unshift(buf.subarray(start).toString("utf-8"))
      }
      break
    }
    out.unshift(lines[i])
    bytes += size
  }
  return {
    text: out.join("\n"),
    cut: true,
  }
}

const parse = Effect.fn("BashTool.parse")(function* (command: string, ps: boolean) {
  const tree = yield* Effect.promise(() => parser().then((p) => (ps ? p.ps : p.bash).parse(command)))
  if (!tree) throw new Error("Failed to parse command")
  return tree
})

const ask = Effect.fn("BashTool.ask")(function* (ctx: Tool.Context, scan: Scan, command: string) {
  // kilocode_change
  if (scan.dirs.size > 0) {
    const globs = Array.from(scan.dirs).map((dir) => {
      if (process.platform === "win32") return AppFileSystem.normalizePathPattern(path.join(dir, "*"))
      return path.join(dir, "*")
    })
    yield* ctx.ask({
      permission: "external_directory",
      patterns: globs,
      always: globs,
      metadata: scan.access === "read" ? { command, access: "read" } : {}, // kilocode_change
    })
  }

  if (scan.patterns.size === 0) return
  yield* ctx.ask({
    permission: "bash",
    patterns: Array.from(scan.patterns),
    always: Array.from(scan.always),
    metadata: { command }, // kilocode_change
  })
})

function cmd(shell: string, command: string, cwd: string, env: NodeJS.ProcessEnv) {
  if (process.platform === "win32" && Shell.ps(shell)) {
    return ChildProcess.make(shell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], {
      cwd,
      env,
      stdin: "ignore",
      detached: false,
    })
  }

  return ChildProcess.make(command, [], {
    shell,
    cwd,
    env,
    stdin: "ignore",
    detached: process.platform !== "win32",
  })
}
const parser = lazy(async () => {
  const { Parser } = await import("web-tree-sitter")
  const { default: treeWasm } = await import("web-tree-sitter/tree-sitter.wasm" as string, {
    with: { type: "wasm" },
  })
  const treePath = resolveWasm(treeWasm)
  await Parser.init({
    locateFile() {
      return treePath
    },
  })
  const { default: bashWasm } = await import("tree-sitter-bash/tree-sitter-bash.wasm" as string, {
    with: { type: "wasm" },
  })
  const { default: psWasm } = await import("tree-sitter-powershell/tree-sitter-powershell.wasm" as string, {
    with: { type: "wasm" },
  })
  const bashPath = resolveWasm(bashWasm)
  const psPath = resolveWasm(psWasm)
  const [bashLanguage, psLanguage] = await Promise.all([Language.load(bashPath), Language.load(psPath)])
  const bash = new Parser()
  bash.setLanguage(bashLanguage)
  const ps = new Parser()
  ps.setLanguage(psLanguage)
  return { bash, ps }
})

// TODO: we may wanna rename this tool so it works better on other shells
export const BashTool = Tool.define(
  "bash",
  Effect.gen(function* () {
    const config = yield* Config.Service
    const spawner = yield* ChildProcessSpawner
    const fs = yield* AppFileSystem.Service
    const trunc = yield* Truncate.Service
    const plugin = yield* Plugin.Service

    const cygpath = Effect.fn("BashTool.cygpath")(function* (shell: string, text: string) {
      const lines = yield* spawner
        .lines(ChildProcess.make(shell, ["-lc", 'cygpath -w -- "$1"', "_", text]))
        .pipe(Effect.catch(() => Effect.succeed([] as string[])))
      const file = lines[0]?.trim()
      if (!file) return
      return AppFileSystem.normalizePath(file)
    })

    const resolvePath = Effect.fn("BashTool.resolvePath")(function* (text: string, root: string, shell: string) {
      if (process.platform === "win32") {
        if (Shell.posix(shell) && text.startsWith("/") && AppFileSystem.windowsPath(text) === text) {
          const file = yield* cygpath(shell, text)
          if (file) return file
        }
        return AppFileSystem.normalizePath(path.resolve(root, AppFileSystem.windowsPath(text)))
      }
      return path.resolve(root, text)
    })

    const argPath = Effect.fn("BashTool.argPath")(function* (arg: string, cwd: string, ps: boolean, shell: string) {
      const text = ps ? expand(arg, cwd, shell) : home(unquote(arg))
      const file = text && prefix(text)
      if (!file || dynamic(file, ps)) return
      const next = ps ? provider(file) : file
      if (!next) return
      return yield* resolvePath(next, cwd, shell)
    })

    const collect = Effect.fn("BashTool.collect")(function* (root: Node, cwd: string, ps: boolean, shell: string) {
      const scan: Scan = {
        dirs: new Set<string>(),
        patterns: new Set<string>(),
        always: new Set<string>(),
        access: "read", // kilocode_change
      }

      const nodes = commands(root) // kilocode_change
      if (root.descendantsOfType("file_redirect").length > 0) scan.access = "unknown" // kilocode_change
      // kilocode_change start
      if (nodes.some((node) => !READ.has((ps ? parts(node)[0]?.text.toLowerCase() : parts(node)[0]?.text) ?? ""))) {
        scan.access = "unknown"
      }
      // kilocode_change end

      for (const node of nodes) {
        // kilocode_change
        const command = parts(node)
        const tokens = command.map((item) => item.text)
        const cmd = ps ? tokens[0]?.toLowerCase() : tokens[0]

        if (cmd && FILES.has(cmd)) {
          const kind = access(cmd, node) // kilocode_change
          for (const arg of pathArgs(command, ps)) {
            const resolved = yield* argPath(arg, cwd, ps, shell)
            log.info("resolved path", { arg, resolved })
            if (!resolved || Instance.containsPath(resolved)) continue
            const dir = (yield* fs.isDir(resolved)) ? resolved : path.dirname(resolved)
            scan.dirs.add(dir)
            if (kind !== "read") scan.access = "unknown" // kilocode_change
          }
        }

        if (tokens.length && (!cmd || !CWD.has(cmd))) {
          scan.patterns.add(source(node))
          scan.always.add(BashArity.prefix(tokens).join(" ") + " *")
        }
      }

      return scan
    })

    const shellEnv = Effect.fn("BashTool.shellEnv")(function* (ctx: Tool.Context, cwd: string) {
      const extra = yield* plugin.trigger(
        "shell.env",
        { cwd, sessionID: ctx.sessionID, callID: ctx.callID },
        { env: {} },
      )
      return {
        ...process.env,
        ...extra.env,
      }
    })

    const run = Effect.fn("BashTool.run")(function* (
      input: {
        shell: string
        command: string
        cwd: string
        env: NodeJS.ProcessEnv
        timeout: number
        description: string
      },
      ctx: Tool.Context,
    ) {
      const limits = yield* trunc.limits()
      const keep = limits.maxBytes * 2
      let full = ""
      let last = ""
      const list: Chunk[] = []
      let used = 0
      let file = ""
      let sink: ReturnType<typeof createWriteStream> | undefined
      let cut = false
      let expired = false
      let aborted = false

      yield* ctx.metadata({
        metadata: {
          output: "",
          description: input.description,
        },
      })

      const code: number | null = yield* Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* spawner.spawn(cmd(input.shell, input.command, input.cwd, input.env))

          yield* Effect.forkScoped(
            Stream.runForEach(Stream.decodeText(handle.all), (chunk) => {
              const size = Buffer.byteLength(chunk, "utf-8")
              list.push({ text: chunk, size })
              used += size
              while (used > keep && list.length > 1) {
                const item = list.shift()
                if (!item) break
                used -= item.size
                cut = true
              }

              last = preview(last + chunk)

              if (file) {
                sink?.write(chunk)
              } else {
                full += chunk
                if (Buffer.byteLen

... truncated after 16000 characters ...
```

</details>


### packages/opencode/src/tool/registry.ts

- Conflict: UU (content)
- Recommendation: manual - Code files need manual review for kilocode_change markers
- Base Hash: `5a0b377aa22f`
- Ours Hash: `d31bdf819274`
- Theirs Hash: `49c80249c532`
<details><summary>Original diff3 conflict</summary>

```diff
<<<<<<< HEAD
        const questionEnabled = KiloToolRegistry.question() // kilocode_change
||||||| c00058ed7a
        const questionEnabled =
          ["app", "cli", "desktop"].includes(Flag.OPENCODE_CLIENT) || Flag.OPENCODE_ENABLE_QUESTION_TOOL // kilocode_change
=======
        const questionEnabled =
          ["app", "cli", "desktop"].includes(Flag.KILO_CLIENT) || Flag.KILO_ENABLE_QUESTION_TOOL // kilocode_change
>>>>>>> markijbema/opencode-v1.14.30

<<<<<<< HEAD
            ...(KiloToolRegistry.plan() ? [tool.plan] : []), // kilocode_change
||||||| c00058ed7a
            ...(Flag.OPENCODE_EXPERIMENTAL_PLAN_MODE && Flag.OPENCODE_CLIENT === "cli" ? [tool.plan] : []), // kilocode_change
=======
            ...(Flag.KILO_EXPERIMENTAL_PLAN_MODE && Flag.KILO_CLIENT === "cli" ? [tool.plan] : []), // kilocode_change
>>>>>>> markijbema/opencode-v1.14.30
```

</details>

- Decision: take-ours
- Risk: low
- Summary: Keep KiloToolRegistry abstractions for question/plan gating
- Rationale: Both conflicts are over inline Flag checks (questionEnabled + plan gating) vs. our KiloToolRegistry.question()/KiloToolRegistry.plan() helpers. The helpers already wrap the same KILO_CLIENT / KILO_ENABLE_QUESTION_TOOL / KILO_EXPERIMENTAL_PLAN_MODE reads plus Kilo-specific policy (e.g. agent-manager rules) and are used by other callers. Taking ours keeps a single source of truth for Kilo tool-gating policy.
- Alternatives: take-theirs would duplicate the flag logic inline and require updating two places whenever the gating policy changes
- Verification: bun run typecheck
- Resolution Hash: `d2c3a0d574bf`
<details><summary>Resolved content</summary>

```diff
import { PlanExitTool } from "./plan"
import { Session } from "@/session/session"
import { QuestionTool } from "./question"
import { SuggestTool } from "../kilocode/suggestion/tool" // kilocode_change
import { BashTool } from "./bash"
import { EditTool } from "./edit"
import { GlobTool } from "./glob"
import { GrepTool } from "./grep"
import { ReadTool } from "./read"
import { TaskTool } from "./task"
import { TodoWriteTool } from "./todo"
import { WebFetchTool } from "./webfetch"
import { WriteTool } from "./write"
import { InvalidTool } from "./invalid"
import { SkillTool } from "./skill"
import * as Tool from "./tool"
import { Config } from "@/config/config"
import { type ToolContext as PluginToolContext, type ToolDefinition } from "@kilocode/plugin"
import { Schema } from "effect"
import z from "zod"
import { ZodOverride } from "@/util/effect-zod"
import { Plugin } from "../plugin"
import { Provider } from "@/provider/provider"
import { ProviderID, type ModelID } from "../provider/schema"
import { WebSearchTool } from "./websearch"
import { KiloToolRegistry } from "../kilocode/tool/registry" // kilocode_change
import { makeRuntime } from "@/effect/run-service" // kilocode_change
import { Flag } from "@opencode-ai/core/flag/flag"
import * as Log from "@opencode-ai/core/util/log"
import { LspTool } from "./lsp"
import * as Truncate from "./truncate"
import { ApplyPatchTool } from "./apply_patch"
import { Glob } from "@opencode-ai/core/util/glob"
import path from "path"
import { pathToFileURL } from "url"
import { Effect, Layer, Context } from "effect"
import { FetchHttpClient, HttpClient } from "effect/unstable/http"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Ripgrep } from "../file/ripgrep"
import { Format } from "../format"
import { InstanceState } from "@/effect/instance-state"
import { Question } from "../question"
import { Todo } from "../session/todo"
import { LSP } from "@/lsp/lsp"
import { Instruction } from "../session/instruction"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Bus } from "../bus"
import { Agent } from "../agent/agent"
import { Skill } from "../skill"
import { Permission } from "@/permission"

const log = Log.create({ service: "tool.registry" })

type TaskDef = Tool.InferDef<typeof TaskTool>
type ReadDef = Tool.InferDef<typeof ReadTool>

type State = {
  custom: Tool.Def[]
  builtin: Tool.Def[]
  task: TaskDef
  read: ReadDef
}

export interface Interface {
  readonly ids: () => Effect.Effect<string[]>
  readonly all: () => Effect.Effect<Tool.Def[]>
  readonly named: () => Effect.Effect<{ task: TaskDef; read: ReadDef }>
  readonly tools: (model: { providerID: ProviderID; modelID: ModelID; agent: Agent.Info }) => Effect.Effect<Tool.Def[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ToolRegistry") {}

export const layer: Layer.Layer<
  Service,
  never,
  | Config.Service
  | Plugin.Service
  | Question.Service
  | Todo.Service
  | Agent.Service
  | Skill.Service
  | Session.Service
  | Provider.Service
  | LSP.Service
  | Instruction.Service
  | AppFileSystem.Service
  | Bus.Service
  | HttpClient.HttpClient
  | ChildProcessSpawner
  | Ripgrep.Service
  | Format.Service
  | Truncate.Service
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const plugin = yield* Plugin.Service
    const agents = yield* Agent.Service
    const skill = yield* Skill.Service
    const truncate = yield* Truncate.Service

    const invalid = yield* InvalidTool
    const task = yield* TaskTool
    const read = yield* ReadTool
    const question = yield* QuestionTool
    const todo = yield* TodoWriteTool
    const lsptool = yield* LspTool
    const plan = yield* PlanExitTool
    const webfetch = yield* WebFetchTool
    const websearch = yield* WebSearchTool
    const bash = yield* BashTool
    const globtool = yield* GlobTool
    const writetool = yield* WriteTool
    const edit = yield* EditTool
    const greptool = yield* GrepTool
    const patchtool = yield* ApplyPatchTool
    const skilltool = yield* SkillTool
    const agent = yield* Agent.Service
    const suggesttool = yield* SuggestTool // kilocode_change
    const kiloToolInfos = yield* KiloToolRegistry.infos() // kilocode_change

    const state = yield* InstanceState.make<State>(
      Effect.fn("ToolRegistry.state")(function* (ctx) {
        const custom: Tool.Def[] = []

        function fromPlugin(id: string, def: ToolDefinition): Tool.Def {
          // Plugin tools define their args as a raw Zod shape. Wrap the
          // derived Zod object in a `Schema.declare` so it slots into the
          // Schema-typed framework, and annotate with `ZodOverride` so the
          // walker emits the original Zod object for LLM JSON Schema.
          const zodParams = z.object(def.args)
          const parameters = Schema.declare<unknown>((u): u is unknown => zodParams.safeParse(u).success).annotate({
            [ZodOverride]: zodParams,
          })
          return {
            id,
            parameters,
            description: def.description,
            execute: (args, toolCtx) =>
              Effect.gen(function* () {
                const pluginCtx: PluginToolContext = {
                  ...toolCtx,
                  ask: (req) => toolCtx.ask(req),
                  directory: ctx.directory,
                  worktree: ctx.worktree,
                }
                const result = yield* Effect.promise(() => def.execute(args as any, pluginCtx))
                const output = typeof result === "string" ? result : result.output
                const metadata = typeof result === "string" ? {} : (result.metadata ?? {})
                const info = yield* agent.get(toolCtx.agent)
                const out = yield* truncate.output(output, {}, info)
                return {
                  title: "",
                  output: out.truncated ? out.content : output,
                  metadata: {
                    ...metadata,
                    truncated: out.truncated,
                    ...(out.truncated && { outputPath: out.outputPath }),
                  },
                }
              }),
          }
        }

        const dirs = yield* config.directories()
        const matches = dirs.flatMap((dir) =>
          Glob.scanSync("{tool,tools}/*.{js,ts}", { cwd: dir, absolute: true, dot: true, symlink: true }),
        )
        if (matches.length) yield* config.waitForDependencies()
        for (const match of matches) {
          const namespace = path.basename(match, path.extname(match))
          // `match` is an absolute filesystem path from `Glob.scanSync(..., { absolute: true })`.
          // Import it as `file://` so Node on Windows accepts the dynamic import.
          const mod = yield* Effect.promise(() => import(pathToFileURL(match).href))
          for (const [id, def] of Object.entries<ToolDefinition>(mod)) {
            custom.push(fromPlugin(id === "default" ? namespace : `${namespace}_${id}`, def))
          }
        }

        const plugins = yield* plugin.list()
        for (const p of plugins) {
          for (const [id, def] of Object.entries(p.tool ?? {})) {
            custom.push(fromPlugin(id, def))
          }
        }

        const cfg = yield* config.get()
        const questionEnabled = KiloToolRegistry.question() // kilocode_change

        // kilocode_change start
        const tool = yield* Effect.all({
          invalid: Tool.init(invalid),
          bash: Tool.init(bash),
          read: Tool.init(read),
          glob: Tool.init(globtool),
          grep: Tool.init(greptool),
          edit: Tool.init(edit),
          write: Tool.init(writetool),
          task: Tool.init(task),
          fetch: Tool.init(webfetch),
          todo: Tool.init(todo),
          search: Tool.init(websearch),
          skill: Tool.init(skilltool),
          patch: Tool.init(patchtool),
          question: Tool.init(question),
          lsp: Tool.init(lsptool),
          plan: Tool.init(plan),
          suggest: Tool.init(suggesttool), // kilocode_change
        })
        // kilocode_change end

        const kilo = yield* KiloToolRegistry.build(kiloToolInfos, { agent: agents, truncate }) // kilocode_change

        // kilocode_change start
        return {
          custom,
          builtin: [
            tool.invalid,
            ...(questionEnabled ? [tool.question] : []),
            tool.bash,
            tool.read,
            tool.glob,
            tool.grep,
            tool.edit,
            tool.write,
            tool.task,
            tool.fetch,
            tool.todo,
            tool.search,
            tool.skill,
            tool.patch,
            ...(KiloToolRegistry.plan() ? [tool.plan] : []), // kilocode_change
            ...KiloToolRegistry.suggest(tool.suggest), // kilocode_change
            ...KiloToolRegistry.extra(kilo, cfg), // kilocode_change
            ...(Flag.KILO_EXPERIMENTAL_LSP_TOOL ? [tool.lsp] : []),
          ],
          task: tool.task,
          read: tool.read,
        }
        // kilocode_change end
      }),
    )

    const all: Interface["all"] = Effect.fn("ToolRegistry.all")(function* () {
      const s = yield* InstanceState.get(state)
      return [...s.builtin, ...s.custom] as Tool.Def[]
    })

    const ids: Interface["ids"] = Effect.fn("ToolRegistry.ids")(function* () {
      return (yield* all()).map((tool) => tool.id)
    })

    const describeSkill = Effect.fn("ToolRegistry.describeSkill")(function* (agent: Agent.Info) {
      const list = yield* skill.available(agent)
      if (list.length === 0) return "No skills are currently available."
      return [
        "Load a specialized skill that provides domain-specific instructions and workflows.",
        "",
        "When you recognize that a task matches one of the available skills listed below, use this tool to load the full skill instructions.",
        "",
        "The skill will inject detailed instructions, workflows, and access to bundled resources (scripts, references, templates) into the conversation context.",
        "",
        'Tool output includes a `<skill_content name="...">` block with the loaded content.',
        "",
        "The following skills provide specialized sets of instructions for particular tasks",
        "Invoke this tool to load a skill when a task matches one of the available skills listed below:",
        "",
        Skill.fmt(list, { verbose: false }),
      ].join("\n")
    })

    const describeTask = Effect.fn("ToolRegistry.describeTask")(function* (agent: Agent.Info) {
      const items = (yield* agents.list()).filter((item) => item.mode !== "primary")
      const filtered = items.filter(
        (item) => Permission.evaluate("task", item.name, agent.permission).action !== "deny",
      )
      const list = filtered.toSorted((a, b) => a.name.localeCompare(b.name))
      const description = list
        .map(
          (item) =>
            `- ${item.name}: ${item.description ?? "This subagent should only be called manually by the user."}`,
        )
        .join("\n")
      return ["Available agent types and the tools they have access to:", description].join("\n")
    })

    const tools: Interface["tools"] = Effect.fn("ToolRegistry.tools")(function* (input) {
      const filtered = (yield* all()).filter((tool) => {
        if (tool.id === WebSearchTool.id) {
          return input.providerID === ProviderID.kilo || Flag.KILO_ENABLE_EXA // kilocode_change
        }

        const usePatch =
          KiloToolRegistry.e2e() || // kilocode_change
          (input.modelID.includes("gpt-") && !input.modelID.includes("oss") && !input.modelID.includes("gpt-4"))
        if (tool.id === ApplyPatchTool.id) return usePatch
        if (tool.id === EditTool.id) return !usePatch // kilocode_change

        return true
      })

      return yield* Effect.forEach(
        filtered,
        Effect.fnUntraced(function* (tool: Tool.Def) {
          using _ = log.time(tool.id)
          const output = {
            description: tool.description,
            parameters: tool.parameters,
          }
          yield* plugin.trigger("tool.definition", { toolID: tool.id }, output)
          return {
            id: tool.id,
            description: [
              output.description,
              tool.id === TaskTool.id ? yield* describeTask(input.agent) : undefined,
              tool.id === SkillTool.id ? yield* describeSkill(input.agent) : undefined,
            ]
              .filter(Boolean)
              .join("\n"),
            parameters: output.parameters,
            execute: tool.execute,
            formatValidationError: tool.formatValidationError,
          }
        }),
        { concurrency: "unbounded" },
      )
    })

    const named: Interface["named"] = Effect.fn("ToolRegistry.named")(function* () {
      const s = yield* InstanceState.get(state)
      return { task: s.task, read: s.read }
    })

    return Service.of({ ids, all, named, tools })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(Config.defaultLayer),
    Layer.provide(Plugin.defaultLayer),
    Layer.provide(Question.defaultLayer),
    Layer.provide(Todo.defaultLayer),
    Layer.provide(Skill.defaultLayer),
    Layer.provide(Agent.defaultLayer),
    Layer.provide(Session.defaultLayer),
    Layer.provide(Provider.defaultLayer),
    Layer.provide(LSP.defaultLayer),
    Layer.provide(Instruction.defaultLayer),
    Layer.provide(AppFileSystem.defaultLayer),
    Layer.provide(Bus.layer),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(Format.defaultLayer),
    Layer.provide(CrossSpawnSpawner.defaultLayer),
    Layer.provide(Ripgrep.defaultLayer),
    Layer.provide(Truncate.defaultLayer),
  ),
)
// kilocode_change start
const { runPromise } = makeRuntime(Service, defaultLayer)
export const ids = () => runPromise((svc) => svc.ids())
// kilocode_change end
export * as ToolRegistry from "./registry"
```

</details>


### packages/opencode/test/server/httpapi-bridge.test.ts

- Conflict: UU (content)
- Recommendation: manual - Code files need manual review for kilocode_change markers
- Base Hash: `45c6e8f46e52`
- Ours Hash: `f1d5cd69f21f`
- Theirs Hash: `90f1626b4ed2`
<details><summary>Original diff3 conflict</summary>

```diff
<<<<<<< HEAD
  // kilocode_change start - skip Effect HttpApi parity tests until Kilo overlay routes are migrated.
  // These tests verify every Hono route has an Effect HttpApi contract. Kilo-specific routes
  // (/config/warnings, /indexing/status, /kilo/claw/*, /kilo/cloud-sessions, /experimental/worktree/diff*)
  // aren't yet wired into PublicApi. The Effect HttpApi bridge is gated behind KILO_EXPERIMENTAL_HTTPAPI
  // and is not enabled in any production client (VS Code extension, JetBrains, TUI, desktop all use Hono).
  // Follow-up: migrate Kilo overlay routes onto the Effect HttpApi bridge.
||||||| c00058ed7a
=======
  test("keeps Effect HttpApi behind the feature flag", () => {
    Flag.KILO_EXPERIMENTAL_HTTPAPI = false
    expect(Server.backend()).toEqual({ backend: "hono", reason: "stable" })

    Flag.KILO_EXPERIMENTAL_HTTPAPI = true
    expect(Server.backend()).toEqual({ backend: "effect-httpapi", reason: "env" })
  })
>>>>>>> markijbema/opencode-v1.14.30
```

</details>

- Decision: hybrid
- Risk: low
- Summary: Add upstream backend-flag test alongside Kilo's skipped parity tests
- Rationale: Upstream added a new test that asserts Server.backend() flips between {hono, stable} and {effect-httpapi, env} based on Flag.KILO_EXPERIMENTAL_HTTPAPI — a sanity check for the new ServerBackend.select(). We keep the Kilo comment explaining why the Hono↔Effect route parity tests are .skip-ed (Kilo overlay routes not yet on the Effect HttpApi bridge) and add upstream's new backend-flag test above it.
- Alternatives: take-ours skips upstream's new backend-flag assertion; take-theirs drops the Kilo context explaining the test.skip rationale
- Verification: bun test test/server/httpapi-bridge.test.ts
- Resolution Hash: `2c7d74ed56f8`
<details><summary>Resolved content</summary>

```diff
import { afterEach, describe, expect, test } from "bun:test"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Instance } from "../../src/project/instance"
import { ControlPaths } from "../../src/server/routes/instance/httpapi/groups/control"
import { FileApi, FilePaths } from "../../src/server/routes/instance/httpapi/groups/file"
import { GlobalPaths } from "../../src/server/routes/instance/httpapi/groups/global"
import { PublicApi } from "../../src/server/routes/instance/httpapi/public"
import { Server } from "../../src/server/server"
import * as Log from "@opencode-ai/core/util/log"
import { OpenApi } from "effect/unstable/httpapi"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

const original = {
  KILO_EXPERIMENTAL_HTTPAPI: Flag.KILO_EXPERIMENTAL_HTTPAPI,
  KILO_SERVER_PASSWORD: Flag.KILO_SERVER_PASSWORD,
  KILO_SERVER_USERNAME: Flag.KILO_SERVER_USERNAME,
}

const methods = ["get", "post", "put", "delete", "patch"] as const
let effectSpec: ReturnType<typeof OpenApi.fromApi> | undefined

function effectOpenApi() {
  return (effectSpec ??= OpenApi.fromApi(PublicApi))
}

function app(input?: { password?: string; username?: string }) {
  Flag.KILO_EXPERIMENTAL_HTTPAPI = true
  Flag.KILO_SERVER_PASSWORD = input?.password
  Flag.KILO_SERVER_USERNAME = input?.username
  return Server.Default().app
}

function openApiRouteKeys(spec: { paths: Record<string, Partial<Record<(typeof methods)[number], unknown>>> }) {
  return Object.entries(spec.paths)
    .flatMap(([path, item]) =>
      methods.filter((method) => item[method]).map((method) => `${method.toUpperCase()} ${path}`),
    )
    .sort()
}

function openApiParameters(spec: { paths: Record<string, Partial<Record<(typeof methods)[number], Operation>>> }) {
  return Object.fromEntries(
    Object.entries(spec.paths).flatMap(([path, item]) =>
      methods
        .filter((method) => item[method])
        .map((method) => [
          `${method.toUpperCase()} ${path}`,
          (item[method]?.parameters ?? [])
            .map(parameterKey)
            .filter((param) => param !== undefined)
            .sort(),
        ]),
    ),
  )
}

function openApiRequestBodies(spec: OpenApiSpec) {
  return Object.fromEntries(
    Object.entries(spec.paths).flatMap(([path, item]) =>
      methods
        .filter((method) => item[method])
        .map((method) => [`${method.toUpperCase()} ${path}`, requestBodyKey(spec, item[method]?.requestBody)]),
    ),
  )
}

type OpenApiSpec = {
  components?: {
    schemas?: Record<string, unknown>
  }
  paths: Record<string, Partial<Record<(typeof methods)[number], Operation>>>
}

type OpenApiSchema = {
  $ref?: string
  allOf?: unknown[]
  anyOf?: unknown[]
  oneOf?: unknown[]
  properties?: Record<string, unknown>
  type?: string | string[]
}

type Operation = {
  parameters?: unknown[]
  responses?: unknown
  requestBody?: unknown
}

type RequestBody = {
  content?: Record<string, { schema?: OpenApiSchema }>
  required?: boolean
}

function parameterKey(param: unknown) {
  if (!param || typeof param !== "object" || !("in" in param) || !("name" in param)) return
  if (typeof param.in !== "string" || typeof param.name !== "string") return
  return `${param.in}:${param.name}:${"required" in param && param.required === true}`
}

function parameterSchema(input: {
  spec: { paths: Record<string, Partial<Record<(typeof methods)[number], Operation>>> }
  path: string
  method: (typeof methods)[number]
  name: string
}) {
  const param = input.spec.paths[input.path]?.[input.method]?.parameters?.find(
    (param) => !!param && typeof param === "object" && "name" in param && param.name === input.name,
  )
  if (!param || typeof param !== "object" || !("schema" in param)) return
  return param.schema
}

function requestBodyKey(spec: OpenApiSpec, body: unknown) {
  if (!body || typeof body !== "object" || !("content" in body)) return ""
  const requestBody = body as RequestBody
  return JSON.stringify({
    required: requestBody.required === true,
    content: Object.entries(requestBody.content ?? {})
      .map(([type, value]) => [type, requestBodySchemaKind(spec, value.schema)])
      .sort(),
  })
}

function requestBodySchemaKind(spec: OpenApiSpec, schema: OpenApiSchema | undefined) {
  if (!schema) return ""
  const resolved = (
    schema.$ref ? spec.components?.schemas?.[schema.$ref.replace("#/components/schemas/", "")] : schema
  ) as OpenApiSchema | undefined
  if (resolved?.properties) return "object"
  if (resolved?.anyOf ?? resolved?.oneOf ?? resolved?.allOf) return "object"
  return resolved?.type ?? schema.type ?? "inline"
}

function responseContentTypes(input: {
  spec: { paths: Record<string, Partial<Record<(typeof methods)[number], Operation>>> }
  path: string
  method: (typeof methods)[number]
  status: string
}) {
  const responses = input.spec.paths[input.path]?.[input.method]?.responses
  if (!responses || typeof responses !== "object" || !(input.status in responses)) return []
  const response = (responses as Record<string, unknown>)[input.status]
  if (!response || typeof response !== "object" || !("content" in response)) return []
  const content = (response as { content?: unknown }).content
  if (!content || typeof content !== "object") {
    return []
  }
  return Object.keys(content).sort()
}

function authorization(username: string, password: string) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
}

function fileUrl(input?: { directory?: string; token?: string }) {
  const url = new URL(`http://localhost${FilePaths.content}`)
  url.searchParams.set("path", "hello.txt")
  if (input?.directory) url.searchParams.set("directory", input.directory)
  if (input?.token) url.searchParams.set("auth_token", input.token)
  return url
}

afterEach(async () => {
  Flag.KILO_EXPERIMENTAL_HTTPAPI = original.KILO_EXPERIMENTAL_HTTPAPI
  Flag.KILO_SERVER_PASSWORD = original.KILO_SERVER_PASSWORD
  Flag.KILO_SERVER_USERNAME = original.KILO_SERVER_USERNAME
  await Instance.disposeAll()
  await resetDatabase()
})

describe("HttpApi server", () => {
  test("keeps Effect HttpApi behind the feature flag", () => {
    Flag.KILO_EXPERIMENTAL_HTTPAPI = false
    expect(Server.backend()).toEqual({ backend: "hono", reason: "stable" })

    Flag.KILO_EXPERIMENTAL_HTTPAPI = true
    expect(Server.backend()).toEqual({ backend: "effect-httpapi", reason: "env" })
  })

  // kilocode_change start - skip Effect HttpApi parity tests until Kilo overlay routes are migrated.
  // These tests verify every Hono route has an Effect HttpApi contract. Kilo-specific routes
  // (/config/warnings, /indexing/status, /kilo/claw/*, /kilo/cloud-sessions, /experimental/worktree/diff*)
  // aren't yet wired into PublicApi. The Effect HttpApi bridge is gated behind KILO_EXPERIMENTAL_HTTPAPI
  // and is not enabled in any production client (VS Code extension, JetBrains, TUI, desktop all use Hono).
  // Follow-up: migrate Kilo overlay routes onto the Effect HttpApi bridge.
  test.skip("covers every generated OpenAPI route with Effect HttpApi contracts", async () => {
  const honoRoutes = openApiRouteKeys(await Server.openapi())
  const effectRoutes = openApiRouteKeys(effectOpenApi())

  expect(honoRoutes.filter((route) => !effectRoutes.includes(route))).toEqual([])
  expect(effectRoutes.filter((route) => !honoRoutes.includes(route))).toEqual([])
})

  test.skip("matches generated OpenAPI route parameters", async () => {
    const hono = openApiParameters(await Server.openapi())
    const effect = openApiParameters(effectOpenApi())

    expect(
      Object.keys(hono)
        .filter((route) => JSON.stringify(hono[route]) !== JSON.stringify(effect[route]))
        .map((route) => ({ route, hono: hono[route], effect: effect[route] })),
    ).toEqual([])
  })

  test.skip("matches generated OpenAPI request body shape", async () => {
    const hono = openApiRequestBodies(await Server.openapi())
    const effect = openApiRequestBodies(effectOpenApi())

    expect(
      Object.keys(hono)
        .filter((route) => hono[route] !== effect[route])
        .map((route) => ({ route, hono: hono[route], effect: effect[route] })),
    ).toEqual([])
  })
  // kilocode_change end

  test("matches SDK-affecting query parameter schemas", async () => {
    const effect = effectOpenApi()

    expect(parameterSchema({ spec: effect, path: "/session", method: "get", name: "roots" })).toEqual({
      anyOf: [{ type: "boolean" }, { type: "string", enum: ["true", "false"] }],
    })
    expect(parameterSchema({ spec: effect, path: "/session", method: "get", name: "start" })).toEqual({
      type: "number",
    })
    expect(parameterSchema({ spec: effect, path: "/find/file", method: "get", name: "limit" })).toEqual({
      type: "integer",
      minimum: 1,
      maximum: 200,
    })
    expect(
      parameterSchema({ spec: effect, path: "/session/{sessionID}/message", method: "get", name: "limit" }),
    ).toEqual({
      type: "integer",
      minimum: 0,
      maximum: Number.MAX_SAFE_INTEGER,
    })
  })

  test("documents event routes as server-sent events", () => {
    const effect = effectOpenApi()

    expect(responseContentTypes({ spec: effect, path: "/event", method: "get", status: "200" })).toEqual([
      "text/event-stream",
    ])
    expect(responseContentTypes({ spec: effect, path: "/global/event", method: "get", status: "200" })).toEqual([
      "text/event-stream",
    ])
  })

  test("allows requests when auth is disabled", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(`${tmp.path}/hello.txt`, "hello")

    const response = await app().request(fileUrl(), {
      headers: {
        "x-kilo-directory": tmp.path,
      },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ content: "hello" })
  })

  test("provides instance context to bridged handlers", async () => {
    await using tmp = await tmpdir({ git: true })

    const response = await app().request("/project/current", {
      headers: {
        "x-kilo-directory": tmp.path,
      },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ worktree: tmp.path })
  })

  test("requires credentials when auth is enabled", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(`${tmp.path}/hello.txt`, "hello")

    const [missing, bad, good] = await Promise.all([
      app({ password: "secret" }).request(fileUrl(), {
        headers: { "x-kilo-directory": tmp.path },
      }),
      app({ password: "secret" }).request(fileUrl(), {
        headers: {
          authorization: authorization("opencode", "wrong"),
          "x-kilo-directory": tmp.path,
        },
      }),
      app({ password: "secret" }).request(fileUrl(), {
        headers: {
          authorization: authorization("opencode", "secret"),
          "x-kilo-directory": tmp.path,
        },
      }),
    ])

    expect(missing.status).toBe(401)
    expect(bad.status).toBe(401)
    expect(good.status).toBe(200)
  })

  test("accepts auth_token query credentials", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(`${tmp.path}/hello.txt`, "hello")

    const response = await app({ password: "secret" }).request(
      fileUrl({ token: Buffer.from("opencode:secret").toString("base64") }),
      {
        headers: {
          "x-kilo-directory": tmp.path,
        },
      },
    )

    expect(response.status).toBe(200)
  })

  test("selects instance from query before directory header", async () => {
    await using header = await tmpdir({ git: true })
    await using query = await tmpdir({ git: true })
    await Bun.write(`${header.path}/hello.txt`, "header")
    await Bun.write(`${query.path}/hello.txt`, "query")

    const response = await app().request(fileUrl({ directory: query.path }), {
      headers: {
        "x-kilo-directory": header.path,
      },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ content: "query" })
  })

  test("serves global health from Effect HttpApi", async () => {
    const response = await app().request(`${GlobalPaths.health}?directory=/does/not/exist/opencode-test`)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ healthy: true })
  })

  test("serves global event stream from Effect HttpApi", async () => {
    const response = await app().request(GlobalPaths.event)
    if (!response.body) throw new Error("missing event stream body")
    const reader = response.body.getReader()
    const chunk = await reader.read()
    await reader.cancel()

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/event-stream")
    expect(new TextDecoder().decode(chunk.value)).toContain("server.connected")
  })

  test("serves control log from Effect HttpApi", async () => {
    const response = await app().request(ControlPaths.log, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ service: "httpapi-test", level: "info", message: "hello" }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toBe(true)
  })

  test("validates control auth without falling through to 404", async () => {
    const response = await app().request(ControlPaths.auth.replace(":providerID", "test"), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "api" }),
    })

    expect(response.status).toBe(400)
  })

  test("validates global upgrade without invoking installers", async () => {
    const response = await app().request(GlobalPaths.upgrade, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json",
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ success: false })
  })
})
```

</details>

