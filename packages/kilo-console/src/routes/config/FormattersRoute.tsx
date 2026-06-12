import { For, Show } from "solid-js"
import { Button } from "@kilocode/kilo-web-ui/button"
import { ConfigRow, SectionTitle } from "@kilocode/kilo-web-ui/console"
import { IconButton } from "@kilocode/kilo-web-ui/icon-button"
import { ConfigCountTag as CountTag, ConfigPage, ConfigTag as Tag, SourceBadge } from "./ConfigPage"
import { useFormatterSettings, type ToolRow } from "./state/formatters"

type Kind = "formatter" | "lsp"
type Settings = ReturnType<typeof useFormatterSettings>

function tone(input: ToolRow["state"]) {
  if (input === "active" || input === "connected") return "success"
  if (input === "error") return "critical"
  if (input === "missing") return "warning"
  return "neutral"
}

function label(input: ToolRow["state"]) {
  if (input === "active") return "Available"
  if (input === "connected") return "Connected"
  if (input === "disabled") return "Disabled"
  if (input === "error") return "Error"
  if (input === "idle") return "Idle"
  if (input === "missing") return "Missing requirement"
  return "Enabled"
}

function Meta(props: { row: ToolRow }) {
  return (
    <div class="formatter-row-meta">
      <Show when={props.row.note}>{(note) => <Tag tone="warning">{note()}</Tag>}</Show>
      <Tag tone={tone(props.row.state)}>{label(props.row.state)}</Tag>
      <Show when={props.row.entry}>
        {(entry) => (
          <SourceBadge source={entry().source} inherited={entry().inherited} overridden={entry().overridden} />
        )}
      </Show>
    </div>
  )
}

function Detail(props: { row: ToolRow }) {
  return (
    <span class="formatter-row-subtitle">
      <span class="formatter-row-id">{props.row.id}</span>
      <span>{props.row.ext.length ? props.row.ext.join(", ") : "No extensions configured"}</span>
      <span>{props.row.req}</span>
      <Show when={props.row.command.length}>
        <span class="formatter-command">{props.row.command.join(" ")}</span>
      </Show>
    </span>
  )
}

function Row(props: { kind: Kind; row: ToolRow; state: Settings }) {
  return (
    <ConfigRow
      title={props.row.title ?? props.row.id}
      subtitle={<Detail row={props.row} />}
      status={<Meta row={props.row} />}
      highlightOverride={Boolean(props.row.entry && !props.row.entry.inherited)}
      actions={
        <>
          <IconButton
            icon="edit"
            variant="ghost"
            aria-label={`Edit ${props.row.id}`}
            disabled={Boolean(props.state.ctx.saving())}
            onClick={() => props.state.open(props.kind, props.row)}
          />
          <Show when={props.row.removable}>
            <IconButton
              icon="trash"
              variant="ghost"
              aria-label={`Delete ${props.row.id}`}
              disabled={Boolean(props.state.ctx.saving())}
              onClick={() => props.state.remove(props.row)}
            />
          </Show>
        </>
      }
    />
  )
}

function List(props: { kind: Kind; rows: ToolRow[]; state: Settings }) {
  return (
    <div class="formatter-rules">
      <For each={props.rows} fallback={<p class="formatter-empty">No entries configured.</p>}>
        {(row) => <Row kind={props.kind} row={row} state={props.state} />}
      </For>
    </div>
  )
}

