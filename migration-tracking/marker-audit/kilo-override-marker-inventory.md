> Historical snapshot: this inventory was captured before the 2026-09-08 cleanup of 350 redundant `kilocode_change` markers from 55 Kilo-owned files. Counts and line references below describe that pre-cleanup state, not the current checkout. Shared upstream markers were preserved.

# Kilo override-marker inventory

Generated 2026-09-08 from the working tree at `/Users/johnnyamancio/Workspace/kilo_workspace/kilo-opencode-v2-baseline`.

## Scope and method

This is a read-only inventory of tracked and untracked, non-ignored authored files returned by `git ls-files --cached --others --exclude-standard`. It excludes paths under `.git/`, `node_modules/`, `dist/`, `build/`, `coverage/`, `.cache/`, `cache/`, and `tmp/`, plus generated client/OpenAPI surfaces (`packages/client/src/generated*`, `packages/protocol/openapi.json`, and `packages/www/openapi.json`). Binary/unreadable files were skipped.

Primary searches:

```sh
git ls-files -z --cached --others --exclude-standard
rg -n --hidden 'kilocode_change' <authored-file-set>
rg -n -i --hidden 'kilocode[ _-]*change|kilo[ _-]*(override|patch|modification)' <authored-file-set>
```

The broader expression discovered actual near variants. Exact `kilocode_change` is the convention-defined marker. Classification is per occurrence: prose that names or explains the marker is a documentation mention, while comments attached to authored overrides are patch markers. Thus `AGENTS.md:1` is a patch marker but `AGENTS.md:3` is a documentation mention; the prose in `packages/schema/src/kilocode/presence.ts:6` is also a documentation mention. Source/config markers in Kilo-owned paths remain listed as patch/override markers even though the convention says markers there are unnecessary noise.

Important limitation: this marker list is not a complete list of Kilo patches. Kilo-owned files under `kilocode/`, `packages/<pkg>/src/kilocode/`, and `packages/<pkg>/test/kilocode/` need no marker, and newly authored Kilo-owned packages may likewise contain unmarked Kilo implementation.

## Totals

- 441 broad-search occurrences in 93 unique files.
- 436 exact `kilocode_change` occurrences; 5 near-variant occurrences.
- 430 patch/override-marker occurrences in 85 files.
- 11 documentation mentions in 9 files.
- 32 tracked files and 61 untracked files represented.

## Patch marker counts by package

| Package/scope | Unique files | Occurrences |
|---|---:|---:|
| `(repository root / non-package)` | 1 | 1 |
| `packages/core` | 6 | 13 |
| `packages/kilo-ide-ui` | 54 | 349 |
| `packages/kilo-indexing` | 1 | 1 |
| `packages/kilo-ui` | 2 | 4 |
| `packages/kilo-vscode` | 1 | 1 |
| `packages/plugin` | 1 | 1 |
| `packages/theme` | 4 | 5 |
| `packages/tui` | 15 | 55 |

## Full file list with line references

### `.kilo/plans/1788595789852-glowing-panda.md`

Classification: documentation mention; untracked. 1 occurrence.

- L52 [documentation]: `Kilo-prefixed paths inside packages we wrap). No \`kilocode_change\` marker (owned`

### `AGENTS.md`

Classification: patch/override marker and documentation mention; tracked. 2 occurrences.

- L1 [patch]: `<!-- kilocode_change - this checkout is the Kilo fork of upstream v2; the branch, baseline, and Kilo-ownership rules below override upstream's -->`
- L3 [documentation]: `- Read \`kilocode/v2-fork-conventions.md\` before branching, merging upstream, or adding Kilo code. It overrides the branch-name rule below and defines Kilo-owned paths, shared-hook limits, and \`kilocode_change\` markers.`

### `kilocode/baseline/config-mapping-v2-gap.md`

Classification: documentation mention; untracked. 1 occurrence.

- L23 [documentation]: `the Kilo-only nested fields marked \`kilocode_change\` in the pinned file.`

### `kilocode/baseline/model-prompt-policy-v2-parity.md`

Classification: documentation mention; untracked. 1 occurrence.

- L85 [documentation]: `- \`packages/core/src/plugin/system-prompt.ts:38-42\` — a \`kilocode_change\` comment plus`

### `kilocode/baseline/model-sidebar-v2-parity.md`

Classification: documentation mention; tracked. 1 occurrence.

- L35 [documentation]: `Each is marked \`kilocode_change\`; Kilo policy, transport, metadata and panels`

### `kilocode/baseline/v1-session-schema-audit.md`

Classification: documentation mention; tracked. 1 occurrence.

- L112 [documentation]: `These are v1-main \`kilocode_change\` fields absent from v2's \`SessionV1\``

### `kilocode/v2-fork-conventions.md`

Classification: documentation mention; tracked. 2 occurrences.

- L127 [documentation]: `## \`kilocode_change\` markers`
- L129 [documentation]: `- Mark every Kilo edit inside a shared upstream file with a \`kilocode_change\``

### `packages/core/src/config.ts`

Classification: patch/override marker; tracked. 3 occurrences.

- L36 [patch]: `// kilocode_change - expose native refresh for hosts without filesystem watchers.`
- L322 [patch]: `// kilocode_change - retain location dependencies when refresh is invoked by a host RPC.`
- L325 [patch]: `// kilocode_change - reuse the serialized native loader for explicit refresh.`

### `packages/core/src/mcp/index.ts`

Classification: patch/override marker; tracked. 4 occurrences.

- L185 [patch]: `// kilocode_change — host spawn policy with resources owned by the MCP connection scope.`
- L193 [patch]: `// kilocode_change — accept an optional host spawn policy.`
- L533 [patch]: `// kilocode_change — run the host policy under the existing connection scope and`
- L878 [patch]: `// kilocode_change — preserve the host spawn policy in Location node replacements.`

### `packages/core/src/plugin/sdk.ts`

Classification: patch/override marker; tracked. 2 occurrences.

- L22 [patch]: `// kilocode_change - Let an embedding host enforce policy after user config without making that policy a builtin.`
- L36 [patch]: `// kilocode_change - Post registrations are an explicit host-only policy seam and never alter the default order.`

### `packages/core/src/plugin/supervisor.ts`

Classification: patch/override marker; tracked. 2 occurrences.

- L27 [patch]: `// kilocode_change - Post SDK plugins are host-enforced policy: config cannot disable or shadow them.`
- L156 [patch]: `// kilocode_change - Host policy plugins registered for the post phase must win over config overlays.`

### `packages/core/src/plugin/system-prompt.ts`

Classification: patch/override marker; tracked. 1 occurrence.

- L38 [patch]: `// kilocode_change - Public exports of the maintained Anthropic/Trinity assets so the Kilo CLI`

### `packages/core/test/config/config.test.ts`

Classification: patch/override marker; tracked. 1 occurrence.

- L79 [patch]: `// kilocode_change - explicit refresh must retain dependencies outside the caller's Effect context.`

