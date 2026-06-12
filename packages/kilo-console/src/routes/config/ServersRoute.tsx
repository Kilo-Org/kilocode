import { Button } from "@kilocode/kilo-web-ui/button"
import { Card } from "@kilocode/kilo-web-ui/card"
import { For, Show, createMemo, createSignal } from "solid-js"
import { useConfig } from "../../context/config"
import { ConfigPage, ConfigTag as Tag, ConfigToolbar } from "./ConfigPage"

type Server = {
  id: string
  name: string
  url: string
  dir: string
  status: "connected" | "pending"
  apply: boolean
}

export function ServersRoute() {
  const ctx = useConfig()
  const [items, setItems] = createSignal<Server[]>([])
  const [show, setShow] = createSignal(false)
  const [name, setName] = createSignal("Production")
  const [url, setUrl] = createSignal("http://127.0.0.1:4097")

  const rows = createMemo(() => {
    const q = ctx.query()
    const health = ctx.data()?.health
    if (!q) return items()
    const seed: Server = {
      id: q.url,
      name: "Local Kilo",
      url: q.url,
      dir: q.dir || "Server default",
      status: health?.healthy ? "connected" : "pending",
      apply: true,
    }
    return [seed, ...items().filter((item) => item.url !== q.url)]
  })

  function add() {
    const server: Server = {
      id: `${url()}-${Date.now()}`,
      name: name().trim() || "Kilo Server",
      url: url().trim(),
      dir: "Server default",
      status: "pending",
      apply: true,
    }
    if (!server.url) return
    setItems((prev) => [server, ...prev.filter((item) => item.url !== server.url)])
    setShow(false)
  }

  function toggle(id: string) {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, apply: !item.apply } : item)))
  }

  return (
    <ConfigPage
      title="Connected Servers"
      actions={
        <Button variant="primary" onClick={() => setShow((v) => !v)}>
          Add New Server
        </Button>
      }
    >
      <ConfigToolbar
        title="Server Sync"
        description="Register global Kilo server endpoints and choose which ones receive configuration updates."
        meta={<Tag>{`${rows().filter((item) => item.apply).length} selected`}</Tag>}
      />

      <Show when={show()}>
        <Card class="server-draft">
          <label>
            Name
            <input value={name()} onInput={(event) => setName(event.currentTarget.value)} />
          </label>
          <label>
            Server URL
            <input value={url()} spellcheck={false} onInput={(event) => setUrl(event.currentTarget.value)} />
          </label>
          <Button variant="secondary" onClick={add}>
            Connect Server
          </Button>
        </Card>
      </Show>

      <Card class="server-table-card">
        <div class="server-toolbar">
          <strong>{rows().length} servers</strong>
          <span>{rows().filter((item) => item.apply).length} selected for config sync</span>
        </div>
        <div class="server-table" role="table" aria-label="Connected Kilo servers">
          <div class="server-row server-head" role="row">
            <span>Apply</span>
            <span>Name</span>
            <span>URL</span>
            <span>Directory</span>
            <span>Version</span>
            <span>Status</span>
          </div>
          <For each={rows()}>
            {(item) => (
              <div class="server-row" role="row">
                <span>
                  <input
                    type="checkbox"
                    checked={item.apply}
                    disabled={item.url === ctx.query()?.url}
                    aria-label={`Apply configuration to ${item.name}`}
                    onChange={() => toggle(item.id)}
                  />
                </span>
                <strong>{item.name}</strong>
                <span title={item.url}>{item.url}</span>
                <span title={item.dir}>{item.dir}</span>
                <span>{item.url === ctx.query()?.url ? (ctx.data()?.health.version ?? "Unknown") : "Pending"}</span>
                <span>
                  <Tag>{item.url === ctx.query()?.url && !ctx.data.loading ? item.status : "pending"}</Tag>
                </span>
              </div>
            )}
          </For>
        </div>
      </Card>
    </ConfigPage>
  )
}