function FormatterDrawer(props: { state: Settings }) {
  const editing = () => props.state.locked()
  return (
    <Show when={props.state.mode() === "formatter"}>
      <div class="drawer-scrim" onClick={props.state.close} />
      <aside class="provider-drawer formatter-drawer" aria-label="Formatter configuration">
        <header class="drawer-header">
          <div>
            <h2>{editing() ? `Edit ${props.state.name()}` : "Add Formatter"}</h2>
            <span>Configure command, extensions, and environment for a formatter.</span>
          </div>
          <Button variant="ghost" aria-label="Close formatter overlay" onClick={props.state.close}>
            X
          </Button>
        </header>

        <div class="provider-form formatter-form">
          <label class="required-field wide">
            Name
            <input
              value={props.state.name()}
              disabled={props.state.locked()}
              placeholder="custom-formatter"
              spellcheck={false}
              onInput={(event) => props.state.setName(event.currentTarget.value)}
            />
          </label>
          <label class="required-field wide">
            Command
            <input
              value={props.state.command()}
              placeholder="prettier --write $FILE"
              spellcheck={false}
              onInput={(event) => props.state.setCommand(event.currentTarget.value)}
            />
          </label>
          <label class="required-field wide">
            Extensions
            <input
              value={props.state.extensions()}
              placeholder=".js, .ts, .tsx"
              spellcheck={false}
              onInput={(event) => props.state.setExtensions(event.currentTarget.value)}
            />
          </label>
          <label class="optional-field wide">
            Environment
            <textarea
              value={props.state.environment()}
              placeholder="NODE_ENV=development"
              spellcheck={false}
              onInput={(event) => props.state.setEnvironment(event.currentTarget.value)}
            />
          </label>
          <label class="formatter-check wide">
            <input
              type="checkbox"
              checked={props.state.disabled()}
              onChange={(event) => props.state.setDisabled(event.currentTarget.checked)}
            />
            Disable this formatter
          </label>
        </div>

        <footer class="drawer-footer">
          <Button variant="ghost" onClick={props.state.close}>
            Cancel
          </Button>
          <Button variant="primary" disabled={Boolean(props.state.ctx.saving())} onClick={props.state.saveFormatter}>
            Save Formatter
          </Button>
        </footer>
      </aside>
    </Show>
  )
}

function LspDrawer(props: { state: Settings }) {
  const editing = () => props.state.locked()
  const optional = () => props.state.disabled()
  return (
    <Show when={props.state.mode() === "lsp"}>
      <div class="drawer-scrim" onClick={props.state.close} />
      <aside class="provider-drawer formatter-drawer" aria-label="LSP server configuration">
        <header class="drawer-header">
          <div>
            <h2>{editing() ? `Edit ${props.state.name()}` : "Add LSP Server"}</h2>
            <span>Configure command, extensions, environment, and initialization options.</span>
          </div>
          <Button variant="ghost" aria-label="Close LSP overlay" onClick={props.state.close}>
            X
          </Button>
        </header>

        <div class="provider-form formatter-form">
          <label class="required-field wide">
            Name
            <input
              value={props.state.name()}
              disabled={props.state.locked()}
              placeholder="custom-lsp"
              spellcheck={false}
              onInput={(event) => props.state.setName(event.currentTarget.value)}
            />
          </label>
          <label class="wide" classList={{ "required-field": !optional(), "optional-field": optional() }}>
            Command
            <input
              value={props.state.command()}
              placeholder="custom-lsp --stdio"
              spellcheck={false}
              onInput={(event) => props.state.setCommand(event.currentTarget.value)}
            />
          </label>
          <label class="required-field wide">
            Extensions
            <input
              value={props.state.extensions()}
              placeholder=".ts, .tsx"
              spellcheck={false}
              onInput={(event) => props.state.setExtensions(event.currentTarget.value)}
            />
          </label>
          <label class="optional-field wide">
            Environment
            <textarea
              value={props.state.environment()}
              placeholder="RUST_LOG=debug"
              spellcheck={false}
              onInput={(event) => props.state.setEnvironment(event.currentTarget.value)}
            />
          </label>
          <label class="optional-field wide">
            Initialization JSON
            <textarea
              value={props.state.initialization()}
              placeholder={'{"preferences":{"importModuleSpecifierPreference":"relative"}}'}
              spellcheck={false}
              onInput={(event) => props.state.setInitialization(event.currentTarget.value)}
            />
          </label>
          <label class="formatter-check wide">
            <input
              type="checkbox"
              checked={props.state.disabled()}
              onChange={(event) => props.state.setDisabled(event.currentTarget.checked)}
            />
            Disable this LSP server
          </label>
        </div>

        <footer class="drawer-footer">
          <Button variant="ghost" onClick={props.state.close}>
            Cancel
          </Button>
          <Button variant="primary" disabled={Boolean(props.state.ctx.saving())} onClick={props.state.saveLsp}>
            Save LSP Server
          </Button>
        </footer>
      </aside>
    </Show>
  )
}