### `packages/kilo-ide-ui/src/components/basic-tool.tsx`

Classification: patch/override marker; untracked. 17 occurrences.

- L6 [patch]: `import { Icon, type IconProps } from "./icon" // kilocode_change: added Icon`
- L36 [patch]: `retainDetails?: boolean // kilocode_change`
- L37 [patch]: `hasDetails?: boolean // kilocode_change`
- L40 [patch]: `allowPendingToggle?: boolean // kilocode_change`
- L95 [patch]: `const hasDetails = () => props.hasDetails ?? !!hasChildren() // kilocode_change`
- L137 [patch]: `if (!props.retainDetails) setState("ready", false) // kilocode_change`
- L180 [patch]: `if (pending() && !props.allowPendingToggle) return // kilocode_change`
- L181 [patch]: `if (props.hideDetails) return // kilocode_change`
- L184 [patch]: `props.onOpenChange?.(value) // kilocode_change`
- L187 [patch]: `// kilocode_change start`
- L193 [patch]: `// kilocode_change end`
- L202 [patch]: `{/* kilocode_change start */}`
- L206 [patch]: `{/* kilocode_change end */}`
- L265 [patch]: `{/* kilocode_change start */}`
- L276 [patch]: `{/* kilocode_change end */}`
- L317 [patch]: `{/* kilocode_change start */}`
- L323 [patch]: `{/* kilocode_change end */}`

### `packages/kilo-ide-ui/src/components/button.css`

Classification: patch/override marker; untracked. 1 occurrence.

- L1 [patch]: `/* kilocode_change - reverted to main */`

### `packages/kilo-ide-ui/src/components/card.css`

Classification: patch/override marker; untracked. 4 occurrences.

- L10 [patch]: `/* kilocode_change start — preserve Kilo's bordered card surface */`
- L16 [patch]: `/* kilocode_change end */`
- L88 [patch]: `/* kilocode_change start — preserve Kilo error and warning card variants */`
- L121 [patch]: `/* kilocode_change end */`

### `packages/kilo-ide-ui/src/components/dock-surface.tsx`

Classification: patch/override marker; untracked. 1 occurrence.

- L28 [patch]: `data-component="prompt-input-form" // kilocode_change`

### `packages/kilo-ide-ui/src/components/icon.tsx`

Classification: patch/override marker; untracked. 2 occurrences.

- L89 [patch]: `lock: \`<path d="M5.833 8.33366V6.25033C5.833 3.71903 7.96805 1.66699 10.4993 1.66699C13.0307 1.66699 15.166 3.71903 15.166 6.25033V8.33366M4.16634 8.33366H16.833C17.7535 8.33366 18.4997 9.07985 18.4997 10.0003V16.667C18.4997 17.5875 17.7535`
- L113 [patch]: `discard: \`<path d="M7.5 5L4.167 8.333L7.5 11.667M4.583 8.333h6.667a4.167 4.167 0 0 1 4.167 4.167" stroke="currentColor" stroke-linecap="square"/>\`, // kilocode_change`

### `packages/kilo-ide-ui/src/components/list.tsx`

Classification: patch/override marker; untracked. 2 occurrences.

- L184 [patch]: `// kilocode_change start - fall back to first result when no item is active (noInitialSelection)`
- L187 [patch]: `// kilocode_change end`

### `packages/kilo-ide-ui/src/components/markdown-shiki.worker.ts`

Classification: patch/override marker; untracked. 2 occurrences.

- L23 [patch]: `let theme = "Kilo" // kilocode_change - use the Kilo theme supplied during worker initialization`
- L32 [patch]: `theme = event.data.theme.name // kilocode_change`

### `packages/kilo-ide-ui/src/components/markdown-worker.ts`

Classification: patch/override marker; untracked. 2 occurrences.

- L2 [patch]: `import { KiloTheme } from "../context/marked" // kilocode_change`
- L120 [patch]: `worker.postMessage({ type: "init", theme: KiloTheme } satisfies MarkdownWorkerRequest) // kilocode_change`

### `packages/kilo-ide-ui/src/components/markdown.css`

Classification: patch/override marker; untracked. 10 occurrences.

- L69 [patch]: `margin-inline-start: 0; /* kilocode_change */`
- L70 [patch]: `padding-inline-start: 32px; /* kilocode_change */`
- L80 [patch]: `padding-inline-start: 2.25rem; /* kilocode_change */`
- L106 [patch]: `padding-inline-start: 1rem; /* Minimal indent for nesting only */ /* kilocode_change */`
- L110 [patch]: `padding-inline-start: 1.75rem; /* kilocode_change */`
- L115 [patch]: `border-inline-start: 2px solid var(--border-weak-base); /* kilocode_change */`
- L117 [patch]: `padding-inline-start: 0.5rem; /* kilocode_change */`
- L235 [patch]: `/* kilocode_change start */`
- L248 [patch]: `/* kilocode_change end */`
- L266 [patch]: `text-align: start; /* kilocode_change */`

### `packages/kilo-ide-ui/src/components/markdown.tsx`

Classification: patch/override marker; untracked. 37 occurrences.

- L2 [patch]: `import { deferredHighlight, fnv1a } from "../context/marked" // kilocode_change`
- L29 [patch]: `// kilocode_change start: Mermaid rendering and morphdom guards for highlighted blocks`
- L32 [patch]: `// kilocode_change end`
- L46 [patch]: `src: string // kilocode_change - Mermaid consumes delimiter-free source while raw preserves stream identity`
- L380 [patch]: `// kilocode_change start: mermaid blocks are rendered as diagrams by`
- L389 [patch]: `src: block.src, // kilocode_change`
- L398 [patch]: `// kilocode_change end`
- L406 [patch]: `src: block.src, // kilocode_change`
- L452 [patch]: `// kilocode_change start: generation counter prevents stale deferredHighlight`
- L455 [patch]: `// kilocode_change end`
- L457 [patch]: `// kilocode_change start: Mermaid diagram rendering`
- L459 [patch]: `// kilocode_change end`
- L470 [patch]: `// kilocode_change start: Mermaid diagram rendering`
- L473 [patch]: `// kilocode_change end`
- L487 [patch]: `content.forEach((block, index) => updateBlock(container, index, block, labels, local.streaming ?? false)) // kilocode_change`
- L498 [patch]: `// kilocode_change start: progressive Shiki highlighting for non-streaming`
- L519 [patch]: `// kilocode_change end`
- L522 [patch]: `// kilocode_change start: progressive Shiki highlighting (issue #6221, PR #7102).`
- L543 [patch]: `// kilocode_change end`
- L545 [patch]: `// kilocode_change start: Mermaid diagram rendering`
- L560 [patch]: `// kilocode_change end`
- L563 [patch]: `// kilocode_change: cancel any in-flight deferredHighlight pass so its`
- L567 [patch]: `// kilocode_change start: Mermaid diagram rendering`
- L570 [patch]: `// kilocode_change end`
- L579 [patch]: `dir={"auto" /* kilocode_change */}`
- L609 [patch]: `src: block.src, // kilocode_change`
- L629 [patch]: `streaming: boolean, // kilocode_change`
- L664 [patch]: `// kilocode_change start: preserve "copied" visual state across re-renders`
- L666 [patch]: `// kilocode_change end`
- L670 [patch]: `// kilocode_change start: preserve rendered Mermaid diagrams across`
- L673 [patch]: `// kilocode_change end`
- L674 [patch]: `// kilocode_change start: preserve Shiki-highlighted blocks — don't let`
- L693 [patch]: `// kilocode_change end`
- L713 [patch]: `// kilocode_change start: mermaid blocks render as a source <pre> for`
- L723 [patch]: `codeElement.textContent = block.src // kilocode_change - Mermaid rejects fenced Markdown as diagram source`
- L732 [patch]: `// kilocode_change end`
- L768 [patch]: `pre.setAttribute("dir", "auto") // kilocode_change`

