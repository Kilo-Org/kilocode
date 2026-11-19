/** @jsxImportSource solid-js */
import "@kilocode/kilo-ui/styles"
import { ToolRegistry } from "@kilocode/kilo-ui/message-part"
import { createSignal, For } from "solid-js"
import { Virtualizer } from "virtua/solid"
import { editedFile, writtenFile } from "../../../kilo-ui/test/fixtures"
import { mountRich } from "../../../kilo-ui/test/harness"
import "../../webview-ui/src/styles/chat-layout.css"
import { createRowHandoff } from "../../webview-ui/src/v2/transcript-row-handoff"

function Transcript() {
  const [steered, setSteered] = createSignal(false)
  const handoff = createRowHandoff()
  const Edit = ToolRegistry.render("edit")!
  const Write = ToolRegistry.render("write")!
  let scroller!: HTMLDivElement
  const card = (key: string) => (
    <div data-row-key={key}>
      {key === "write" ? (
        <Write
          tool="write"
          partID="write"
          input={{ path: writtenFile.file }}
          metadata={{ files: [writtenFile] }}
          status="completed"
          output=""
          attachments={[]}
          forceOpen
        />
      ) : (
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
      )}
    </div>
  )
  const row = (key: string) => handoff(key, () => card(key) as HTMLDivElement)
  const rows = ["edit", "write"]

  return (
    <>
      <button onClick={() => setSteered(true)}>Steer</button>
      <div ref={scroller} class="message-list" style={{ height: "400px" }}>
        <div class="message-list-turns">
          <Virtualizer data={steered() ? ["history", ...rows] : ["history"]} scrollRef={scroller}>
            {row}
          </Virtualizer>
          <For each={steered() ? [] : rows}>{row}</For>
        </div>
      </div>
      {/* Same card outside the transcript keeps the shared paint skip, so the regression pins the rule's scope. */}
      <div data-outside="true">{card("outside")}</div>
    </>
  )
}

mountRich(() => <Transcript />)
