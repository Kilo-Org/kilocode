/**
 * Shift-click forces a chat web link into the system browser while the
 * Integrated Browser handles link clicks. When the Integrated Browser does
 * not handle links, every link already opens externally, so the modifier
 * changes nothing and this stays false.
 */
export function forcesExternalBrowser(event: { shiftKey: boolean }, browserLinks: boolean | undefined): boolean {
  return browserLinks === true && event.shiftKey
}