### `packages/kilo-ide-ui/src/components/message-part.css`

Classification: patch/override marker; untracked. 12 occurrences.

- L24 [patch]: `gap: 8px; /* kilocode_change */`
- L46 [patch]: `cursor: pointer; /* kilocode_change */`
- L185 [patch]: `gap: 6px; /* kilocode_change */`
- L252 [patch]: `/* kilocode_change: always show copy button for the final turn response */`
- L485 [patch]: `/* kilocode_change start */`
- L495 [patch]: `/* kilocode_change end */`
- L513 [patch]: `/* kilocode_change start */`
- L523 [patch]: `/* kilocode_change end */`
- L1290 [patch]: `/* kilocode_change start */`
- L1300 [patch]: `/* kilocode_change end */`
- L1345 [patch]: `/* kilocode_change start */`
- L1354 [patch]: `/* kilocode_change end */`

### `packages/kilo-ide-ui/src/components/message-part.tsx`

Classification: patch/override marker; untracked. 12 occurrences.

- L163 [patch]: `queued?: boolean // kilocode_change`
- L859 [patch]: `queued={props.queued} // kilocode_change`
- L1065 [patch]: `queued?: boolean // kilocode_change`
- L1155 [patch]: `data-queued={props.queued ? "" : undefined} // kilocode_change`
- L1181 [patch]: `<div data-slot="user-message-text" dir="auto" data-queued={props.queued ? "" : undefined}>{/* kilocode_change */}`
- L1184 [patch]: `{/* kilocode_change start */}`
- L1190 [patch]: `{/* kilocode_change end */}`
- L1555 [patch]: `// kilocode_change start`
- L1567 [patch]: `// kilocode_change end`
- L1570 [patch]: `.filter((item): item is TextPart => item?.type === "text" && !!item.text?.trim() && !item.synthetic) // kilocode_change`
- L1575 [patch]: `if (part().synthetic) return false // kilocode_change`
- L1593 [patch]: `<Show when={text() && showSyntheticPart() /* kilocode_change */}>`

### `packages/kilo-ide-ui/src/components/popover.tsx`

Classification: patch/override marker; untracked. 5 occurrences.

- L23 [patch]: `contentLabel?: string // kilocode_change`
- L38 [patch]: `"contentLabel", // kilocode_change`
- L57 [patch]: `ready: true, // kilocode_change`
- L141 [patch]: `aria-label={local.contentLabel /* kilocode_change */}`
- L163 [patch]: `if (opened() \|\| state.dismiss === "outside") event.preventDefault() // kilocode_change`

### `packages/kilo-ide-ui/src/components/resize-handle.tsx`

Classification: patch/override marker; untracked. 4 occurrences.

- L35 [patch]: `// kilocode_change start - set resize cursor on body during drag`
- L37 [patch]: `// kilocode_change end`
- L40 [patch]: `document.body.style.cursor = cursor // kilocode_change`
- L60 [patch]: `document.body.style.cursor = "" // kilocode_change`

### `packages/kilo-ide-ui/src/components/select.css`

Classification: patch/override marker; untracked. 1 occurrence.

- L172 [patch]: `max-width: min(23rem, var(--kb-popper-content-available-width)); /* kilocode_change */`

### `packages/kilo-ide-ui/src/components/select.test.ts`

Classification: patch/override marker; untracked. 1 occurrence.

- L1 [patch]: `// kilocode_change - new file`

### `packages/kilo-ide-ui/src/components/select.tsx`

Classification: patch/override marker; untracked. 3 occurrences.

- L92 [patch]: `overlap={local.triggerVariant === "settings"} // kilocode_change`
- L93 [patch]: `fitViewport={local.triggerVariant === "settings"} // kilocode_change`
- L94 [patch]: `overflowPadding={local.triggerVariant === "settings" ? 12 : undefined} // kilocode_change`

### `packages/kilo-ide-ui/src/components/session-turn.tsx`

Classification: patch/override marker; untracked. 7 occurrences.

- L162 [patch]: `queued?: boolean // kilocode_change`
- L209 [patch]: `if (typeof props.active === "boolean" && typeof props.queued === "boolean") return // kilocode_change`
- L234 [patch]: `// kilocode_change start — restore queued feature`
- L244 [patch]: `// kilocode_change end`
- L386 [patch]: `if (queued()) return false // kilocode_change`
- L415 [patch]: `{/* kilocode_change start */}`
- L417 [patch]: `{/* kilocode_change end */}`

### `packages/kilo-ide-ui/src/components/switch.tsx`

Classification: patch/override marker; untracked. 4 occurrences.

- L8 [patch]: `inputProps?: ComponentProps<typeof Kobalte.Input> // kilocode_change`
- L12 [patch]: `// kilocode_change start`
- L14 [patch]: `// kilocode_change end`
- L17 [patch]: `<Kobalte.Input {...local.inputProps} data-slot="switch-input" /> {/* kilocode_change */}`

### `packages/kilo-ide-ui/src/components/text-shimmer.css`

Classification: patch/override marker; untracked. 2 occurrences.

- L24 [patch]: `white-space: pre; /* kilocode_change - preserve inactive fallback whitespace */`
- L59 [patch]: `/* kilocode_change — gate animation on data-active directly (was data-run`

### `packages/kilo-ide-ui/src/components/text-shimmer.tsx`

Classification: patch/override marker; untracked. 2 occurrences.

- L1 [patch]: `// kilocode_change start — the previous implementation used a createEffect that`
- L51 [patch]: `// kilocode_change end`

### `packages/kilo-ide-ui/src/components/todo-panel-motion.stories.tsx`

Classification: patch/override marker; untracked. 8 occurrences.

