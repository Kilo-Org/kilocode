# Webview UI Architecture

The webview UI is the React-based frontend that provides the user interface for the VS Code
extension. It's built using modern React patterns with TypeScript, Tailwind CSS, and a
comprehensive component library.

## Architecture Overview

The webview UI follows a component-based architecture with clear separation of concerns:

- **App Layer**: Main application shell and routing
- **Context Layer**: Global state management with React Context
- **Component Layer**: Reusable UI components organized by feature
- **Service Layer**: Utilities and external service integrations
- **Hook Layer**: Custom React hooks for shared logic

## Key Technologies

- **React 18**: Modern React with hooks and concurrent features
- **TypeScript**: Type-safe development
- **Tailwind CSS 4**: Utility-first CSS framework with VS Code theme integration
- **Radix UI**: Accessible component primitives
- **React Query**: Data fetching and caching
- **React i18n**: Internationalization support
- **Vite**: Fast build tool and development server

## Directory Structure

```
webview-ui/src/
├── components/          # React components organized by feature
│   ├── chat/           # Chat interface components
│   ├── settings/       # Settings and configuration UI
│   ├── history/        # Task history components
│   ├── mcp/           # MCP server management
│   ├── ui/            # Reusable UI component library
│   └── common/        # Shared components
├── context/           # React Context providers
├── hooks/             # Custom React hooks
├── services/          # External service integrations
├── utils/             # Utility functions
├── i18n/             # Internationalization
└── types.d.ts        # Global type definitions
```

## Component Organization

Components are organized by feature domain rather than technical type, promoting better
maintainability and discoverability. Each major feature has its own directory with related
components, hooks, and utilities.

## Next Steps

- [React Component Architecture](./react-architecture.md) - Detailed component structure and patterns
- [State Management](./state-management.md) - Context and data flow patterns
- [Component Library](./component-library.md) - Reusable UI components and design system
