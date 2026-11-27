import { describe, expect, test } from "bun:test"
import { Window } from "happy-dom"
import { collapsed, stabilize } from "../../webview-ui/src/utils/webview-viewport"

function setup(width = 800, height = 600, focused = true) {
  const win = new Window({ url: "https://webview.example", width, height })
  const root = win.document.createElement("div")
  root.id = "root"
  win.document.body.append(root)
  let focus = focused
  const doc = {
    body: win.document.body,
    getElementById: (id: string) => win.document.getElementById(id),
    hasFocus: () => focus,
  }
  const setSize = (nextWidth: number, nextHeight: number) => {
    Object.defineProperty(win, "innerWidth", { value: nextWidth, configurable: true })
    Object.defineProperty(win, "innerHeight", { value: nextHeight, configurable: true })
  }
  const setFocus = (next: boolean) => {
    focus = next
  }
  const resize = (nextWidth: number, nextHeight: number) => {
    setSize(nextWidth, nextHeight)
    win.dispatchEvent(new win.Event("resize"))
  }
  return {
    win: win as unknown as globalThis.Window,
    raw: win,
    doc: doc as unknown as Document,
    root,
    body: win.document.body,
    setSize,
    setFocus,
    resize,
  }
}

describe("webview viewport collapse guard", () => {
  test("identifies VS Code's 300x150 and zero-dimension collapsed viewports", () => {
    expect(collapsed({ innerWidth: 300, innerHeight: 150 })).toBe(true)
    expect(collapsed({ innerWidth: 0, innerHeight: 600 })).toBe(true)
    expect(collapsed({ innerWidth: 800, innerHeight: 0 })).toBe(true)
    expect(collapsed({ innerWidth: 300, innerHeight: 151 })).toBe(false)
    expect(collapsed({ innerWidth: 301, innerHeight: 150 })).toBe(false)
    expect(collapsed({ innerWidth: 800, innerHeight: 600 })).toBe(false)
  })

  test("freezes #root and masks body on 300x150 collapse, then restores cleanly without redundant resize dispatch", async () => {
    const env = setup(800, 600, true)
    const release = stabilize(env.win, env.doc, 20)
    const sizes: Array<[number, number]> = []
    env.win.addEventListener("resize", () => sizes.push([env.win.innerWidth, env.win.innerHeight]))

    expect(env.root.style.width).toBe("800px")
    expect(env.root.style.height).toBe("600px")
    expect(env.body.style.opacity).toBe("")

    // Simulate switching away to a file tab: blur + collapse to 300x150.
    env.setFocus(false)
    env.win.dispatchEvent(new env.raw.Event("blur"))
    env.resize(300, 150)

    expect(env.root.style.width).toBe("800px")
    expect(env.root.style.height).toBe("600px")
    expect(env.body.style.opacity).toBe("0")
    expect(env.body.style.backgroundColor).toBe("transparent")
    expect(sizes).toEqual([])

    // Simulate returning to the webview tab at the same dimensions.
    env.resize(800, 600)

    expect(env.root.style.width).toBe("800px")
    expect(env.root.style.height).toBe("600px")
    expect(env.body.style.opacity).toBe("")
    expect(env.body.style.backgroundColor).toBe("")
    // Restoring the unchanged frozen size suppresses redundant app resize thrash.
    expect(sizes).toEqual([])

    release()
    await env.raw.happyDOM.close()
  })

  test("updates #root and propagates resize when the editor resized while hidden", async () => {
    const env = setup(800, 600, true)
    const release = stabilize(env.win, env.doc, 20)
    const sizes: Array<[number, number]> = []
    env.win.addEventListener("resize", () => sizes.push([env.win.innerWidth, env.win.innerHeight]))

    env.setFocus(false)
    env.resize(300, 150)
    expect(env.body.style.opacity).toBe("0")
    expect(sizes).toEqual([])

    env.resize(1100, 750)
    expect(env.root.style.width).toBe("1100px")
    expect(env.root.style.height).toBe("750px")
    expect(env.body.style.opacity).toBe("")
    expect(env.body.style.backgroundColor).toBe("")
    expect(sizes).toEqual([[1100, 750]])

    release()
    await env.raw.happyDOM.close()
  })

  test("masks early focus that arrives before the collapsed resize and reveals once the real size arrives", async () => {
    const env = setup(800, 600, true)
    const release = stabilize(env.win, env.doc, 40)

    // Hidden behind a file tab; focus arrives while the viewport is still 300x150.
    env.setSize(300, 150)
    env.setFocus(true)
    env.win.dispatchEvent(new env.raw.Event("focus"))

    expect(env.body.style.opacity).toBe("0")
    expect(env.root.style.width).toBe("800px")
    expect(env.root.style.height).toBe("600px")

    // The pending 300x150 resize stays suppressed; the real size unmasks immediately.
    env.resize(300, 150)
    expect(env.body.style.opacity).toBe("0")

    env.resize(800, 600)
    expect(env.body.style.opacity).toBe("")
    expect(env.body.style.backgroundColor).toBe("")

    release()
    await env.raw.happyDOM.close()
  })

  test("reveals a genuinely focused 300x150 pane after the safety delay, and cancels on blur", async () => {
    const env = setup(800, 600, true)
    const release = stabilize(env.win, env.doc, 25)

    env.resize(300, 150)
    expect(env.body.style.opacity).toBe("0")

    // Blurring before the delay cancels the fallback so hidden tabs stay masked.
    env.setFocus(false)
    env.win.dispatchEvent(new env.raw.Event("blur"))
    await Bun.sleep(40)
    expect(env.body.style.opacity).toBe("0")
    expect(env.root.style.width).toBe("800px")

    // Re-focusing a genuinely 300x150 pane reveals it after the safety delay.
    env.setFocus(true)
    env.win.dispatchEvent(new env.raw.Event("focus"))
    await Bun.sleep(40)
    expect(env.body.style.opacity).toBe("")
    expect(env.root.style.width).toBe("300px")
    expect(env.root.style.height).toBe("150px")

    release()
    await env.raw.happyDOM.close()
  })

  test("starts masked when deserialized while hidden at 300x150 and clears styles on cleanup", async () => {
    const env = setup(300, 150, false)
    const release = stabilize(env.win, env.doc, 20)

    expect(env.body.style.opacity).toBe("0")
    expect(env.body.style.backgroundColor).toBe("transparent")
    expect(env.root.style.width).toBe("")

    env.resize(900, 700)
    expect(env.body.style.opacity).toBe("")
    expect(env.root.style.width).toBe("900px")
    expect(env.root.style.height).toBe("700px")

    release()
    expect(env.root.style.width).toBe("")
    expect(env.root.style.height).toBe("")
    expect(env.body.style.opacity).toBe("")
    expect(env.body.style.backgroundColor).toBe("")
    await env.raw.happyDOM.close()
  })
})
