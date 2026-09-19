/**
 * Marks the `{ type: "error" }` post behind a failed revert or redo.
 *
 * The extension host has no translations, so it tags the post with this code and the webview
 * supplies the wording; the code doubles as the i18n key for the toast body. It also tells other
 * panels that the session context already reported this failure, so they do not toast it twice.
 *
 * Deliberately a single code rather than one per cause: the exact git failure belongs in the Kilo
 * logs, not in a taxonomy the UI would have to carry across the wire.
 */
export const REVERT_ERROR_CODE = "revert.error.body"
