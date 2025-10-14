# Kilo Code CLI

Terminal User Interface for Kilo Code

## Installation

```bash
npm install -g @kilocode/cli@alpha
```

Then, make sure you place your Kilo Code API token in the CLI config:

```bash
kilocode config # this opens up your editor
```

You can find your Kilo Code API token on your profile page at [app.kilocode.ai](https://app.kilocode.ai), and place it in the `kilocodeToken` field in the CLI config.

## Known Issues

### Theme Detection

We don't detect the theme of your terminal, and are aware the the current theme doesn't work well on light mode terminals. Switch to the light theme using using `kilocode config`.

### Outdated dependency warnings

When installing Kilo Code CLI you'll be greeted by some scary looking dependency deprecation warnings. We're aware of the issue and will resolve it shortly.

### Windows Support

We've only tested the CLI on Mac and Linux, and are aware that there are some issues on Windows. For now, if you can, we advise you to use a WSL environment to run the CLI.

## Usage

### Interactive Mode

```bash
# Start interactive chat session
kilocode

# Start with a specific mode
kilocode --mode architect

# Start with a specific workspace
kilocode --workspace /path/to/project
```

### CI Mode (Non-Interactive)

CI mode allows Kilo Code to run in automated environments like CI/CD pipelines without requiring user interaction.

```bash
# Run in CI mode with a prompt
kilocode --ci "Implement feature X"

# Run in CI mode with piped input
echo "Fix the bug in app.ts" | kilocode --ci

# Run in CI mode with timeout (in seconds)
kilocode --ci "Run tests" --timeout 300
```

#### CI Mode Behavior

When running in CI mode (`--ci` flag):

1. **No User Interaction**: All approval requests are handled automatically based on configuration
2. **Auto-Approval/Rejection**: Operations are approved or rejected based on your auto-approval settings
3. **Follow-up Questions**: Automatically responded with a message instructing the AI to make autonomous decisions
4. **Automatic Exit**: The CLI exits automatically when the task completes or times out

#### Auto-Approval Configuration

CI mode respects your auto-approval configuration. Edit your config file with `kilocode config` to customize:

```json
{
	"autoApproval": {
		"enabled": true,
		"read": {
			"enabled": true,
			"outside": true
		},
		"write": {
			"enabled": true,
			"outside": false,
			"protected": false
		},
		"execute": {
			"enabled": true,
			"allowed": ["npm", "git", "pnpm"],
			"denied": ["rm -rf", "sudo"]
		},
		"browser": {
			"enabled": false
		},
		"mcp": {
			"enabled": true
		},
		"mode": {
			"enabled": true
		},
		"subtasks": {
			"enabled": true
		},
		"question": {
			"enabled": false,
			"timeout": 60
		},
		"retry": {
			"enabled": true,
			"delay": 10
		},
		"todo": {
			"enabled": true
		}
	}
}
```

**Configuration Options:**

- `read`: Auto-approve file read operations
    - `outside`: Allow reading files outside workspace
- `write`: Auto-approve file write operations
    - `outside`: Allow writing files outside workspace
    - `protected`: Allow writing to protected files (e.g., package.json)
- `execute`: Auto-approve command execution
    - `allowed`: List of allowed command patterns (e.g., ["npm", "git"])
    - `denied`: List of denied command patterns (takes precedence)
- `browser`: Auto-approve browser operations
- `mcp`: Auto-approve MCP tool usage
- `mode`: Auto-approve mode switching
- `subtasks`: Auto-approve subtask creation
- `question`: Auto-approve follow-up questions
- `retry`: Auto-approve API retry requests
- `todo`: Auto-approve todo list updates

#### CI Mode Follow-up Questions

In CI mode, when the AI asks a follow-up question, it receives this response:

> "This process is running in non-interactive CI mode. The user cannot make decisions, so you should make the decision autonomously."

This instructs the AI to proceed without user input.

#### Exit Codes

- `0`: Success (task completed)
- `124`: Timeout (task exceeded time limit)
- `1`: Error (initialization or execution failure)

#### Example CI/CD Integration

```yaml
# GitHub Actions example
- name: Run Kilo Code
  run: |
      echo "Implement the new feature" | kilocode --ci --timeout 600
```

## Proxy Configuration

The CLI supports HTTP/HTTPS proxy configuration through environment variables. This is useful when running behind corporate proxies or when you need to route traffic through a proxy server.

The proxy configuration works with all HTTP clients used by the CLI and extension:

- **Axios** - Used for many API calls
- **Undici** - Used by fetch-based providers
- **Native fetch** - Node.js built-in fetch

### Supported Environment Variables

- `HTTP_PROXY` / `http_proxy`: Proxy URL for HTTP requests
- `HTTPS_PROXY` / `https_proxy`: Proxy URL for HTTPS requests
- `ALL_PROXY` / `all_proxy`: Fallback proxy for all protocols
- `NO_PROXY` / `no_proxy`: Comma-separated list of domains to bypass proxy
- `NODE_TLS_REJECT_UNAUTHORIZED`: Set to `0` to disable SSL certificate validation (use with caution)

### Proxy URL Format

```
http://[username:password@]proxy-host:port
```

### Examples

#### Basic Proxy Configuration

```bash
# Set proxy for HTTP and HTTPS
export HTTP_PROXY=http://localhost:8080
export HTTPS_PROXY=http://localhost:8080

# Run CLI
kilocode
```

#### Proxy with Authentication

```bash
# Proxy with username and password
export HTTPS_PROXY=http://username:password@proxy.company.com:8080

kilocode
```

#### Bypass Proxy for Specific Domains

```bash
# Set proxy
export HTTPS_PROXY=http://localhost:8080

# Bypass proxy for localhost and internal domains
export NO_PROXY=localhost,127.0.0.1,*.internal.company.com,192.168.0.0/16

kilocode
```

#### Self-Signed Certificates

```bash
# Disable SSL certificate validation (use with caution in development only)
export NODE_TLS_REJECT_UNAUTHORIZED=0
export HTTPS_PROXY=http://localhost:8080

kilocode
```

#### One-Line Command

```bash
# Run with proxy settings in a single command
HTTP_PROXY=http://localhost:8080 HTTPS_PROXY=http://localhost:8080 NODE_TLS_REJECT_UNAUTHORIZED=0 kilocode
```

### NO_PROXY Patterns

The `NO_PROXY` environment variable supports various patterns:

- **Exact domain**: `example.com`
- **Wildcard subdomains**: `*.example.com`
- **IP addresses**: `192.168.1.1`
- **CIDR ranges**: `192.168.0.0/16`
- **Port-specific**: `example.com:8080`
- **Multiple patterns**: `localhost,127.0.0.1,*.internal.com`

### Troubleshooting

If proxy is not working:

1. **Check proxy logs**: The CLI will log proxy configuration on startup
2. **Verify proxy URL**: Ensure the proxy URL is correct and accessible
3. **Test proxy**: Use `curl` to test if the proxy is working:
    ```bash
    curl -x http://localhost:8080 https://api.kilocode.ai
    ```
4. **Check NO_PROXY**: Ensure the target domain is not in NO_PROXY list
5. **Certificate issues**: If you see SSL errors, you may need to set `NODE_TLS_REJECT_UNAUTHORIZED=0` (development only)

## Local Development

### DevTools

In order to run the CLI with devtools, add `DEV=true` to your `pnpm start` command, and then run `npx react-devtools` to show the devtools inspector.
