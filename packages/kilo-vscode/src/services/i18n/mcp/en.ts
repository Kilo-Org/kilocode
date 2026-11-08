// English runtime translations for MCP OAuth sign-in notifications shown by
// the extension host (native showInformationMessage/showErrorMessage), used
// when a webview did not request a silent/inline outcome.

export const dict = {
  "mcp.signIn.success": "Signed in to {{name}}.",
  "mcp.signIn.failed": "Sign-in to {{name}} failed.",
  "mcp.signIn.timeout": "Sign-in to {{name}} timed out.",
  "mcp.signIn.unsupported": "{{name}} does not support OAuth sign-in.",
  "mcp.signIn.notFound": "MCP server {{name}} was not found.",
  "mcp.auth.browserFailed":
    "Kilo could not open a browser for {{name}}. Open the authorization URL on the machine running Kilo to finish signing in.",
  "mcp.auth.browserFailed.open": "Open in Browser",
  "mcp.auth.browserFailed.copy": "Copy URL",
  "mcp.auth.resetFailed": "Could not clear the stored sign-in for {{name}}.",
}
