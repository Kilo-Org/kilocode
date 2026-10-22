export namespace GitHubSecurity {
  export function attachment(value: string) {
    if (!URL.canParse(value)) return

    const url = new URL(value)
    if (url.origin !== "https://github.com") return
    if (url.search || url.hash) return

    const asset = url.pathname.match(/^\/user-attachments\/assets\/([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$/i)
    if (asset) return `https://github.com/user-attachments/assets/${encodeURIComponent(asset[1])}`

    const file = url.pathname.match(/^\/user-attachments\/files\/([0-9]+)\/([^/]+)$/)
    if (!file) return

    const name = (() => {
      try {
        return decodeURIComponent(file[2])
      } catch {
        return
      }
    })()
    if (!name || name.includes("/") || name.includes("\\") || name.includes("\0")) return

    return `https://github.com/user-attachments/files/${encodeURIComponent(file[1])}/${encodeURIComponent(name)}`
  }
}
