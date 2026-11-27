let pending = { width: 1280, height: 720, epoch: 0 }
globalThis.__kiloResult = null

async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] })
  if (!existing.length) {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["USER_MEDIA"],
      justification: "Hardware-accelerated preview streaming for Integrated Browser",
    })
  }
}

globalThis.__kiloPrepare = (width, height, epoch) => {
  pending = { width, height, epoch }
  globalThis.__kiloResult = null
  return ensureOffscreen()
}

ensureOffscreen().catch(() => {})

chrome.action.onClicked.addListener(async (tab) => {
  const target = { ...pending }
  try {
    await ensureOffscreen()
    const streamId = await new Promise((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, (id) => {
        if (chrome.runtime.lastError || !id) {
          reject(new Error(chrome.runtime.lastError?.message || "Missing tab capture stream id"))
          return
        }
        resolve(id)
      })
    })
    const res = await chrome.runtime.sendMessage({ type: "capture", streamId, ...target })
    globalThis.__kiloResult = { epoch: target.epoch, ...res }
  } catch (error) {
    globalThis.__kiloResult = { epoch: target.epoch, ok: false, error: String(error) }
  }
})
