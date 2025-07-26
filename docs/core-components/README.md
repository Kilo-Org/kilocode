# Core Components Documentation

This section contains detailed documentation for each major component of the Kilo Code system.

## Components

### [Extension Core](./extension/)

Core extension functionality including activation, commands, and VS Code API integration.

### [Webview UI](./webview-ui/)

React-based frontend UI architecture, components, and state management.

### [Services](./services/)

Service layer including MCP integration, browser services, and external APIs.

### [Tools](./tools/)

Tool implementations for file operations, search, and development utilities.

### [Integrations](./integrations/)

External service integrations and third-party API connections.

## Component Interaction

Components interact through well-defined interfaces and follow established patterns:

- **Extension Core** manages the VS Code extension lifecycle and coordinates other components
- **Webview UI** provides the user interface and communicates with the extension via message passing
- **Services** provide business logic and external integrations
- **Tools** implement specific functionality that can be used across components
- **Integrations** handle connections to external services and APIs
