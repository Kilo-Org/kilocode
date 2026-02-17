// kilocode_change - new file
// Agent Manager webview entry point
// Simple vanilla TS — no framework dependency for the walking skeleton

interface AgentSession {
  id: string
  label: string
  status: string
  created: number
  directory: string
}

interface VSCodeAPI {
  postMessage(msg: unknown): void
  getState(): unknown
  setState(state: unknown): void
}

declare function acquireVsCodeApi(): VSCodeAPI

const vscode = acquireVsCodeApi()

// State
let sessions: AgentSession[] = []
let selectedSessionId: string | null = null
let sidebarHtml: string | null = null
let sidebarAssetsLoading = false

/**
 * Extract all CSS custom properties (--vscode-*) from the parent webview's
 * document and return them as a CSS string to inject into iframes.
 */
function getVSCodeCSSVariables(): string {
  const styles = document.documentElement.style
  const vars: string[] = []
  for (let i = 0; i < styles.length; i++) {
    const name = styles[i]
    if (name.startsWith("--vscode")) {
      vars.push(`${name}: ${styles.getPropertyValue(name)};`)
    }
  }
  // Also grab the body's data attributes and class for theme info
  return `:root, body { ${vars.join(" ")} }`
}

// Iframe refs: sessionId -> HTMLIFrameElement
const iframes = new Map<string, HTMLIFrameElement>()

// ---- DOM references ----
const sessionList = document.createElement("div")
sessionList.className = "session-list"

const detailArea = document.createElement("div")
detailArea.className = "detail-area"

const root = document.getElementById("root")!
const layout = document.createElement("div")
layout.className = "layout"
layout.appendChild(sessionList)
layout.appendChild(detailArea)
root.appendChild(layout)

// Inject styles
const style = document.createElement("style")
style.textContent = `
  .layout {
    display: flex;
    height: 100vh;
    overflow: hidden;
  }
  .session-list {
    width: 260px;
    min-width: 200px;
    border-right: 1px solid var(--vscode-panel-border, #333);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    padding: 8px;
    gap: 4px;
  }
  .detail-area {
    flex: 1;
    position: relative;
    overflow: hidden;
  }
  .detail-area iframe {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    border: none;
  }
  .session-item {
    padding: 8px 12px;
    cursor: pointer;
    border-radius: 4px;
    font-size: 13px;
    display: flex;
    align-items: center;
    gap: 8px;
    user-select: none;
  }
  .session-item:hover {
    background: var(--vscode-list-hoverBackground, #2a2d2e);
  }
  .session-item.selected {
    background: var(--vscode-list-activeSelectionBackground, #094771);
    color: var(--vscode-list-activeSelectionForeground, #fff);
  }
  .session-item .status {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .session-item .status.creating { background: #888; }
  .session-item .status.busy { background: #e8a317; }
  .session-item .status.idle { background: #3c3; }
  .session-item .status.error { background: #e33; }
  .session-item .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .new-session-form {
    padding: 8px;
    border-top: 1px solid var(--vscode-panel-border, #333);
    margin-top: auto;
  }
  .new-session-form textarea {
    width: 100%;
    min-height: 60px;
    background: var(--vscode-input-background, #1e1e1e);
    color: var(--vscode-input-foreground, #ccc);
    border: 1px solid var(--vscode-input-border, #444);
    border-radius: 4px;
    padding: 6px 8px;
    font-family: inherit;
    font-size: 13px;
    resize: vertical;
    box-sizing: border-box;
  }
  .new-session-form button {
    margin-top: 6px;
    width: 100%;
    padding: 6px;
    background: var(--vscode-button-background, #0e639c);
    color: var(--vscode-button-foreground, #fff);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
  }
  .new-session-form button:hover {
    background: var(--vscode-button-hoverBackground, #1177bb);
  }
  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--vscode-descriptionForeground, #888);
    font-size: 14px;
  }
`
document.head.appendChild(style)

// ---- New session form ----
const form = document.createElement("div")
form.className = "new-session-form"
const textarea = document.createElement("textarea")
textarea.placeholder = "Describe the task..."
const button = document.createElement("button")
button.textContent = "Start Agent"
button.addEventListener("click", () => {
  const prompt = textarea.value.trim()
  if (!prompt) return
  vscode.postMessage({ type: "agentManager.createSession", prompt })
  textarea.value = ""
})
textarea.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    button.click()
  }
})
form.appendChild(textarea)
form.appendChild(button)
sessionList.appendChild(form)

