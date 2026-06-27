export const dict = {
  "server.processExited": "CLI process exited with code {{code}} before server started",
  "server.startupTimeout": "Server startup timeout after {{seconds}} seconds",
  "remote.connected": "Kilo Remote: Connected",
  "remote.connecting": "Kilo Remote: Connecting\u2026",
  "kilocode:autocomplete.creditsExhausted.message":
    "Kilo Code Autocomplete has been paused. Possible causes: your Kilo account has no remaining credits, or your configured API key (BYOK) has reached its quota limit. Add Kilo credits or check your API key configuration to resume autocomplete.",
  "kilocode:autocomplete.authError.message":
    "Kilo Code Autocomplete has been paused due to an authentication issue. Possible causes: you are not signed in to Kilo, or your API key (BYOK) is invalid or missing. Please sign in again or check your provider API key settings.",
} as const
