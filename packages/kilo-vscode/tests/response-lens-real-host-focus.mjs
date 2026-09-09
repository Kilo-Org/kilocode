import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import path from "node:path"

export async function foreground(app, page, frame, run, purpose = "repaint") {
  const owned = await app.browserWindow(page)
  try {
    const native = await owned.evaluate(async (window) => {
      const state = () => ({
        id: window.id,
        focused: window.isFocused(),
        visible: window.isVisible(),
        minimized: window.isMinimized(),
      })
      const before = state()
      await new Promise((resolve, reject) => {
        const check = () => {
          if (!window.isFocused() || !window.isVisible() || window.isMinimized()) return
          clearTimeout(timer)
          window.off("focus", check)
          window.off("show", check)
          window.off("restore", check)
          resolve()
        }
        const timer = setTimeout(() => {
          window.off("focus", check)
          window.off("show", check)
          window.off("restore", check)
          reject(new Error(`Owned native window could not gain foreground in ten seconds: ${JSON.stringify(state())}`))
        }, 10000)
        window.on("focus", check)
        window.on("show", check)
        window.on("restore", check)
        if (window.isMinimized()) window.restore()
        window.show()
        window.focus()
        check()
      })
      return { before, after: state() }
    })
    await page.bringToFront()
    await frame.locator("textarea.prompt-input:visible").click()
    const renderer = await frame.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const state = () => ({ visibility: document.visibilityState, focused: document.hasFocus() })
          const finish = () => {
            clearTimeout(timer)
            document.removeEventListener("visibilitychange", check)
            window.removeEventListener("focus", check, true)
          }
          const check = () => {
            if (document.visibilityState !== "visible" || !document.hasFocus()) return
            finish()
            resolve(state())
          }
          const timer = setTimeout(() => {
            finish()
            reject(new Error(`Real webview could not gain foreground in ten seconds: ${JSON.stringify(state())}`))
          }, 10000)
          document.addEventListener("visibilitychange", check)
          window.addEventListener("focus", check, true)
          check()
        }),
    )
    assert.ok(native.after.focused && native.after.visible && !native.after.minimized)
    assert.ok(renderer.focused && renderer.visibility === "visible")
    const result = { native, renderer }
    await writeFile(path.join(run.root, `${purpose}-focus.json`), JSON.stringify(result, null, 2))
    return result
  } finally {
    await owned.dispose()
  }
}
