import { expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { ShellOutput } from "../src/components/shell-output"
import { mount, waitFor } from "./harness"

function outputCode(host: ParentNode) {
  return host.querySelector<HTMLElement>('[data-component="bash-output"] [data-kind="output"] code')
}

test("streams plain stripped text while running and highlights once settled", async () => {
  const [output, setOutput] = createSignal("\u001b[31malpha\u001b[0m\rbravo")
  const [running, setRunning] = createSignal(true)
  const value = mount(() => <ShellOutput cmd="noisy.pl" output={output()} active running={running()} />)

  const streaming = outputCode(value.host)!
  expect(streaming.textContent).toBe("bravo")
  expect(streaming.querySelectorAll("span")).toHaveLength(0)

  setOutput("\u001b[31malpha\u001b[0m\rbravo\rcharlie")
  expect(outputCode(value.host)!.textContent).toBe("charlie")

  setOutput("\u001b[31malpha\u001b[0m\rbravo\rcharlie\nnext line")
  expect(outputCode(value.host)!.textContent).toBe("charlie\nnext line")
  expect(outputCode(value.host)!.querySelectorAll("span")).toHaveLength(0)

  setOutput("\u001b[31malpha\u001b[0m\rbravo\rcharlie\nnext line\n")
  setRunning(false)

  const highlighted = await waitFor(() => outputCode(value.host)?.querySelector("span"))
  expect(highlighted).not.toBeNull()
  expect(outputCode(value.host)!.textContent).toBe("charlie\nnext line\n")

  value.dispose()
})
