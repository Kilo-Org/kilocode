import { For, Show } from "solid-js"
import { useConfig } from "../../context/config"
import { ConfigPage, ConfigTag as Tag, ConfigToolbar } from "./ConfigPage"

export function SourcesRoute() {
  const ctx = useConfig()
  const snap = () => ctx.data()

  return (
    <Show when={snap()}>
      {(data) => (
        <ConfigPage title="Config Sources" actions={<Tag>{data().sources.sources.length}</Tag>}>
          <ConfigToolbar
            title="Load Order"
            description="Load order and editability without exposing secret values."
            meta={<Tag>{data().overlay.targets.active ?? "Read only"}</Tag>}
          />

          <div class="table" role="table" aria-label="Config sources">
            <div class="thead" role="rowgroup">
              <div class="tr" role="row">
                <span role="columnheader">Order</span>
                <span role="columnheader">Scope</span>
                <span role="columnheader">Kind</span>
                <span role="columnheader">Source</span>
                <span role="columnheader">Editable</span>
              </div>
            </div>
            <div role="rowgroup">
              <For each={data().sources.sources}>
                {(source) => (
                  <div class="tr" role="row">
                    <span role="cell">{source.order}</span>
                    <span role="cell">{source.scope}</span>
                    <span role="cell">{source.kind}</span>
                    <span role="cell" title={source.path ?? source.source}>
                      {source.label}
                    </span>
                    <span role="cell">{source.editable ? "Yes" : "No"}</span>
                  </div>
                )}
              </For>
            </div>
          </div>
        </ConfigPage>
      )}
    </Show>
  )
}