- L2 [patch]: `import { createMemo, onCleanup } from "solid-js" // kilocode_change`
- L13 [patch]: `// kilocode_change start`
- L16 [patch]: `// kilocode_change end`
- L142 [patch]: `collapsed: false, // kilocode_change`
- L184 [patch]: `// kilocode_change start`
- L191 [patch]: `// kilocode_change end`
- L254 [patch]: `{/* kilocode_change start */}`
- L280 [patch]: `{/* kilocode_change end */}`

### `packages/kilo-ide-ui/src/components/tool-error-card.css`

Classification: patch/override marker; untracked. 2 occurrences.

- L3 [patch]: `background-color: transparent; /* kilocode_change — override restored card background */`
- L4 [patch]: `border: none; /* kilocode_change — override restored card border */`

### `packages/kilo-ide-ui/src/context/data.tsx`

Classification: patch/override marker; untracked. 17 occurrences.

- L44 [patch]: `// kilocode_change start`
- L49 [patch]: `before?: string // kilocode_change - optional, kilo uses \`patch\``
- L50 [patch]: `after?: string // kilocode_change - optional, kilo uses \`patch\``
- L51 [patch]: `patch?: string // kilocode_change`
- L58 [patch]: `export type OpenContentFn = (content: string, language?: string) => void // kilocode_change`
- L60 [patch]: `export type ValidateFilesFn = (paths: string[]) => Promise<string[]> // kilocode_change`
- L61 [patch]: `// kilocode_change end`
- L70 [patch]: `onOpenFile?: OpenFileFn // kilocode_change`
- L71 [patch]: `onOpenDiff?: OpenDiffFn // kilocode_change`
- L72 [patch]: `onOpenUrl?: OpenUrlFn // kilocode_change`
- L73 [patch]: `onOpenContent?: OpenContentFn // kilocode_change`
- L74 [patch]: `onValidateFiles?: ValidateFilesFn // kilocode_change`
- L85 [patch]: `openFile: props.onOpenFile, // kilocode_change`
- L86 [patch]: `openDiff: props.onOpenDiff, // kilocode_change`
- L87 [patch]: `openUrl: props.onOpenUrl, // kilocode_change`
- L88 [patch]: `openContent: props.onOpenContent, // kilocode_change`
- L89 [patch]: `validateFiles: props.onValidateFiles, // kilocode_change`

### `packages/kilo-ide-ui/src/context/index.ts`

Classification: patch/override marker; untracked. 1 occurrence.

- L2 [patch]: `export * from "./data" // kilocode_change - Kilo typechecks packages/ui, whose components import useData from here`

### `packages/kilo-ide-ui/src/context/marked.tsx`

Classification: patch/override marker; untracked. 33 occurrences.

- L2 [patch]: `// kilocode_change: marked-shiki highlighted code blocks synchronously during`
- L9 [patch]: `// kilocode_change start: import types for double-dollar math extension`
- L11 [patch]: `// kilocode_change end`
- L13 [patch]: `import { parseFilePath } from "../file-path" // kilocode_change`
- L15 [patch]: `import { getSharedHighlighter, type ThemeRegistrationResolved } from "@pierre/diffs" // kilocode_change`
- L16 [patch]: `import { ensureKiloDiffTheme, KILO_DIFF_THEME } from "../pierre/kilo-diff-theme" // kilocode_change`
- L18 [patch]: `// kilocode_change start: the "Kilo" diff/highlight theme registration moved to`
- L25 [patch]: `// kilocode_change end`
- L27 [patch]: `// kilocode_change start: theme object consumed by the streaming Shiki worker`
- L401 [patch]: `// kilocode_change end`
- L403 [patch]: `// kilocode_change start: double-dollar-only math rules for marked.`
- L406 [patch]: `// kilocode_change end`
- L408 [patch]: `// kilocode_change start: isolate KaTeX from the markdown root dir=auto.`
- L413 [patch]: `// kilocode_change end`
- L422 [patch]: `// kilocode_change start`
- L427 [patch]: `// kilocode_change end`
- L433 [patch]: `// kilocode_change: removed single-dollar inline math ($...$) rendering.`
- L499 [patch]: `// kilocode_change: parseFilePath imported from ../file-path`
- L501 [patch]: `// kilocode_change start: highlight cache for deferred highlighting`
- L541 [patch]: `const dir = pre.getAttribute("dir") // kilocode_change`
- L542 [patch]: `if (dir) highlighted.setAttribute("dir", dir) // kilocode_change`
- L652 [patch]: `// kilocode_change end`
- L654 [patch]: `// kilocode_change start: expose the parser setup for Kilo markdown tests.`
- L656 [patch]: `// kilocode_change start: two-pass parser — first pass skips Shiki highlighting`
- L667 [patch]: `// kilocode_change start`
- L698 [patch]: `// kilocode_change end`
- L700 [patch]: `// kilocode_change start: Marked accepts a tilde preceded by an opening`
- L710 [patch]: `// kilocode_change end`
- L712 [patch]: `// kilocode_change start: enable only double-dollar math.`
- L760 [patch]: `// kilocode_change end`
- L761 [patch]: `// kilocode_change: markedShiki removed — the custom \`code\` renderer`
- L766 [patch]: `// kilocode_change end`
- L786 [patch]: `// kilocode_change end`

### `packages/kilo-ide-ui/src/file-path.test.ts`

Classification: patch/override marker; untracked. 1 occurrence.

- L1 [patch]: `// kilocode_change - new file`

### `packages/kilo-ide-ui/src/file-path.ts`

Classification: patch/override marker; untracked. 1 occurrence.

- L1 [patch]: `// kilocode_change - new file`

### `packages/kilo-ide-ui/src/i18n/ar.ts`

Classification: patch/override marker; untracked. 6 occurrences.

- L108 [patch]: `// kilocode_change start`
- L119 [patch]: `// kilocode_change end`
- L124 [patch]: `"ui.tool.swePruned": "SWE-Pruner · تم الاحتفاظ بـ {{kept}} من {{total}} سطرًا", // kilocode_change`
- L160 [patch]: `"ui.message.deleteQueued": "حذف الرسالة من قائمة الانتظار", // kilocode_change`
- L176 [patch]: `"ui.question.subtitle.dismissed": "{{count}} dismissed", // kilocode_change`
- L178 [patch]: `"ui.question.answer.dismissed": "Dismissed", // kilocode_change`

### `packages/kilo-ide-ui/src/i18n/br.ts`

Classification: patch/override marker; untracked. 6 occurrences.

- L108 [patch]: `// kilocode_change start`
- L119 [patch]: `// kilocode_change end`
- L124 [patch]: `"ui.tool.swePruned": "SWE-Pruner · {{kept}} de {{total}} linhas mantidas", // kilocode_change`
- L160 [patch]: `"ui.message.deleteQueued": "Excluir mensagem na fila", // kilocode_change`
- L176 [patch]: `"ui.question.subtitle.dismissed": "{{count}} dismissed", // kilocode_change`
- L178 [patch]: `"ui.question.answer.dismissed": "Dismissed", // kilocode_change`

### `packages/kilo-ide-ui/src/i18n/bs.ts`

