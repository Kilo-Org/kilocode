import { Component, For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { Select } from "@kilocode/kilo-ui/select"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import type { PermissionLevel, PermissionRule } from "../../types/messages"

interface LevelOption {
  value: PermissionLevel
  labelKey: string
}

const LEVEL_OPTIONS: LevelOption[] = [
  { value: "allow", labelKey: "settings.autoApprove.level.allow" },
  { value: "ask", labelKey: "settings.autoApprove.level.ask" },
  { value: "deny", labelKey: "settings.autoApprove.level.deny" },
]

interface GranularConfig {
  wildcardKey: string
  addKey: string
  placeholderKey: string
}

interface ToolDef {
  id: string
  descriptionKey: string
  granular?: GranularConfig
}

interface GranularToolDef extends ToolDef {
  granular: GranularConfig
}

/** Grouped tool: maps a single UI row to multiple config keys */
interface GroupedToolDef {
  ids: string[]
  label: string
  descriptionKey: string
}

const GRANULAR_TOOLS: GranularToolDef[] = [
  {
    id: "external_directory",
    descriptionKey: "settings.autoApprove.tool.external_directory",
    granular: {
      wildcardKey: "settings.autoApprove.wildcardLabel.paths",
      addKey: "settings.autoApprove.addPath",
      placeholderKey: "settings.autoApprove.placeholder.path",
    },
  },
  {
    id: "bash",
    descriptionKey: "settings.autoApprove.tool.bash",
    granular: {
      wildcardKey: "settings.autoApprove.wildcardLabel.commands",
      addKey: "settings.autoApprove.addCommand",
      placeholderKey: "settings.autoApprove.placeholder.command",
    },
  },
  {
    id: "read",
    descriptionKey: "settings.autoApprove.tool.read",
    granular: {
      wildcardKey: "settings.autoApprove.wildcardLabel.paths",
      addKey: "settings.autoApprove.addPath",
      placeholderKey: "settings.autoApprove.placeholder.path",
    },
  },
  {
    id: "edit",
    descriptionKey: "settings.autoApprove.tool.edit",
    granular: {
      wildcardKey: "settings.autoApprove.wildcardLabel.paths",
      addKey: "settings.autoApprove.addPath",
      placeholderKey: "settings.autoApprove.placeholder.path",
    },
  },
]

const SIMPLE_TOOLS: ToolDef[] = [
  { id: "glob", descriptionKey: "settings.autoApprove.tool.glob" },
  { id: "grep", descriptionKey: "settings.autoApprove.tool.grep" },
  { id: "list", descriptionKey: "settings.autoApprove.tool.list" },
  { id: "task", descriptionKey: "settings.autoApprove.tool.task" },
  { id: "skill", descriptionKey: "settings.autoApprove.tool.skill" },
  { id: "lsp", descriptionKey: "settings.autoApprove.tool.lsp" },
]

const GROUPED_TOOLS: GroupedToolDef[] = [
  {
    ids: ["todoread", "todowrite"],
    label: "todoread / todowrite",
    descriptionKey: "settings.autoApprove.tool.todoreadwrite",
  },
  {
    ids: ["websearch", "codesearch"],
    label: "websearch / codesearch",
    descriptionKey: "settings.autoApprove.tool.websearchcodesearch",
  },
]

const TRAILING_TOOLS: ToolDef[] = [
  { id: "webfetch", descriptionKey: "settings.autoApprove.tool.webfetch" },
  { id: "doom_loop", descriptionKey: "settings.autoApprove.tool.doom_loop" },
]

/**
 * Backend default permission levels — mirrors the base defaults defined in
 * packages/opencode/src/agent/agent.ts (lines 61-78). The global default
 * is "*": "allow"; these are the per-tool overrides. If the backend defaults
 * change, this map must be updated to match.
 */
const TOOL_DEFAULTS: Partial<Record<string, PermissionLevel>> = {
  bash: "ask",
  doom_loop: "ask",
  external_directory: "ask",
}

const RESTRICTION_ORDER: Record<PermissionLevel, number> = { allow: 0, ask: 1, deny: 2 }

/** For grouped tools, return the most restrictive level across all IDs. */
function mostRestrictive(levels: PermissionLevel[]): PermissionLevel {
  return levels.reduce<PermissionLevel>(
    (best, l) => (RESTRICTION_ORDER[l] > RESTRICTION_ORDER[best] ? l : best),
    levels[0] ?? "allow",
  )
}

function wildcardAction(rule: PermissionRule | undefined, fallback: PermissionLevel): PermissionLevel {
  if (!rule) return fallback
  if (typeof rule === "string") return rule
  return rule["*"] ?? fallback
}

function exceptions(rule: PermissionRule | undefined): Array<{ pattern: string; action: PermissionLevel }> {
  if (!rule || typeof rule === "string") return []
  return Object.entries(rule)
    .filter(([key, action]) => key !== "*" && action !== null)
    .map(([pattern, action]) => ({ pattern, action: action as PermissionLevel }))
}

function toolTitle(id: string): string {
  return id
    .split("_")
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ")
    .split(" / ")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" / ")
}