export function FormattersRoute() {
  const state = useFormatterSettings()

  return (
    <ConfigPage
      title={
        <span class="config-title-count">
          Formatters
          <CountTag>{state.builtinFmt().length + state.customFmt().length}</CountTag>
        </span>
      }
      description="Control native and custom formatters Kilo can run after editing files."
      actions={
        <>
          <Button
            variant="secondary"
            disabled={Boolean(state.ctx.saving())}
            onClick={state.fmtOn() ? state.disableFmt : state.enableFmt}
          >
            {state.fmtOn() ? "Disable All" : "Enable Built-ins"}
          </Button>
          <Button
            icon="plus"
            variant="primary"
            disabled={Boolean(state.ctx.saving())}
            onClick={() => state.open("formatter")}
          >
            Add Formatter
          </Button>
        </>
      }
    >
      <div class="formatters">
        <section class="formatter-group">
          <SectionTitle
            trailing={<CountTag>{state.builtinFmt().length}</CountTag>}
            description="Native formatter integrations from OpenCode. Edit a row to override command, extensions, or environment."
          >
            Built-in Formatters
          </SectionTitle>
          <List kind="formatter" rows={state.builtinFmt()} state={state} />
        </section>

        <Show when={state.customFmt().length}>
          <section class="formatter-group">
            <SectionTitle
              trailing={<CountTag>{state.customFmt().length}</CountTag>}
              description="Project or global formatter entries added through config."
            >
              Custom Formatters
            </SectionTitle>
            <List kind="formatter" rows={state.customFmt()} state={state} />
          </section>
        </Show>
      </div>

      <FormatterDrawer state={state} />
    </ConfigPage>
  )
}

export function LspRoute() {
  const state = useFormatterSettings()

  return (
    <ConfigPage
      title={
        <span class="config-title-count">
          LSP Servers
          <CountTag>{state.builtinLsp().length + state.customLsp().length}</CountTag>
        </span>
      }
      description="Control native and custom Language Server Protocol integrations for diagnostics and code intelligence."
      actions={
        <>
          <Button
            variant="secondary"
            disabled={Boolean(state.ctx.saving())}
            onClick={state.lspOn() ? state.disableLsp : state.enableLsp}
          >
            {state.lspOn() ? "Disable All" : "Enable Built-ins"}
          </Button>
          <Button
            icon="plus"
            variant="primary"
            disabled={Boolean(state.ctx.saving())}
            onClick={() => state.open("lsp")}
          >
            Add LSP Server
          </Button>
        </>
      }
    >
      <div class="formatters">
        <section class="formatter-group">
          <SectionTitle
            trailing={<CountTag>{state.builtinLsp().length}</CountTag>}
            description="Native LSP servers from OpenCode. Edit a row to disable it or provide a custom launch command."
          >
            Built-in LSP Servers
          </SectionTitle>
          <List kind="lsp" rows={state.builtinLsp()} state={state} />
        </section>

        <Show when={state.customLsp().length}>
          <section class="formatter-group">
            <SectionTitle
              trailing={<CountTag>{state.customLsp().length}</CountTag>}
              description="Project or global LSP entries added through config."
            >
              Custom LSP Servers
            </SectionTitle>
            <List kind="lsp" rows={state.customLsp()} state={state} />
          </section>
        </Show>
      </div>

      <LspDrawer state={state} />
    </ConfigPage>
  )
}