Classification: patch/override marker; untracked. 6 occurrences.

- L112 [patch]: `// kilocode_change start`
- L123 [patch]: `// kilocode_change end`
- L128 [patch]: `"ui.tool.swePruned": "SWE-Pruner · zadržano {{kept}} od {{total}} redova", // kilocode_change`
- L164 [patch]: `"ui.message.deleteQueued": "Obriši poruku iz reda", // kilocode_change`
- L180 [patch]: `"ui.question.subtitle.dismissed": "{{count}} dismissed", // kilocode_change`
- L182 [patch]: `"ui.question.answer.dismissed": "Dismissed", // kilocode_change`

### `packages/kilo-ide-ui/src/i18n/da.ts`

Classification: patch/override marker; untracked. 6 occurrences.

- L107 [patch]: `// kilocode_change start`
- L118 [patch]: `// kilocode_change end`
- L123 [patch]: `"ui.tool.swePruned": "SWE-Pruner · {{kept}} af {{total}} linjer beholdt", // kilocode_change`
- L159 [patch]: `"ui.message.deleteQueued": "Slet besked i kø", // kilocode_change`
- L175 [patch]: `"ui.question.subtitle.dismissed": "{{count}} dismissed", // kilocode_change`
- L177 [patch]: `"ui.question.answer.dismissed": "Dismissed", // kilocode_change`

### `packages/kilo-ide-ui/src/i18n/de.ts`

Classification: patch/override marker; untracked. 6 occurrences.

- L113 [patch]: `// kilocode_change start`
- L124 [patch]: `// kilocode_change end`
- L129 [patch]: `"ui.tool.swePruned": "SWE-Pruner · {{kept}} von {{total}} Zeilen behalten", // kilocode_change`
- L165 [patch]: `"ui.message.deleteQueued": "Nachricht in Warteschlange löschen", // kilocode_change`
- L181 [patch]: `"ui.question.subtitle.dismissed": "{{count}} dismissed", // kilocode_change`
- L183 [patch]: `"ui.question.answer.dismissed": "Dismissed", // kilocode_change`

### `packages/kilo-ide-ui/src/i18n/en.ts`

Classification: patch/override marker; untracked. 6 occurrences.

- L114 [patch]: `// kilocode_change start`
- L125 [patch]: `// kilocode_change end`
- L130 [patch]: `"ui.tool.swePruned": "SWE-Pruner · kept {{kept}} of {{total}} lines", // kilocode_change`
- L172 [patch]: `"ui.message.deleteQueued": "Delete queued message", // kilocode_change`
- L189 [patch]: `"ui.question.subtitle.dismissed": "{{count}} dismissed", // kilocode_change`
- L191 [patch]: `"ui.question.answer.dismissed": "Dismissed", // kilocode_change`

### `packages/kilo-ide-ui/src/i18n/es.ts`

Classification: patch/override marker; untracked. 6 occurrences.

- L108 [patch]: `// kilocode_change start`
- L119 [patch]: `// kilocode_change end`
- L124 [patch]: `"ui.tool.swePruned": "SWE-Pruner · {{kept}} de {{total}} líneas conservadas", // kilocode_change`
- L160 [patch]: `"ui.message.deleteQueued": "Eliminar mensaje en cola", // kilocode_change`
- L176 [patch]: `"ui.question.subtitle.dismissed": "{{count}} dismissed", // kilocode_change`
- L178 [patch]: `"ui.question.answer.dismissed": "Dismissed", // kilocode_change`

### `packages/kilo-ide-ui/src/i18n/fr.ts`

Classification: patch/override marker; untracked. 6 occurrences.

- L108 [patch]: `// kilocode_change start`
- L119 [patch]: `// kilocode_change end`
- L124 [patch]: `"ui.tool.swePruned": "SWE-Pruner · {{kept}} lignes conservées sur {{total}}", // kilocode_change`
- L160 [patch]: `"ui.message.deleteQueued": "Supprimer le message en file d'attente", // kilocode_change`
- L176 [patch]: `"ui.question.subtitle.dismissed": "{{count}} dismissed", // kilocode_change`
- L178 [patch]: `"ui.question.answer.dismissed": "Dismissed", // kilocode_change`

### `packages/kilo-ide-ui/src/i18n/it.ts`

Classification: patch/override marker; untracked. 5 occurrences.

- L1 [patch]: `// kilocode_change - new file`
- L134 [patch]: `"ui.tool.swePruned": "SWE-Pruner · {{kept}} di {{total}} righe mantenute", // kilocode_change`
- L173 [patch]: `"ui.message.deleteQueued": "Elimina il messaggio in coda", // kilocode_change`
- L191 [patch]: `"ui.question.subtitle.dismissed": "{{count}} dismissed", // kilocode_change`
- L193 [patch]: `"ui.question.answer.dismissed": "Dismissed", // kilocode_change`

### `packages/kilo-ide-ui/src/i18n/ja.ts`

Classification: patch/override marker; untracked. 6 occurrences.

- L107 [patch]: `// kilocode_change start`
- L118 [patch]: `// kilocode_change end`
- L123 [patch]: `"ui.tool.swePruned": "SWE-Pruner · {{total}} 行中 {{kept}} 行を保持", // kilocode_change`
- L159 [patch]: `"ui.message.deleteQueued": "キュー内のメッセージを削除", // kilocode_change`
- L175 [patch]: `"ui.question.subtitle.dismissed": "{{count}} dismissed", // kilocode_change`
- L177 [patch]: `"ui.question.answer.dismissed": "Dismissed", // kilocode_change`

### `packages/kilo-ide-ui/src/i18n/ko.ts`

Classification: patch/override marker; untracked. 6 occurrences.

- L108 [patch]: `// kilocode_change start`
- L119 [patch]: `// kilocode_change end`
- L124 [patch]: `"ui.tool.swePruned": "SWE-Pruner · {{total}}줄 중 {{kept}}줄 유지", // kilocode_change`
- L160 [patch]: `"ui.message.deleteQueued": "대기 중인 메시지 삭제", // kilocode_change`
- L176 [patch]: `"ui.question.subtitle.dismissed": "{{count}} dismissed", // kilocode_change`
- L178 [patch]: `"ui.question.answer.dismissed": "Dismissed", // kilocode_change`

### `packages/kilo-ide-ui/src/i18n/nl.ts`

Classification: patch/override marker; untracked. 8 occurrences.

- L56 [patch]: `// kilocode_change start - complete upstream usage-exceeded translations`
- L65 [patch]: `// kilocode_change end`
- L111 [patch]: `// kilocode_change start`
- L122 [patch]: `// kilocode_change end`
- L137 [patch]: `"ui.tool.swePruned": "SWE-Pruner · {{kept}} van {{total}} regels behouden", // kilocode_change`
- L176 [patch]: `"ui.message.deleteQueued": "Bericht in wachtrij verwijderen", // kilocode_change`
- L194 [patch]: `"ui.question.subtitle.dismissed": "{{count}} dismissed", // kilocode_change`
- L196 [patch]: `"ui.question.answer.dismissed": "Dismissed", // kilocode_change`