const AutoApproveTab: Component = () => {
  const { config, updateConfig } = useConfig()
  const language = useLanguage()

  const permissions = createMemo(() => config().permission ?? {})

  const globalFallback = createMemo((): PermissionLevel => {
    const star = permissions()["*"]
    if (typeof star === "string") return star
    return "allow" // backend default: "*": "allow" (agent.ts)
  })

  const defaultFor = (tool: string): PermissionLevel => TOOL_DEFAULTS[tool] ?? globalFallback()

  const levelFor = (tool: string): PermissionLevel => wildcardAction(permissions()[tool], defaultFor(tool))

  const ruleFor = (tool: string): PermissionRule | undefined => permissions()[tool]

  const setSimple = (tool: string, level: PermissionLevel) => {
    updateConfig({ permission: { [tool]: level } })
  }

  const setGrouped = (ids: string[], level: PermissionLevel) => {
    const patch: Record<string, PermissionLevel> = {}
    for (const id of ids) patch[id] = level
    updateConfig({ permission: patch })
  }

  const setWildcard = (tool: string, level: PermissionLevel) => {
    const current = ruleFor(tool)
    const excs = exceptions(current)
    if (excs.length === 0) {
      updateConfig({ permission: { [tool]: level } })
      return
    }
    const obj: Record<string, PermissionLevel | null> = { "*": level }
    for (const exc of excs) obj[exc.pattern] = exc.action
    updateConfig({ permission: { [tool]: obj } })
  }

  const setException = (tool: string, pattern: string, level: PermissionLevel) => {
    const current = ruleFor(tool)
    const base: Record<string, PermissionLevel | null> =
      typeof current === "string" ? { "*": current } : { ...(current ?? {}) }
    base[pattern] = level
    updateConfig({ permission: { [tool]: base } })
  }

  const addException = (tool: string, pattern: string) => {
    const current = ruleFor(tool)
    const base: Record<string, PermissionLevel | null> =
      typeof current === "string" ? { "*": current } : { ...(current ?? {}) }
    base[pattern] = "allow"
    updateConfig({ permission: { [tool]: base } })
  }

  const removeException = (tool: string, pattern: string) => {
    const current = ruleFor(tool)
    if (!current || typeof current === "string") return
    // Send a single patch with null for the deleted key.
    // null is a delete sentinel: patchJsonc removes the key from the JSONC file,
    // stripNulls removes it from the optimistic UI.
    updateConfig({ permission: { [tool]: { [pattern]: null } } })
  }

  return (
    <div data-component="auto-approve-settings">
      <div
        style={{
          "font-size": "12px",
          color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
          "padding-bottom": "12px",
          "border-bottom": "1px solid var(--border-weak-base)",
        }}
      >
        {language.t("settings.autoApprove.description")}
      </div>

      <For each={GRANULAR_TOOLS}>
        {(tool) => (
          <GranularToolRow
            tool={tool}
            rule={ruleFor(tool.id)}
            fallback={defaultFor(tool.id)}
            onWildcardChange={(level) => setWildcard(tool.id, level)}
            onExceptionChange={(pattern, level) => setException(tool.id, pattern, level)}
            onExceptionAdd={(pattern) => addException(tool.id, pattern)}
            onExceptionRemove={(pattern) => removeException(tool.id, pattern)}
          />
        )}
      </For>

      <For each={SIMPLE_TOOLS}>
        {(tool) => (
          <SimpleToolRow
            id={tool.id}
            descriptionKey={tool.descriptionKey}
            level={levelFor(tool.id)}
            onChange={(level) => setSimple(tool.id, level)}
          />
        )}
      </For>

      <For each={GROUPED_TOOLS}>
        {(group) => (
          <SimpleToolRow
            id={group.label}
            descriptionKey={group.descriptionKey}
            level={mostRestrictive(group.ids.map(levelFor))}
            onChange={(level) => setGrouped(group.ids, level)}
          />
        )}
      </For>

      <For each={TRAILING_TOOLS}>
        {(tool) => (
          <SimpleToolRow
            id={tool.id}
            descriptionKey={tool.descriptionKey}
            level={levelFor(tool.id)}
            onChange={(level) => setSimple(tool.id, level)}
          />
        )}
      </For>
    </div>
  )
}

