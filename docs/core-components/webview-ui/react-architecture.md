# React Component Architecture

This document details the React component architecture used in the webview UI, including
component hierarchy, patterns, and state management approaches.

## Application Structure

### App Component Hierarchy

The application follows a hierarchical structure with clear provider boundaries:

```
AppWithKiloCodeErrorBoundary
└── KiloCodeErrorBoundary
    └── AppWithProviders
        └── ExtensionStateContextProvider
            └── TranslationProvider
                └── QueryClientProvider
                    └── TooltipProvider
                        └── App
```

### Main App Component

The `App` component (`src/App.tsx`) serves as the main application shell and handles:

- **Tab Management**: Manages different views (chat, settings, history, etc.)
- **Message Handling**: Processes messages from the VS Code extension
- **Dialog State**: Manages modal dialogs and overlays
- **Route-like Navigation**: Tab-based navigation system

#### Key Features

```typescript
type Tab = "settings" | "history" | "mcp" | "modes" | "chat" | "marketplace" | "account" | "profile"

interface AppState {
	tab: Tab
	humanRelayDialogState: HumanRelayDialogState
	deleteMessageDialogState: DeleteMessageDialogState
	editMessageDialogState: EditMessageDialogState
}
```

## Component Organization Patterns

### Feature-Based Organization

Components are organized by feature domain:

```
components/
├── chat/              # Chat interface and messaging
├── settings/          # Configuration and preferences
├── history/           # Task history and management
├── mcp/              # MCP server integration
├── marketplace/       # Extension marketplace
├── modes/            # Mode selection and management
├── welcome/          # Onboarding experience
├── ui/               # Reusable component library
└── common/           # Shared utility components
```

### Component Types

#### 1. View Components

Large, page-like components that represent main application screens:

```typescript
// Example: ChatView component
interface ChatViewProps {
	isHidden: boolean
	showAnnouncement: boolean
	hideAnnouncement: () => void
}

export interface ChatViewRef {
	acceptInput: () => void
	focusInput: () => void
}

const ChatView = forwardRef<ChatViewRef, ChatViewProps>((props, ref) => {
	// Component implementation
})
```

#### 2. Feature Components

Mid-level components that implement specific features:

```typescript
// Example: ChatTextArea component
interface ChatTextAreaProps {
	value: string
	onChange: (value: string) => void
	onSubmit: () => void
	disabled?: boolean
	placeholder?: string
}
```

#### 3. UI Components

Low-level, reusable components from the design system:

```typescript
// Example: Button component with variants
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link"
	size?: "default" | "sm" | "lg" | "icon"
	asChild?: boolean
}
```

## State Management Patterns

### React Hooks Usage

The application extensively uses React hooks for state management:

#### 1. Built-in Hooks

- `useState`: Local component state
- `useEffect`: Side effects and lifecycle
- `useCallback`: Memoized callbacks
- `useMemo`: Memoized values
- `useRef`: DOM references and mutable values

#### 2. Custom Hooks

- `useExtensionState`: Global extension state
- `useAutoApprovalState`: Auto-approval logic
- `useTaskSearch`: Task search functionality
- `useTooltip`: Tooltip management

### Context Patterns

#### ExtensionStateContext

The main context provider that manages global application state:

```typescript
interface ExtensionStateContextType extends ExtensionState {
	// State properties
	didHydrateState: boolean
	showWelcome: boolean
	theme: any
	mcpServers: McpServer[]

	// State setters
	setApiConfiguration: (config: ProviderSettings) => void
	setCustomInstructions: (value?: string) => void
	setAlwaysAllowReadOnly: (value: boolean) => void
	// ... many more setters
}
```

#### Provider Pattern

Context providers are composed in a hierarchical structure:

```typescript
const AppWithProviders = () => (
  <ExtensionStateContextProvider>
    <TranslationProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={STANDARD_TOOLTIP_DELAY}>
          <App />
        </TooltipProvider>
      </QueryClientProvider>
    </TranslationProvider>
  </ExtensionStateContextProvider>
)
```

## Styling Approach

### Tailwind CSS Integration

The application uses Tailwind CSS 4 with VS Code theme integration:

#### Theme Variables

VS Code theme variables are mapped to Tailwind utilities:

