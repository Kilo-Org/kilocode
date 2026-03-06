import { Component, For, Show, createMemo, createSignal } from "solid-js"
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

interface ToolDef {
  id: string
  descriptionKey: string
  granular?: {
    wildcardKey: string
    addKey: string
    placeholderKey: string
  }
}

/** Grouped tool: maps a single UI row to multiple config keys */
interface GroupedToolDef {
  ids: string[]
  label: string
  descriptionKey: string
}

const GRANULAR_TOOLS: ToolDef[] = [
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

function wildcardAction(rule: PermissionRule | undefined, fallback: PermissionLevel): PermissionLevel {
  if (!rule) return fallback
  if (typeof rule === "string") return rule
  return rule["*"] ?? fallback
}

function exceptions(rule: PermissionRule | undefined): Array<{ pattern: string; action: PermissionLevel }> {
  if (!rule || typeof rule === "string") return []
  return Object.entries(rule)
    .filter(([key]) => key !== "*")
    .map(([pattern, action]) => ({ pattern, action }))
}

const AutoApproveTab: Component = () => {
  const { config, updateConfig } = useConfig()
  const language = useLanguage()

  const permissions = createMemo(() => config().permission ?? {})

  const globalFallback = createMemo((): PermissionLevel => {
    const star = permissions()["*"]
    if (typeof star === "string") return star
    return "ask"
  })

  const levelFor = (tool: string): PermissionLevel => wildcardAction(permissions()[tool], globalFallback())

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
    const obj: Record<string, PermissionLevel> = { "*": level }
    for (const exc of excs) obj[exc.pattern] = exc.action
    updateConfig({ permission: { [tool]: obj } })
  }

  const setException = (tool: string, pattern: string, level: PermissionLevel) => {
    const current = ruleFor(tool)
    const base: Record<string, PermissionLevel> =
      typeof current === "string" ? { "*": current } : { ...(current ?? {}) }
    base[pattern] = level
    updateConfig({ permission: { [tool]: base } })
  }

  const addException = (tool: string, pattern: string) => {
    const current = ruleFor(tool)
    const base: Record<string, PermissionLevel> =
      typeof current === "string" ? { "*": current } : { ...(current ?? {}) }
    base[pattern] = "allow"
    updateConfig({ permission: { [tool]: base } })
  }

  const removeException = (tool: string, pattern: string) => {
    const current = ruleFor(tool)
    if (!current || typeof current === "string") return
    const rebuilt: Record<string, PermissionLevel> = {}
    for (const [k, v] of Object.entries(current)) {
      if (k !== pattern) rebuilt[k] = v
    }
    const keys = Object.keys(rebuilt)
    const value: PermissionRule =
      keys.length === 0 ? "ask" : keys.length === 1 && keys[0] === "*" ? rebuilt["*"]! : rebuilt
    // patchJsonc only sets keys present in the patch — it won't remove the deleted key
    // from the JSONC file. To work around this, first set the tool to a string (which
    // replaces the entire JSONC node), then set the rebuilt object if needed.
    const wildcard = rebuilt["*"] ?? "ask"
    updateConfig({ permission: { [tool]: wildcard } })
    if (typeof value === "object") {
      updateConfig({ permission: { [tool]: value } })
    }
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
            fallback={globalFallback()}
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
            level={levelFor(group.ids[0])}
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
        <div style={{ "font-size": "13px", color: "var(--text-strong-base, white)" }}>{props.id}</div>
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
  tool: ToolDef
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
          <div style={{ "font-size": "13px", color: "var(--text-strong-base, white)" }}>{props.tool.id}</div>
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
            {language.t(props.tool.granular!.wildcardKey)}
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
            {language.t(props.tool.granular!.addKey)}
          </button>
        }
      >
        <div style={{ display: "flex", gap: "8px", "align-items": "center", "margin-top": "4px" }}>
          <input
            ref={(el) => setTimeout(() => el.focus(), 0)}
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
            placeholder={language.t(props.tool.granular!.placeholderKey)}
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
