---
title: "Build Remote Agent"
description: "Pair a phone running Build Remote Agent to spectate a Kilo Code desktop session"
---

# Pair a phone with Build Remote Agent

Kilo Code can use **Build Remote Agent** as a pairing device: the paid
iOS/Android app spectates (and can inject into) this desktop agent through the
free MIT `gbr-agent`. Phone and PC never open ports to each other.

Website: https://grokbuildremote.com/
Agent: https://github.com/LinespottingOrg/GrokBuildRemote-Agents (MIT)
Protocol: `gbr/1` · need agent **v0.6.0+**

Independent product by Linespotting AB. Not affiliated with xAI or SpaceX.

This is **not** a replacement for [Kilo mobile apps](/code-with-ai/platforms/mobile)
or `kilo remote`. Those remain Kilo's own remote sessions. Build Remote Agent
is an optional spectator on loopback MCP / Bot API.

## Install + pair

```bash
# macOS / Linux
curl -fsSL https://grokbuildremote.com/install.sh | bash
gbr-agent version          # must print v0.6.0 or newer
gbr-agent pair             # QR in browser + printed 8-char code
gbr-agent run              # leave running
```

```powershell
# Windows
irm https://grokbuildremote.com/install.ps1 | iex
gbr-agent version
gbr-agent pair
gbr-agent run
```

Phone: open Build Remote Agent → **Scan QR from computer** (or type the 8-char
code). Sessions appear in the app. **Unpair** in Settings before changing PCs.
Force-close is not enough.

## Attach from Kilo Code

After `gbr-agent run`, add a local MCP server under the `mcp` key in
`kilo.jsonc`, `.kilo/kilo.jsonc`, or `~/.config/kilo/kilo.jsonc`:

```json
{
  "mcp": {
    "gbr": {
      "type": "local",
      "command": ["node", "GrokBuildRemote-Agents/mcp/gbr-mcp/bin/gbr-mcp.js"],
      "enabled": true
    }
  }
}
```

Or use **Settings → Agent Behaviour → MCP Servers** and paste the same local
command. You can also point a remote MCP entry at `http://127.0.0.1:8788` only
if you keep `gbr-agent run` on this machine — never expose mailbox keys.

```bash
git clone https://github.com/LinespottingOrg/GrokBuildRemote-Agents.git
cd GrokBuildRemote-Agents/mcp/gbr-mcp && npm install
node bin/gbr-mcp.js --diagnose
curl -sS http://127.0.0.1:8788/health
curl -sS http://127.0.0.1:8788/v1/sessions
```

Phone is spectator + veto. Orchestration stays in Kilo Code.

Do not commit mailbox keys. Phone **Settings → Bot API** is the only place the
relay key is copied.

See [Using MCP in Kilo Code](using-in-kilo-code) for transports and permissions.