```css
@theme {
	--color-vscode-foreground: var(--vscode-foreground);
	--color-vscode-editor-background: var(--vscode-editor-background);
	--color-vscode-button-background: var(--vscode-button-background);
	/* ... more theme variables */
}
```

#### Component Styling

Components use Tailwind classes with VS Code theme integration:

```typescript
const Button = ({ variant, size, className, ...props }) => {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2",
        "border border-vscode-input-border",
        "bg-primary text-primary-foreground",
        "hover:bg-primary/90",
        className
      )}
      {...props}
    />
  )
}
```

### Class Variance Authority (CVA)

Used for creating variant-based component APIs:

```typescript
const buttonVariants = cva("inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xs", {
	variants: {
		variant: {
			default: "border border-vscode-input-border bg-primary text-primary-foreground",
			destructive: "bg-destructive text-destructive-foreground",
			outline: "border border-vscode-input-border bg-transparent",
		},
		size: {
			default: "h-7 px-3",
			sm: "h-6 px-2 text-sm",
			lg: "h-8 px-4 text-lg",
			icon: "h-7 w-7",
		},
	},
})
```

## Component Library Integration

### Radix UI Primitives

The application uses Radix UI for accessible component primitives:

- **Dialog**: Modal dialogs and overlays
- **Dropdown Menu**: Context menus and dropdowns
- **Tooltip**: Accessible tooltips
- **Select**: Custom select components
- **Checkbox**: Form controls
- **Progress**: Progress indicators

### VS Code UI Toolkit

Some components use the official VS Code webview UI toolkit:

```typescript
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"

// Used for VS Code-native styling
<VSCodeButton onClick={handleClick}>
  Native VS Code Button
</VSCodeButton>
```

## Performance Patterns

### Memoization

Components use React.memo and useMemo for performance optimization:

```typescript
// Memoized dialog components
const MemoizedDeleteMessageDialog = React.memo(DeleteMessageDialog)
const MemoizedEditMessageDialog = React.memo(EditMessageDialog)
const MemoizedHumanRelayDialog = React.memo(HumanRelayDialog)
```

### Virtualization

Large lists use react-virtuoso for performance:

```typescript
import { Virtuoso } from "react-virtuoso"

<Virtuoso
  data={messages}
  itemContent={(index, message) => <ChatRow message={message} />}
  followOutput="smooth"
/>
```

### Code Splitting

Components are loaded dynamically where appropriate to reduce bundle size.

## Error Handling

### Error Boundaries

The application uses error boundaries to catch and handle React errors:

```typescript
export class KiloCodeErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true }
  }

  componentDidCatch(error, errorInfo) {
    console.error('React Error Boundary caught an error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return <ErrorFallback />
    }
    return this.props.children
  }
}
```

## Testing Patterns

### Component Testing

Components are tested using React Testing Library:

```typescript
import { render, screen, fireEvent } from '@testing-library/react'
import { Button } from './button'

test('renders button with correct text', () => {
  render(<Button>Click me</Button>)
  expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument()
})
```

### Hook Testing

Custom hooks are tested in isolation:

```typescript
import { renderHook, act } from "@testing-library/react"
import { useAutoApprovalState } from "./useAutoApprovalState"

test("toggles auto approval state", () => {
	const { result } = renderHook(() => useAutoApprovalState())

	act(() => {
		result.current.toggle()
	})

	expect(result.current.isEnabled).toBe(true)
})
```

## Best Practices

### Component Design

1. **Single Responsibility**: Each component has a clear, single purpose
2. **Composition over Inheritance**: Use composition patterns for flexibility
3. **Props Interface**: Well-defined TypeScript interfaces for all props
4. **Ref Forwarding**: Use forwardRef for components that need DOM access

### State Management

1. **Local State First**: Use local state unless sharing is needed
2. **Context for Global State**: Use context for truly global state
3. **Derived State**: Compute derived values rather than storing them
4. **Immutable Updates**: Always update state immutably

### Performance

1. **Memoization**: Use React.memo and useMemo judiciously
2. **Callback Stability**: Use useCallback for stable references
3. **Lazy Loading**: Load components and data lazily when possible
4. **Bundle Optimization**: Keep bundle sizes manageable

### Accessibility

1. **Semantic HTML**: Use proper HTML elements
2. **ARIA Labels**: Provide appropriate ARIA attributes
3. **Keyboard Navigation**: Ensure keyboard accessibility
4. **Screen Reader Support**: Test with screen readers