const SimpleToolRow: Component<{
  id: string
  descriptionKey: string
  level: PermissionLevel
  onChange: (level: PermissionLevel) => void
}> = (props) => {
  const language = useLanguage()
  return (
    <div
      style={{
        display: "flex",
        gap: "24px",
        "align-items": "flex-start",
        "justify-content": "space-between",
        padding: "12px 0",
        "border-bottom": "1px solid var(--border-weak-base)",
      }}
    >
      <div style={{ flex: 1, "min-width": 0 }}>
        <div style={{ "font-size": "13px", color: "var(--text-strong-base, white)" }}>{toolTitle(props.id)}</div>
        <div
          style={{
            "font-size": "12px",
            color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
            "margin-top": "6px",
          }}
        >
          {language.t(props.descriptionKey)}
        </div>
      </div>
      <ActionSelect level={props.level} onChange={props.onChange} />
    </div>
  )
}

const GranularToolRow: Component<{
  tool: GranularToolDef
  rule: PermissionRule | undefined
  fallback: PermissionLevel
  onWildcardChange: (level: PermissionLevel) => void
  onExceptionChange: (pattern: string, level: PermissionLevel) => void
  onExceptionAdd: (pattern: string) => void
  onExceptionRemove: (pattern: string) => void
}> = (props) => {
  const language = useLanguage()
  const [adding, setAdding] = createSignal(false)
  const [input, setInput] = createSignal("")
  let inputRef: HTMLInputElement | undefined

  createEffect(() => {
    if (adding()) inputRef?.focus()
  })

  const excs = createMemo(() => exceptions(props.rule))
  const level = createMemo(() => wildcardAction(props.rule, props.fallback))

  const submit = () => {
    const val = input().trim()
    if (val) {
      props.onExceptionAdd(val)
      setInput("")
    }
    setAdding(false)
  }

  const cancel = () => {
    setInput("")
    setAdding(false)
  }

  return (
    <div style={{ padding: "12px 0", "border-bottom": "1px solid var(--border-weak-base)" }}>
      {/* Tool header with name and description */}
      <div style={{ display: "flex", gap: "24px", "align-items": "flex-start", "justify-content": "space-between" }}>
        <div style={{ flex: 1, "min-width": 0 }}>
          <div style={{ "font-size": "13px", color: "var(--text-strong-base, white)" }}>{toolTitle(props.tool.id)}</div>
          <div
            style={{
              "font-size": "12px",
              color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
              "margin-top": "6px",
            }}
          >
            {language.t(props.tool.descriptionKey)}
          </div>
        </div>
      </div>

      {/* Wildcard row */}
      <div
        style={{
          display: "flex",
          gap: "24px",
          "align-items": "center",
          "justify-content": "space-between",
          padding: "8px 0",
        }}
      >
        <div style={{ flex: 1, "min-width": 0 }}>
          <div style={{ "font-size": "12px", color: "var(--text-base, #ccc)" }}>
            {language.t(props.tool.granular.wildcardKey)}
          </div>
        </div>
        <ActionSelect level={level()} onChange={props.onWildcardChange} />
      </div>

      {/* Exceptions */}
      <Show when={excs().length > 0}>
        <div style={{ "margin-top": "4px" }}>
          <div
            style={{
              "font-size": "12px",
              color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
              "margin-bottom": "4px",
            }}
          >
            {language.t("settings.autoApprove.exceptions")}
          </div>
          <For each={excs()}>
            {(exc) => (
              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  "align-items": "center",
                  padding: "4px 0",
                  "padding-left": "12px",
                  "border-top": "1px solid var(--border-weak-base)",
                }}
              >
                <div
                  style={{
                    flex: "1 1 0%",
                    "min-width": 0,
                    "font-size": "13px",
                    "font-family": "var(--vscode-editor-font-family, monospace)",
                    color: "var(--text-base, #ccc)",
                    overflow: "hidden",
                    "text-overflow": "ellipsis",
                    "white-space": "nowrap",
                  }}
                  title={exc.pattern}
                >
                  {exc.pattern}
                </div>
                <div style={{ display: "flex", gap: "4px", "align-items": "center", "flex-shrink": 0 }}>
                  <ActionSelect level={exc.action} onChange={(level) => props.onExceptionChange(exc.pattern, level)} />
                  <IconButton
                    variant="ghost"
                    size="small"
                    icon="close"
                    onClick={() => props.onExceptionRemove(exc.pattern)}
                  />
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>

      {/* Add button / inline input */}
      <Show
        when={adding()}
        fallback={
          <button
            style={{
              display: "flex",
              gap: "4px",
              "align-items": "center",
              padding: "4px 0",
              background: "none",
              border: "none",
              cursor: "pointer",
              "font-size": "12px",
              color: "var(--text-link-base, #3794ff)",
              "font-family": "inherit",
              "margin-top": "4px",
            }}
            onClick={() => setAdding(true)}
          >
            <span style={{ "font-size": "14px" }}>+</span>
            {language.t(props.tool.granular.addKey)}
          </button>
        }
      >
        <div style={{ display: "flex", gap: "8px", "align-items": "center", "margin-top": "4px" }}>
          <input
            ref={(el) => (inputRef = el)}
            type="text"
            value={input()}
            onInput={(e) => setInput(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit()
              if (e.key === "Escape") cancel()
            }}
            onBlur={() => {
              if (!input().trim()) cancel()
            }}
            placeholder={language.t(props.tool.granular.placeholderKey)}
            style={{
              flex: 1,
              "min-width": 0,
              background: "var(--surface-strong-base, #252526)",
              border: "1px solid var(--border-base, #434443)",
              "border-radius": "2px",
              color: "var(--text-base, #ccc)",
              "font-size": "13px",
              "font-family": "var(--vscode-editor-font-family, monospace)",
              padding: "4px 8px",
              outline: "none",
            }}
          />
          <IconButton variant="ghost" size="small" icon="close" onClick={cancel} />
        </div>
      </Show>
    </div>
  )
}

const ActionSelect: Component<{
  level: PermissionLevel
  onChange: (level: PermissionLevel) => void
}> = (props) => {
  const language = useLanguage()
  return (
    <Select
      options={LEVEL_OPTIONS}
      current={LEVEL_OPTIONS.find((o) => o.value === props.level)}
      value={(o) => o.value}
      label={(o) => language.t(o.labelKey)}
      onSelect={(option) => option && props.onChange(option.value)}
      variant="secondary"
      size="small"
      triggerVariant="settings"
    />
  )
}

export default AutoApproveTab
