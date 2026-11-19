/** @jsxImportSource solid-js */
import "@kilocode/kilo-ui/styles"
import { ToolRegistry } from "@kilocode/kilo-ui/message-part"
import { createSignal, For } from "solid-js"
import { Virtualizer } from "virtua/solid"
import { editedFile } from "../../../kilo-ui/test/fixtures"
import { mountRich } from "../../../kilo-ui/test/harness"
import "../../webview-ui/src/styles/chat-layout.css"
import { createRowHandoff } from "../../webview-ui/src/v2/transcript-row-handoff"

function Transcript() {
  const [steered, setSteered] = createSignal(false)
  const handoff = createRowHandoff()
  const Edit = ToolRegistry.render("edit")!
  let scroller!: HTMLDivElement
  const row = (key: string) =>
    handoff(
      key,
      () =>
        (
          <div data-row-key={key}>
            {key === "edit" ? (
              <Edit
                tool="edit"
                partID="edit"
                input={{ path: editedFile.file }}
                metadata={{ files: [editedFile] }}
                status="completed"
                output=""
                attachments={[]}
                forceOpen
              />
            ) : (
              key
            )}
          </div>
        ) as HTMLDivElement,
    )

  return (
    <>
      <button onClick={() => setSteered(true)}>Steer</button>
      <div ref={scroller} class="message-list" style={{ height: "400px" }}>
        <div class="message-list-turns">
          <Virtualizer data={steered() ? ["history", "edit"] : ["history"]} scrollRef={scroller}>
            {row}
          </Virtualizer>
          <For each={steered() ? ["steer"] : ["edit"]}>{row}</For>
        </div>
      </div>
    </>
  )
}

mountRich(() => <Transcript />)