### `packages/kilo-ide-ui/src/i18n/no.ts`

Classification: patch/override marker; untracked. 6 occurrences.

- L111 [patch]: `// kilocode_change start`
- L122 [patch]: `// kilocode_change end`
- L127 [patch]: `"ui.tool.swePruned": "SWE-Pruner · {{kept}} av {{total}} linjer beholdt", // kilocode_change`
- L163 [patch]: `"ui.message.deleteQueued": "Slett melding i kø", // kilocode_change`
- L179 [patch]: `"ui.question.subtitle.dismissed": "{{count}} dismissed", // kilocode_change`
- L181 [patch]: `"ui.question.answer.dismissed": "Dismissed", // kilocode_change`

### `packages/kilo-ide-ui/src/i18n/pl.ts`

Classification: patch/override marker; untracked. 6 occurrences.

- L107 [patch]: `// kilocode_change start`
- L118 [patch]: `// kilocode_change end`
- L123 [patch]: `"ui.tool.swePruned": "SWE-Pruner · zachowano {{kept}} z {{total}} wierszy", // kilocode_change`
- L159 [patch]: `"ui.message.deleteQueued": "Usuń wiadomość z kolejki", // kilocode_change`
- L175 [patch]: `"ui.question.subtitle.dismissed": "{{count}} dismissed", // kilocode_change`
- L177 [patch]: `"ui.question.answer.dismissed": "Dismissed", // kilocode_change`

### `packages/kilo-ide-ui/src/i18n/ru.ts`

Classification: patch/override marker; untracked. 6 occurrences.

- L107 [patch]: `// kilocode_change start`
- L118 [patch]: `// kilocode_change end`
- L123 [patch]: `"ui.tool.swePruned": "SWE-Pruner · сохранено {{kept}} из {{total}} строк", // kilocode_change`
- L159 [patch]: `"ui.message.deleteQueued": "Удалить сообщение из очереди", // kilocode_change`
- L175 [patch]: `"ui.question.subtitle.dismissed": "{{count}} dismissed", // kilocode_change`
- L177 [patch]: `"ui.question.answer.dismissed": "Dismissed", // kilocode_change`

### `packages/kilo-ide-ui/src/i18n/th.ts`

Classification: patch/override marker; untracked. 6 occurrences.

- L109 [patch]: `// kilocode_change start`
- L120 [patch]: `// kilocode_change end`
- L125 [patch]: `"ui.tool.swePruned": "SWE-Pruner · เก็บไว้ {{kept}} จาก {{total}} บรรทัด", // kilocode_change`
- L161 [patch]: `"ui.message.deleteQueued": "ลบข้อความที่อยู่ในคิว", // kilocode_change`
- L177 [patch]: `"ui.question.subtitle.dismissed": "{{count}} dismissed", // kilocode_change`
- L179 [patch]: `"ui.question.answer.dismissed": "Dismissed", // kilocode_change`

### `packages/kilo-ide-ui/src/i18n/tr.ts`

Classification: patch/override marker; untracked. 6 occurrences.

- L114 [patch]: `// kilocode_change start`
- L125 [patch]: `// kilocode_change end`
- L130 [patch]: `"ui.tool.swePruned": "SWE-Pruner · {{total}} satırdan {{kept}} tanesi korundu", // kilocode_change`
- L166 [patch]: `"ui.message.deleteQueued": "Kuyruktaki mesajı sil", // kilocode_change`
- L182 [patch]: `"ui.question.subtitle.dismissed": "{{count}} dismissed", // kilocode_change`
- L184 [patch]: `"ui.question.answer.dismissed": "Dismissed", // kilocode_change`

### `packages/kilo-ide-ui/src/i18n/uk.ts`

Classification: patch/override marker; untracked. 28 occurrences.

- L15 [patch]: `// kilocode_change start`
- L18 [patch]: `// kilocode_change end`
- L29 [patch]: `"ui.fileMedia.state.unavailable": "Попередній перегляд {{kind}} недоступний.", // kilocode_change`
- L31 [patch]: `// kilocode_change start`
- L34 [patch]: `// kilocode_change end`
- L52 [patch]: `"ui.sessionTurn.retry.retrying": "повтор спроби", // kilocode_change`
- L53 [patch]: `"ui.sessionTurn.retry.inSeconds": "через {{seconds}}с", // kilocode_change`
- L56 [patch]: `"ui.sessionTurn.retry.geminiHot": "Gemini зараз перевантажений", // kilocode_change`
- L60 [patch]: `// kilocode_change start - complete upstream usage-exceeded translations`
- L69 [patch]: `// kilocode_change end`
- L72 [patch]: `// kilocode_change start`
- L75 [patch]: `// kilocode_change end`
- L89 [patch]: `// kilocode_change start`
- L92 [patch]: `// kilocode_change end`
- L94 [patch]: `"ui.messagePart.title.write": "Записати", // kilocode_change`
- L96 [patch]: `"ui.messagePart.review.title": "Перегляньте свої відповіді", // kilocode_change`
- L99 [patch]: `// kilocode_change start`
- L102 [patch]: `// kilocode_change end`
- L126 [patch]: `// kilocode_change start`
- L137 [patch]: `// kilocode_change end`
- L138 [patch]: `"ui.scrollView.ariaLabel": "вміст з прокруткою", // kilocode_change`
- L142 [patch]: `"ui.tool.swePruned": "SWE-Pruner · збережено {{kept}} з {{total}} рядків", // kilocode_change`
- L147 [patch]: `"ui.tool.webfetch": "Веб-запит", // kilocode_change`
- L149 [patch]: `"ui.tool.codesearch": "Пошук коду", // kilocode_change`
- L185 [patch]: `"ui.message.deleteQueued": "Видалити повідомлення з черги", // kilocode_change`
- L199 [patch]: `"ui.patch.action.patched": "Застосовано патч", // kilocode_change`
- L202 [patch]: `"ui.question.subtitle.dismissed": "{{count}} dismissed", // kilocode_change`
- L204 [patch]: `"ui.question.answer.dismissed": "Dismissed", // kilocode_change`

### `packages/kilo-ide-ui/src/i18n/zh.ts`

Classification: patch/override marker; untracked. 6 occurrences.

- L111 [patch]: `// kilocode_change start`
- L122 [patch]: `// kilocode_change end`
- L127 [patch]: `"ui.tool.swePruned": "SWE-Pruner · 保留 {{total}} 行中的 {{kept}} 行", // kilocode_change`
- L163 [patch]: `"ui.message.deleteQueued": "删除排队中的消息", // kilocode_change`
- L179 [patch]: `"ui.question.subtitle.dismissed": "{{count}} dismissed", // kilocode_change`
- L181 [patch]: `"ui.question.answer.dismissed": "Dismissed", // kilocode_change`

