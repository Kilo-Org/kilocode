---
"@kilocode/cli": patch
---

Stop MCP server requests from repeating once per second when the server answers the optional GET stream probe with a body that is not an event stream. The response is now reported as "no stream on this endpoint", which the MCP client treats as supported.
