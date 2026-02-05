# Kilo JetBrains Plugin

AI coding assistant plugin for JetBrains IDEs, powered by Kilo CLI.

## Features

- **AI Chat Interface**: Conversational AI assistant integrated into your IDE
- **Session Management**: Create, rename, archive, and delete chat sessions
- **Code Context**: Add files and selections to your conversation with `@` mentions
- **Real-time Streaming**: See AI responses as they're generated
- **Native UI**: Built with Swing and IntelliJ UI components for a native look and feel

## Requirements

- **JetBrains IDE**: IntelliJ IDEA, WebStorm, PyCharm, GoLand, etc. (2024.1+)
- **Kilo CLI**: Must be installed and available in your PATH

## Installation

### From JetBrains Marketplace (Coming Soon)

1. Open Settings → Plugins
2. Search for "Kilo"
3. Click Install

### From Source

1. Clone the repository
2. Build the plugin:
   ```bash
   cd sdks/jetbrains
   ./gradlew buildPlugin
   ```
3. Install from disk:
   - Open Settings → Plugins → ⚙️ → Install Plugin from Disk
   - Select `build/distributions/kilo-jetbrains-*.zip`

## Usage

### Opening Kilo

- **Keyboard**: `Cmd+Escape` (Mac) or `Ctrl+Escape` (Windows/Linux)
- **Menu**: Tools → Open Kilo
- **Tool Window**: Click the Kilo icon in the right sidebar

### Creating a Session

- Click the `+` button in the session list
- Or use `Cmd+Shift+K` / `Ctrl+Shift+K`

### Adding Context

- **Add File**: Right-click in editor → "Add File to Kilo" or `Cmd+Alt+K`
- **Add Selection**: Select code, right-click → "Add Selection to Kilo"
- **@ Mentions**: Type `@filename` in the chat to reference files

### Sending Messages

- Type your message in the input area
- Press `Enter` to send
- Press `Shift+Enter` for a new line

## Development

### Prerequisites

- JDK 17+
- Gradle 8.10+

### Building

```bash
./gradlew build
```

### Running in Development IDE

```bash
./gradlew runIde
```

### Testing

```bash
./gradlew test
```

## Architecture

The plugin consists of:

- **KiloServerService**: Manages the Kilo CLI server process
- **KiloApiClient**: HTTP client for REST API communication
- **KiloEventService**: SSE client for real-time events
- **KiloStateService**: Reactive state management
- **Tool Window**: Swing-based UI components

```
┌─────────────────────────────────────────┐
│          JetBrains IDE                  │
├─────────────────────────────────────────┤
│         Kilo Plugin                     │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐ │
│  │Sessions │  │  Chat   │  │ Actions │ │
│  │  Panel  │  │  Panel  │  │         │ │
│  └─────────┘  └─────────┘  └─────────┘ │
│         ↓           ↓           ↓       │
│  ┌─────────────────────────────────────┐│
│  │       KiloStateService              ││
│  └─────────────────────────────────────┘│
│         ↓                    ↓          │
│  ┌─────────────┐    ┌─────────────────┐ │
│  │ ApiClient   │    │  EventService   │ │
│  │  (HTTP)     │    │     (SSE)       │ │
│  └─────────────┘    └─────────────────┘ │
├─────────────────────────────────────────┤
│              HTTP / SSE                 │
├─────────────────────────────────────────┤
│         Kilo CLI Server                 │
│       (kilo serve --port XXXX)          │
└─────────────────────────────────────────┘
```

## Configuration

The plugin automatically starts a Kilo server when the tool window is opened. The server runs on a random available port.

## Troubleshooting

### "Kilo CLI not found"

Make sure `kilo` (or `opencode`) is installed and available in your PATH:

```bash
which kilo
# or
which opencode
```

### Server fails to start

Check the IDE log for errors:

- Help → Show Log in Finder/Explorer

### Connection issues

The plugin will automatically attempt to reconnect if the connection is lost.

## License

MIT