### `packages/kilo-ide-ui/src/i18n/zht.ts`

Classification: patch/override marker; untracked. 6 occurrences.

- L111 [patch]: `// kilocode_change start`
- L122 [patch]: `// kilocode_change end`
- L127 [patch]: `"ui.tool.swePruned": "SWE-Pruner · 保留 {{total}} 行中的 {{kept}} 行", // kilocode_change`
- L163 [patch]: `"ui.message.deleteQueued": "刪除排隊中的訊息", // kilocode_change`
- L179 [patch]: `"ui.question.subtitle.dismissed": "{{count}} dismissed", // kilocode_change`
- L181 [patch]: `"ui.question.answer.dismissed": "Dismissed", // kilocode_change`

### `packages/kilo-ide-ui/src/pierre/index.ts`

Classification: patch/override marker; untracked. 2 occurrences.

- L4 [patch]: `import { KILO_DIFF_THEME } from "./kilo-diff-theme" // kilocode_change`
- L156 [patch]: `theme: KILO_DIFF_THEME, // kilocode_change`

### `packages/kilo-ide-ui/src/pierre/kilo-diff-theme.ts`

Classification: patch/override marker; untracked. 1 occurrence.

- L1 [patch]: `// kilocode_change - new file`

### `packages/kilo-ide-ui/src/pierre/worker.ts`

Classification: patch/override marker; untracked. 4 occurrences.

- L3 [patch]: `import { ensureKiloDiffTheme, KILO_DIFF_THEME } from "./kilo-diff-theme" // kilocode_change`
- L5 [patch]: `// kilocode_change start: register the "Kilo" theme as a precondition of creating`
- L11 [patch]: `// kilocode_change end`
- L31 [patch]: `theme: KILO_DIFF_THEME, // kilocode_change`

### `packages/kilo-ide-ui/src/styles/index.css`

Classification: patch/override marker; untracked. 1 occurrence.

- L37 [patch]: `@import "../kilocode/markdown-mermaid.css" layer(components); /* kilocode_change */`

### `packages/kilo-ide-ui/src/styles/theme.css`

Classification: patch/override marker; untracked. 2 occurrences.

- L135 [patch]: `--surface-critical-base: #feefeb; /* kilocode_change */`
- L395 [patch]: `--surface-critical-base: #42120b; /* kilocode_change */`

### `packages/kilo-ide-ui/vite.config.ts`

Classification: patch/override marker; untracked. 2 occurrences.

- L39 [patch]: `if (!process.env.KILO_FETCH_PROVIDER_ICONS) return // kilocode_change`
- L43 [patch]: `if (!process.env.KILO_FETCH_PROVIDER_ICONS) return // kilocode_change`

### `packages/kilo-indexing/src/tree-sitter/queries/java.ts`

Classification: patch/override marker; tracked. 1 occurrence.

- L42 [patch]: `type: (_) @definition.method.start ; kilocode_change`

### `packages/kilo-ui/src/styles/index.css`

Classification: patch/override marker; untracked. 2 occurrences.

- L1 [patch]: `/* Wraps upstream styles and adds Kilo overrides */` — near variant
- L7 [patch]: `/* Per-component Kilo overrides */` — near variant

### `packages/kilo-ui/src/styles/tailwind/index.css`

Classification: patch/override marker; untracked. 2 occurrences.

- L1 [patch]: `/* Wraps upstream tailwind styles and adds Kilo overrides */` — near variant
- L7 [patch]: `/* Per-component Kilo overrides */` — near variant

### `packages/kilo-vscode/webview-ui/src/context/language.tsx`

Classification: patch/override marker; untracked. 1 occurrence.

- L4 [patch]: `* Merges UI translations from @opencode-ai/ui and Kilo overrides from @kilocode/kilo-i18n.` — near variant

### `packages/plugin/src/tui/context.ts`

Classification: patch/override marker; tracked. 1 occurrence.

- L179 [patch]: `readonly "home.logo": Readonly<Record<string, never>> // kilocode_change - host-owned Home branding`

### `packages/schema/src/kilocode/presence.ts`

Classification: documentation mention; untracked. 1 occurrence.

- L6 [documentation]: `* a kilocode_change route in the pinned baseline). This module carries no`

### `packages/theme/src/tui/defaults.ts`

Classification: patch/override marker; tracked. 2 occurrences.

- L112 [patch]: `// kilocode_change - text.logo light default`
- L335 [patch]: `// kilocode_change - text.logo dark default`

### `packages/theme/src/tui/fallback.ts`

Classification: patch/override marker; tracked. 1 occurrence.

- L11 [patch]: `logo: DEFAULT_THEME[mode].text.logo, // kilocode_change - retain branding in themes without a logo override`

### `packages/theme/src/tui/schema.ts`

Classification: patch/override marker; tracked. 1 occurrence.

- L109 [patch]: `// kilocode_change - text.logo semantic color role`

### `packages/theme/src/tui/types.ts`

Classification: patch/override marker; tracked. 1 occurrence.

- L31 [patch]: `// kilocode_change - text.logo semantic color role`

### `packages/tui/src/app.tsx`

Classification: patch/override marker; tracked. 2 occurrences.

- L192 [patch]: `pluginDirectories?: string[] // kilocode_change - allow isolated hosts to supply their discovery roots`
- L219 [patch]: `input.pluginDirectories ?? (yield* Effect.promise(() => localPluginDirectories(process.cwd(), global.config))) // kilocode_change - preserve upstream discovery unless the host overrides it`

### `packages/tui/src/component/dialog-agent.tsx`

Classification: patch/override marker; tracked. 1 occurrence.

- L14 [patch]: `title: item.name ?? item.id, // kilocode_change - display agent names; selection keeps the canonical ID`

### `packages/tui/src/component/dialog-integration.tsx`

Classification: patch/override marker; tracked. 3 occurrences.

- L30 [patch]: `kilo: -1, // kilocode_change - recommend Kilo Gateway in Connect`
- L51 [patch]: `Number(b.id === "kilo") - Number(a.id === "kilo") \|\| // kilocode_change - Kilo stays first across categories`
- L117 [patch]: `description: methods.length === 0 ? "Environment only" : integration.id === "kilo" ? "Recommended" : undefined, // kilocode_change - identify the recommended provider`

### `packages/tui/src/component/dialog-model.tsx`

Classification: patch/override marker; tracked. 19 occurrences.