// ---- Rendering ----

function renderSessionList() {
  // Remove all session items (keep the form)
  const items = sessionList.querySelectorAll(".session-item")
  items.forEach((item) => item.remove())

  for (const session of sessions) {
    const item = document.createElement("div")
    item.className = "session-item" + (session.id === selectedSessionId ? " selected" : "")
    item.addEventListener("click", () => selectSession(session.id))

    const dot = document.createElement("span")
    dot.className = `status ${session.status}`

    const label = document.createElement("span")
    label.className = "label"
    label.textContent = session.label

    item.appendChild(dot)
    item.appendChild(label)
    sessionList.insertBefore(item, form)
  }
}

function selectSession(id: string) {
  selectedSessionId = id
  renderSessionList()
  renderDetail()
}

function renderDetail() {
  // Hide all iframes
  for (const [, iframe] of iframes) {
    iframe.style.display = "none"
  }

  if (!selectedSessionId) {
    detailArea.innerHTML = '<div class="empty-state">Select or create a session</div>'
    return
  }

  // Check if we already have an iframe for this session
  const existing = iframes.get(selectedSessionId)
  if (existing) {
    existing.style.display = "block"
    // Clear empty state if present
    const empty = detailArea.querySelector(".empty-state")
    if (empty) empty.remove()
    return
  }

  // Create a new iframe
  if (!sidebarHtml) {
    detailArea.innerHTML = '<div class="empty-state">Loading sidebar... (waiting for HTML)</div>'
    console.log("[Agent Manager] No sidebarHtml yet, waiting...")
    return
  }

  console.log("[Agent Manager] Creating iframe for session", selectedSessionId, "html size:", sidebarHtml.length)

  // Clear empty state
  detailArea.innerHTML = ""

  const iframe = document.createElement("iframe")
  // Use blob: URL instead of srcdoc to work within VS Code webview CSP
  const blob = new Blob([sidebarHtml], { type: "text/html" })
  const url = URL.createObjectURL(blob)
  iframe.src = url
  console.log("[Agent Manager] iframe blob URL created:", url)
  iframes.set(selectedSessionId, iframe)
  detailArea.appendChild(iframe)
}

// ---- Message handling (from extension host) ----

window.addEventListener("message", (event) => {
  const msg = event.data

  // Messages from the extension host (agentManager.* prefix)
  if (msg?.type?.startsWith("agentManager.")) {
    handleExtensionMessage(msg)
    return
  }

  // Messages from sidebar iframes (no prefix — raw WebviewMessage from sidebar)
  // Identify which iframe sent it by checking event.source
  if (event.source && event.source !== window) {
    for (const [sessionId, iframe] of iframes) {
      if (iframe.contentWindow === event.source) {
        vscode.postMessage({
          type: "agentManager.sidebarMessage",
          sessionId,
          payload: msg,
        })
        return
      }
    }
  }
})

