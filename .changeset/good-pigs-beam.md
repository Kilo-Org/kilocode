---
"@kilocode/cli": minor
---

This PR improves the display of MCP tool requests and responses in the CLI, addressing issues with truncated payloads, poor formatting, and lack of metadata.

- MCP request arguments were difficult to read (no formatting, no preview mode)
- MCP response payloads were displayed as raw text dumps, overwhelming the terminal
- No JSON detection or pretty-printing
- No metadata about content size or type
- Missing error handling for malformed data
- No indication when content is truncated/previewed

Created new `SayMcpServerResponseMessage` component for MCP responses and refactored `AskUseMcpServerMessage` to share formatting logic. Both will make use of newly added utility functions for JSON detection, formatting, and metadata display.
`formatContentWithMetadata()` - Detects JSON, formats it, handles preview logic (>20 lines → show 5)
`formatJson()` - Pretty-prints JSON with configurable indentation
`approximateByteSize()` - Estimates byte size using `str.length * 3`
`formatByteSize()`, `buildMetadataString()` - Display helpers

| before                                                                                                                               | after                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| <img width="1511" height="890" alt="before" src="https://github.com/user-attachments/assets/9b57d85c-1846-42d5-ba7b-2511a96e77b2" /> | <img width="1510" height="884" alt="after" src="https://github.com/user-attachments/assets/1a7599ce-4112-40d0-ac47-678d626cb51c" /> |

Run the KiloCode CLI and let it automatically use any configured MCP server.