- L1 [patch]: `import { createRenderEffect, createMemo, createSignal, onCleanup } from "solid-js" // kilocode_change - scoped display metadata lifecycle`
- L2 [patch]: `import { useTerminalDimensions } from "@opentui/solid" // kilocode_change - stable picker bounds during metadata loading`
- L14 [patch]: `import { useTuiApp, type TuiModelGroup } from "../context/runtime" // kilocode_change - host-owned picker presentation`
- L22 [patch]: `const presentation = useTuiApp().modelPicker // kilocode_change - do not fork native picker/preferences`
- L23 [patch]: `const dimensions = useTerminalDimensions() // kilocode_change`
- L33 [patch]: `// kilocode_change - metadata is display-only but must not reorder an actionable cold list`
- L75 [patch]: `// kilocode_change - a host-hidden model leaves favorites and recents too`
- L91 [patch]: `// kilocode_change - host disclosures also follow native favorites and recents`
- L119 [patch]: `// kilocode_change - host presentation policy removes flagged Kilo models entirely`
- L130 [patch]: `// kilocode_change - display-only grouping supplied by the host`
- L139 [patch]: `category: connected() ? (group?.category ?? provider?.name ?? model.providerID) : undefined, // kilocode_change`
- L140 [patch]: `groupOrder: group?.order, // kilocode_change - metadata ordering, never model identity`
- L141 [patch]: `footer: [free(model) ? "Free" : undefined, group?.footer].filter(Boolean).join(" · ") \|\| undefined, // kilocode_change - host-owned disclosures`
- L161 [patch]: `presentation?.preferredProviderID, // kilocode_change`
- L198 [patch]: `// kilocode_change - reserve the native list viewport plus search/footer chrome before metadata arrives`
- L273 [patch]: `// kilocode_change - optional host priority; preserve the upstream default`
- L275 [patch]: `const group = (a.groupOrder ?? Infinity) - (b.groupOrder ?? Infinity) // kilocode_change`
- L276 [patch]: `if (group && !Number.isNaN(group)) return group // kilocode_change`
- L277 [patch]: `// kilocode_change - preserve explicit model selection independently of presentation`

### `packages/tui/src/component/prompt/autocomplete.tsx`

Classification: patch/override marker; tracked. 2 occurrences.

- L522 [patch]: `// kilocode_change - mirror dispatch precedence: local names/aliases shadow server commands and skills.`
- L528 [patch]: `if (commandNames.has(serverCommand.name)) continue // kilocode_change - show one executable command`

### `packages/tui/src/component/prompt/index.tsx`

Classification: patch/override marker; tracked. 1 occurrence.

- L1559 [patch]: `agentLabel: agent ? (agent.name ?? Locale.titlecase(agent.id)) : undefined, // kilocode_change - honor host/config presentation without changing agent identity`

### `packages/tui/src/context/local.tsx`

Classification: patch/override marker; tracked. 2 occurrences.

- L26 [patch]: `import { Locale } from "../util/locale" // kilocode_change - display names are independent of durable agent IDs`
- L96 [patch]: `// kilocode_change - honor configured names in transcript and subagent presentation too.`

### `packages/tui/src/context/runtime.tsx`

Classification: patch/override marker; tracked. 5 occurrences.

- L2 [patch]: `import type { LocationRef } from "@opencode-ai/client" // kilocode_change - public host model-presentation boundary`
- L4 [patch]: `// kilocode_change - additive host presentation; native preferences and selection remain TUI-owned`
- L11 [patch]: `// kilocode_change - host presentation policy can hide a model from every dialog section`
- L26 [patch]: `sessionEpilogue?: (input: { title: string; sessionID?: string }) => string // kilocode_change - let isolated hosts own their exit branding`
- L27 [patch]: `modelPicker?: TuiModelPicker // kilocode_change - optional, upstream defaults remain unchanged`

### `packages/tui/src/feature-plugins/sidebar/context.tsx`

Classification: patch/override marker; tracked. 1 occurrence.

- L11 [patch]: `// kilocode_change - collapsible sidebar section with clickable triangle heading and action token`

### `packages/tui/src/routes/home.tsx`

Classification: patch/override marker; tracked. 1 occurrence.

- L85 [patch]: `{/* kilocode_change - Home branding is supplied by the host, with no OpenCode fallback */}`

### `packages/tui/src/routes/session/composer/subagents-tab.tsx`

Classification: patch/override marker; tracked. 4 occurrences.

- L9 [patch]: `import { useLocal } from "../../../context/local" // kilocode_change - names, not canonical IDs, label agents`
- L25 [patch]: `const local = useLocal() // kilocode_change`
- L48 [patch]: `? local.agent.name(session.agent, session.location) // kilocode_change`
- L50 [patch]: `? local.agent.name(agentMatch[1], session.location) // kilocode_change`

### `packages/tui/src/routes/session/index.tsx`

Classification: patch/override marker; tracked. 9 occurrences.

- L206 [patch]: `setEpilogue((app.sessionEpilogue ?? sessionEpilogue)({ title, sessionID: session()?.id })) // kilocode_change - preserve upstream presentation unless the host overrides it`
- L2056 [patch]: `{local.agent.name(props.message.agent) /* kilocode_change - show the name, not its compatibility ID */}`
- L2078 [patch]: `const local = useLocal() // kilocode_change - resolve display names for both sides of a switch`
- L2091 [patch]: `const agent = local.agent.name(props.message.agent) // kilocode_change`
- L2093 [patch]: `return \`Switched agent from ${local.agent.name(props.message.previous)} to ${agent}\` // kilocode_change`
- L2109 [patch]: `const local = useLocal() // kilocode_change - use registered names for subagent notices`
- L2122 [patch]: `const actor = () => (source() === "shell" ? "Shell" : local.agent.name(stringValue(metadata()?.agent) ?? "Subagent")) // kilocode_change`
- L3463 [patch]: `const local = useLocal() // kilocode_change - preserve agent identity while displaying its configured name`
- L3493 [patch]: `: \`${local.agent.name(stringValue(props.input.agent) ?? stringValue(props.input.subagent_type) ?? "General")} Subagent — ${description() ?? "Subagent"}\` /* kilocode_change */`

### `packages/tui/src/util/renderer.ts`

Classification: patch/override marker; tracked. 1 occurrence.

- L8 [patch]: `renderer.screenMode = "main-screen" // kilocode_change - restore the shell before the host prints its epilogue`

### `packages/tui/test/component/session-tabs-mouse.test.tsx`

Classification: patch/override marker; tracked. 3 occurrences.

- L70 [patch]: `// kilocode_change - a terminal context menu can consume the right-button release.`
- L135 [patch]: `// kilocode_change - dismissing rename must release the tab menu's mouse capture.`
- L163 [patch]: `// kilocode_change - closing the context menu must leave ordinary tab clicks functional.`

### `packages/tui/test/feature-plugins/sidebar-context.test.tsx`

Classification: patch/override marker; tracked. 1 occurrence.

- L11 [patch]: `// kilocode_change - provide semantic action token for collapsible heading`

### `plans/kilo-opencode-v2-port.md`

Classification: documentation mention; tracked. 2 occurrences.

- L562 [documentation]: `- Keep shared upstream changes minimal and mark them with \`kilocode_change\`.`
- L584 [documentation]: `- Preserve \`kilocode_change\` markers in shared upstream files and keep Kilo`

