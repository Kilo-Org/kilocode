# @kilocode/cli

## 0.1.2

### Patch Changes

- [#3259](https://github.com/Kilo-Org/kilocode/pull/3259) [`9e50bca`](https://github.com/Kilo-Org/kilocode/commit/9e50bcaebb93383eca1dac8e23ff02339c910ed9) Thanks [@stennkool](https://github.com/stennkool)! - Continue the last task conversation in the workspace (-c argument)

- [#3491](https://github.com/Kilo-Org/kilocode/pull/3491) [`b884c9e`](https://github.com/Kilo-Org/kilocode/commit/b884c9ea220f3c4c3a9c147f0fece64a26c830b4) Thanks [@catrielmuller](https://github.com/catrielmuller)! - File mention suggestion - @my/file

## 0.1.1

### Patch Changes

- [#3475](https://github.com/Kilo-Org/kilocode/pull/3475) [`623f8b7`](https://github.com/Kilo-Org/kilocode/commit/623f8b7583cd98cafd3b3a49563ffe05b87f2818) Thanks [@iscekic](https://github.com/iscekic)! - logs version on boot

- [#3474](https://github.com/Kilo-Org/kilocode/pull/3474) [`e04b81a`](https://github.com/Kilo-Org/kilocode/commit/e04b81a258bac18abb640d265258a9551494c21d) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Streaming message typewriter rendering

- [#3263](https://github.com/Kilo-Org/kilocode/pull/3263) [`97afc88`](https://github.com/Kilo-Org/kilocode/commit/97afc884060d8c9a15fd084bd8be6b1048ba9852) Thanks [@oliver-14203](https://github.com/oliver-14203)! - /theme command - Enjoy the colors! by: oliver-14203

- [#3289](https://github.com/Kilo-Org/kilocode/pull/3289) [`6a64388`](https://github.com/Kilo-Org/kilocode/commit/6a64388f090f44c2b58c3e418da596413f59ef32) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Tasks history support

- [#3497](https://github.com/Kilo-Org/kilocode/pull/3497) [`bb917a2`](https://github.com/Kilo-Org/kilocode/commit/bb917a2962093a54db7ac82f8d8561f87278e5be) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Fix Wellcome Message regression

## 0.1.0

### Minor Changes

- [#3452](https://github.com/Kilo-Org/kilocode/pull/3452) [`127a255`](https://github.com/Kilo-Org/kilocode/commit/127a2551cfd67d57484e59615b13435e7610acce) Thanks [@Sureshkumars](https://github.com/Sureshkumars)! - This PR improves the display of MCP tool requests and responses in the CLI, addressing issues with truncated payloads, poor formatting, and lack of metadata.

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

### Patch Changes

- [#3463](https://github.com/Kilo-Org/kilocode/pull/3463) [`512f58a`](https://github.com/Kilo-Org/kilocode/commit/512f58aa8b62d4df931d542b2420e292f1a711b6) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Improve low balance message and added a retry action

- [#3468](https://github.com/Kilo-Org/kilocode/pull/3468) [`8f8ef10`](https://github.com/Kilo-Org/kilocode/commit/8f8ef107dd2751e4141473d33e098d6f28faa6d1) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Resolve orphaned partial ask messages

- [#3465](https://github.com/Kilo-Org/kilocode/pull/3465) [`bd0d51e`](https://github.com/Kilo-Org/kilocode/commit/bd0d51e5a43bb3ead7daeb1f45aa1d80cbbb78cc) Thanks [@iscekic](https://github.com/iscekic)! - improves autocomplete behavior

## 0.0.16

### Patch Changes

- [#3426](https://github.com/Kilo-Org/kilocode/pull/3426) [`15243f1`](https://github.com/Kilo-Org/kilocode/commit/15243f118ae4c4ac8a8f89fc6de11d6713f0a6f0) Thanks [@iscekic](https://github.com/iscekic)! - Improves error message clarity when initiating parallel mode

## 0.0.15

### Patch Changes

- [#3355](https://github.com/Kilo-Org/kilocode/pull/3355) [`e366e4c`](https://github.com/Kilo-Org/kilocode/commit/e366e4ce61deb98c587dbc9ef4527b9c04bc2e32) Thanks [@iscekic](https://github.com/iscekic)! - add parallel mode support

## 0.0.14

### Patch Changes

- [#3371](https://github.com/Kilo-Org/kilocode/pull/3371) [`e0e01b2`](https://github.com/Kilo-Org/kilocode/commit/e0e01b2ea03e84ee7447b546231ebed530d5aac8) Thanks [@RSO](https://github.com/RSO)! - Add a --json flag to render a stream of JSON objects while in --auto mode

## 0.0.13

### Patch Changes

- [#3369](https://github.com/Kilo-Org/kilocode/pull/3369) [`e41556e`](https://github.com/Kilo-Org/kilocode/commit/e41556e81a190cafa123e84bd804f7fbede36419) Thanks [@RSO](https://github.com/RSO)! - Add support for showing Kilo Code notifications

## 0.0.12

### Patch Changes

- [#3352](https://github.com/Kilo-Org/kilocode/pull/3352) [`c89bd23`](https://github.com/Kilo-Org/kilocode/commit/c89bd23be4196e95f6577c37b149690832d0be97) Thanks [@Sureshkumars](https://github.com/Sureshkumars)! - MCP operations were being auto-rejected in CI mode (autonomous mode) even when `autoApproval.mcp.enabled: true`, breaking GitHub Actions workflows and other autonomous operations that rely on MCP servers.

    **Root Cause:** The extension sends MCP requests with the ask type set to the operation name (e.g., `"use_mcp_server"`, `"access_mcp_resource"`), but the approval decision logic only handled these as tool names within the `"tool"` ask type. This caused MCP requests to fall through to the default case and get auto-rejected.

    The approval decision service uses a switch statement on `askType` to determine whether to auto-approve, auto-reject, or require manual approval:

    ```typescript
    switch (askType) {
    	case "tool": // handles tool names like "readFile", "writeFile"
    	case "command": // handles command execution
    	case "followup": // handles followup questions
    	case "api_req_failed": // handles retry requests
    	default: // ❌ MCP ask types fell here → auto-reject
    }
    ```

    Added explicit cases for MCP ask types to the switch statement:

    ```typescript
    case "use_mcp_server":
    case "access_mcp_resource":
        if (config.mcp?.enabled) {
            return { action: "auto-approve" }
        }
        return isCIMode ? { action: "auto-reject", ... } : { action: "manual" }
    ```

    Also enhanced the tool handler to catch MCP operations sent as tool names (in case the extension changes format):

    ```typescript
    if (tool === "use_mcp_tool" || tool === "use_mcp_server" || tool === "access_mcp_resource") {
    	if (config.mcp?.enabled) {
    		return { action: "auto-approve" }
    	}
    	// ... rejection logic
    }
    ```

    - **Chose explicit ask type handling** over mapping ask types to tool names (cleaner, respects extension's message format)
    - **Kept both ask type and tool name handlers** for defense-in-depth (minimal overhead, prevents future breakage)
    - **Removed verbose logging** to reduce noise while maintaining troubleshooting capability

    | before                                                                                                                                       | after                                                                                                                                       |
    | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
    | MCP operations auto-rejected in CI mode with error "Auto-rejected in CI mode"                                                                | MCP operations auto-approved when autoApproval.mcp.enabled: true                                                                            |
    | <img width="1444" height="499" alt="before-the-fix" src="https://github.com/user-attachments/assets/57e5820d-196c-4138-8b3d-1f185fc1db56" /> | <img width="1506" height="717" alt="after-the-fix" src="https://github.com/user-attachments/assets/a165aa9c-0018-47e4-a274-fed056716407" /> |

    1. Just `kilocode --auto "Review the PR #2 in X/X repo, use github mcp servers if needed"`
    2. Configure MCP settings with GitHub MCP server
    3. Set `autoApproval.mcp.enabled: true` in config

    ```bash
    cat > ~/.kilocode/cli/config.json <<EOF
    {
      "version": "1.0.0",
      "autoApproval": {
        "mcp": {
          "enabled": true
        }
      }
    }
    EOF

    `kilocode --auto "Review the PR #2 in X/X repo, use github mcp servers if needed"`

    ```

## 0.0.11

### Patch Changes

- [#3278](https://github.com/Kilo-Org/kilocode/pull/3278) [`cba3d00`](https://github.com/Kilo-Org/kilocode/commit/cba3d005766c88200a2d170770dcaeaef172dfbd) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Improved stability of the approval menu, preventing it from showing when you don't expect it

## 0.0.10

### Patch Changes

- [#3260](https://github.com/Kilo-Org/kilocode/pull/3260) [`0f71526`](https://github.com/Kilo-Org/kilocode/commit/0f715267745a0458caa396736551b4b3bb374259) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Improved stability of the approval menu, preventing it from showing when you don't expect it

- [#3262](https://github.com/Kilo-Org/kilocode/pull/3262) [`e6b62d4`](https://github.com/Kilo-Org/kilocode/commit/e6b62d45597aba9f08015fac9ced1c34ae779998) Thanks [@catrielmuller](https://github.com/catrielmuller)! - 'Added /clear command'

## 0.0.9

### Patch Changes

- [#3255](https://github.com/Kilo-Org/kilocode/pull/3255) [`55430b7`](https://github.com/Kilo-Org/kilocode/commit/55430b7965ae2aef12517375a0e0c0e7d8f2367c) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Fix suggestion selection with arrow keys

- [#3253](https://github.com/Kilo-Org/kilocode/pull/3253) [`db9cb43`](https://github.com/Kilo-Org/kilocode/commit/db9cb4355ae0e4559e99066c78315ee3635a3543) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Terminal resize support

## 0.0.8

### Patch Changes

- [#3201](https://github.com/Kilo-Org/kilocode/pull/3201) [`c44f948`](https://github.com/Kilo-Org/kilocode/commit/c44f9482fd024f38b7216a7f74b20a96445461a7) Thanks [@RSO](https://github.com/RSO)! - Added an onboarding wizard that helps you get set up in the CLI.

- [#3208](https://github.com/Kilo-Org/kilocode/pull/3208) [`cdc007c`](https://github.com/Kilo-Org/kilocode/commit/cdc007c1150d5210cc0b9c8e5c2b4c57efadfd44) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Allow auto-approval of commands straight from the approval menu

- [#3202](https://github.com/Kilo-Org/kilocode/pull/3202) [`6ab57f4`](https://github.com/Kilo-Org/kilocode/commit/6ab57f441847e07dd6868a87913a41e0cb137fa8) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Added prompt history. Use your up/down keys to navigate through previous prompts!

## 0.0.7

### Patch Changes

- [#3176](https://github.com/Kilo-Org/kilocode/pull/3176) [`4bcc1ee`](https://github.com/Kilo-Org/kilocode/commit/4bcc1ee557ae4b4244365a72679ec1f13332e856) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Support Kilo Code for Teams

- [#3168](https://github.com/Kilo-Org/kilocode/pull/3168) [`476d835`](https://github.com/Kilo-Org/kilocode/commit/476d835b7ab9fee35e2832fe329b2256b36b78c7) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Fix compatibility with extension v4.107.0

- [#3161](https://github.com/Kilo-Org/kilocode/pull/3161) [`712b104`](https://github.com/Kilo-Org/kilocode/commit/712b104acb323da51ac271b7eb95741b3cfa6d9d) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Improved install speed and fixed the outdated dependencies

## 0.0.6

### Patch Changes

- [#3128](https://github.com/Kilo-Org/kilocode/pull/3128) [`04a8de4`](https://github.com/Kilo-Org/kilocode/commit/04a8de4367cdac6401001a906b01755373be5a80) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Support all providers that are supported by the VS Code extension

## 0.0.5

### Patch Changes

- [#3094](https://github.com/Kilo-Org/kilocode/pull/3094) [`b55f3a8`](https://github.com/Kilo-Org/kilocode/commit/b55f3a8784df8efc1ff5f06d53a7c5998b4794ea) Thanks [@RSO](https://github.com/RSO)! - Rename -ci flag to -a (longform --auto)

- [#3080](https://github.com/Kilo-Org/kilocode/pull/3080) [`021c91c`](https://github.com/Kilo-Org/kilocode/commit/021c91c98ac8959f1de0f651d9bfd0e0ab885b17) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Added support for multi-line prompts

- [#3109](https://github.com/Kilo-Org/kilocode/pull/3109) [`2ed8e2e`](https://github.com/Kilo-Org/kilocode/commit/2ed8e2ec655efd22a081fe299b02d05e95227637) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Update notification message at startup

## 0.0.4

### Patch Changes

- [#3066](https://github.com/Kilo-Org/kilocode/pull/3066) [`263741a`](https://github.com/Kilo-Org/kilocode/commit/263741a88054cf57591e5e240dfcafc8bb5c97ee) Thanks [@RSO](https://github.com/RSO)! - Made Logo responsive so that it better fits smaller screens

## 0.0.3

### Patch Changes

- [#3051](https://github.com/Kilo-Org/kilocode/pull/3051) [`c46bcff`](https://github.com/Kilo-Org/kilocode/commit/c46bcffc3e02b114042c96929c151206f26b412c) Thanks [@catrielmuller](https://github.com/catrielmuller)! - CLI - Fix deprecated dependencies

- [#3047](https://github.com/Kilo-Org/kilocode/pull/3047) [`b82b576`](https://github.com/Kilo-Org/kilocode/commit/b82b5765cb2a8334b06d98df992bb6763ef1d786) Thanks [@RSO](https://github.com/RSO)! - Initial pre-release of the CLI.

- [#3049](https://github.com/Kilo-Org/kilocode/pull/3049) [`88954dc`](https://github.com/Kilo-Org/kilocode/commit/88954dc4cca1b59aa7dc145eb86861960e3a20e1) Thanks [@RSO](https://github.com/RSO)! - Fixed the --version flag
