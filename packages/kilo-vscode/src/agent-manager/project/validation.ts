/** A portable single child-directory name, shared with the webview. */
export function validName(name: string): boolean {
  return (
    name.length > 0 &&
    new TextEncoder().encode(name).length <= 255 &&
    name.trim() === name &&
    !/[<>:"/\\|?*\x00-\x1f\x7f]/.test(name) &&
    !/[. ]$/.test(name) &&
    !/^(?:\.git|con|conin\$|conout\$|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\.|$)/i.test(
      name,
    )
  )
}
