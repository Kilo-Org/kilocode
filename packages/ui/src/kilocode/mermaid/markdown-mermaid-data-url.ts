// VS Code webview CSP blocks fetch(data:...); decode locally for clipboard/export helpers.
export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(",")
  if (comma < 0) throw new Error("Unable to export Mermaid diagram.")
  const header = dataUrl.slice(0, comma)
  const data = dataUrl.slice(comma + 1)
  const mime = /^data:([^;,]*)/.exec(header)?.[1] || "application/octet-stream"
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}