function handleExtensionMessage(msg: { type: string; [key: string]: unknown }) {
  switch (msg.type) {
    case "agentManager.sessions":
      sessions = msg.sessions as AgentSession[]
      renderSessionList()
      break

    case "agentManager.sessionCreated": {
      const session = msg.session as AgentSession
      sessions.push(session)
      selectedSessionId = session.id
      renderSessionList()
      renderDetail()
      break
    }

    case "agentManager.sessionUpdated": {
      const updated = msg.session as AgentSession
      const idx = sessions.findIndex((s) => s.id === updated.id)
      if (idx >= 0) sessions[idx] = updated
      renderSessionList()
      break
    }

    case "agentManager.sessionDeleted": {
      const id = msg.sessionId as string
      sessions = sessions.filter((s) => s.id !== id)
      const iframe = iframes.get(id)
      if (iframe) {
        iframe.remove()
        iframes.delete(id)
      }
      if (selectedSessionId === id) {
        selectedSessionId = sessions.length > 0 ? sessions[0].id : null
      }
      renderSessionList()
      renderDetail()
      break
    }

    case "agentManager.sidebarAssets": {
      const jsUri = msg.jsUri as string
      const cssUri = msg.cssUri as string
      const iconDarkUri = msg.iconDarkUri as string
      const iconLightUri = msg.iconLightUri as string
      console.log("[Agent Manager] Received sidebar asset URIs, fetching...")
      if (sidebarAssetsLoading) break
      sidebarAssetsLoading = true
      // Fetch all assets, create blob URLs for each
      Promise.all([
        fetch(jsUri).then((r) => r.blob()),
        fetch(cssUri).then((r) => r.blob()),
        fetch(iconDarkUri).then((r) => r.blob()),
        fetch(iconLightUri).then((r) => r.blob()),
      ])
        .then(([jsBlob, cssBlob, iconDarkBlob, iconLightBlob]) => {
          const jsBlobUrl = URL.createObjectURL(jsBlob)
          const cssBlobUrl = URL.createObjectURL(cssBlob)
          const iconDarkBlobUrl = URL.createObjectURL(iconDarkBlob)
          const iconLightBlobUrl = URL.createObjectURL(iconLightBlob)
          const cssVars = getVSCodeCSSVariables()
          console.log("[Agent Manager] Created blob URLs for sidebar assets")
          // The sidebar reads window.ICONS_BASE_URI and appends /kilo-dark.svg or /kilo-light.svg
          // We can't use blob URLs as a base path, so we inject a script blob that sets up
          // a mapping and overrides the img src after load via MutationObserver
          const iconScript = `
            window.KILO_ICON_DARK_URL = "${iconDarkBlobUrl}";
            window.KILO_ICON_LIGHT_URL = "${iconLightBlobUrl}";
            window.ICONS_BASE_URI = "";
            new MutationObserver(function(mutations) {
              mutations.forEach(function(m) {
                m.addedNodes.forEach(function(node) {
                  if (node.nodeType === 1) {
                    var imgs = node.querySelectorAll ? node.querySelectorAll('.kilo-logo img') : [];
                    imgs.forEach(function(img) {
                      var isLight = document.body.classList.contains('vscode-light') || document.body.classList.contains('vscode-high-contrast-light');
                      img.src = isLight ? window.KILO_ICON_LIGHT_URL : window.KILO_ICON_DARK_URL;
                    });
                    if (node.matches && node.matches('.kilo-logo img')) {
                      var isLight = document.body.classList.contains('vscode-light') || document.body.classList.contains('vscode-high-contrast-light');
                      node.src = isLight ? window.KILO_ICON_LIGHT_URL : window.KILO_ICON_DARK_URL;
                    }
                  }
                });
              });
            }).observe(document.body, { childList: true, subtree: true });
          `
          const iconScriptBlob = new Blob([iconScript], { type: "application/javascript" })
          const iconScriptBlobUrl = URL.createObjectURL(iconScriptBlob)

          sidebarHtml = `<!DOCTYPE html>
<html lang="en" data-theme="kilo-vscode">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${cssVars}</style>
  <link rel="stylesheet" href="${cssBlobUrl}">
  <style>
    html, body { height: 100%; margin: 0; padding: 0; overflow: hidden; }
    body { background-color: var(--vscode-editor-background); color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
    #root, #root > .container, #root > .container > .chat-view { height: 100%; }
    .container { display: flex; flex-direction: column; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script src="${iconScriptBlobUrl}"></script>
  <script src="${jsBlobUrl}"></script>
</body>
</html>`
          console.log("[Agent Manager] Sidebar HTML built with blob src refs")
          // Render any pending session iframe
          if (selectedSessionId && !iframes.has(selectedSessionId)) {
            console.log("[Agent Manager] Rendering pending iframe for session", selectedSessionId)
            renderDetail()
          }
        })
        .catch((err) => {
          console.error("[Agent Manager] Failed to fetch sidebar assets:", err)
          sidebarAssetsLoading = false
        })
      break
    }

    case "agentManager.sidebarEvent": {
      const sessionId = msg.sessionId as string
      const iframe = iframes.get(sessionId)
      if (iframe?.contentWindow) {
        iframe.contentWindow.postMessage(msg.payload, "*")
      }
      break
    }

    case "agentManager.error":
      console.error("[Agent Manager]", msg.message)
      break
  }
}

// ---- Init ----
renderDetail()
vscode.postMessage({ type: "agentManager.ready" })
