# Component Library and Design System

This document covers the reusable UI component library and design system used in the webview
UI, including theming, accessibility, and usage patterns.

## Design System Overview

The webview UI uses a comprehensive design system built on:

- **Tailwind CSS 4**: Utility-first CSS framework
- **Radix UI**: Accessible component primitives
- **VS Code Theme Integration**: Seamless integration with VS Code themes
- **Class Variance Authority (CVA)**: Type-safe component variants
- **Lucide React**: Consistent icon system

## Component Library Structure

### Component Organization

```
components/ui/
├── index.ts              # Barrel exports for all components
├── button.tsx            # Button component with variants
├── input.tsx             # Form input components
├── dialog.tsx            # Modal dialogs and overlays
├── tooltip.tsx           # Accessible tooltips
├── select.tsx            # Dropdown selects
├── badge.tsx             # Status badges and labels
├── progress.tsx          # Progress indicators
├── separator.tsx         # Visual separators
├── checkbox.tsx          # Form checkboxes
├── textarea.tsx          # Multi-line text inputs
├── slider.tsx            # Range sliders
├── toggle-switch.tsx     # Toggle switches
├── alert-dialog.tsx      # Confirmation dialogs
├── popover.tsx           # Contextual popovers
├── dropdown-menu.tsx     # Context menus
├── collapsible.tsx       # Expandable content
├── command.tsx           # Command palette
├── searchable-select.tsx # Searchable dropdowns
└── standard-tooltip.tsx  # Standardized tooltips
```

### Barrel Exports

All components are exported through a single index file:

```typescript
// components/ui/index.ts
export * from "./alert-dialog"
export * from "./button"
export * from "./dialog"
export * from "./input"
export * from "./tooltip"
// ... all other components
```

## Theming System

### VS Code Theme Integration

The design system integrates seamlessly with VS Code themes using CSS custom properties:

```css
@theme {
	/* VS Code theme variables mapped to Tailwind */
	--color-vscode-foreground: var(--vscode-foreground);
	--color-vscode-editor-background: var(--vscode-editor-background);
	--color-vscode-button-background: var(--vscode-button-background);
	--color-vscode-input-border: var(--vscode-input-border, transparent);
	--color-vscode-focusBorder: var(--vscode-focusBorder);
	/* ... many more theme variables */
}
```

### Theme Variable Usage

Components use VS Code theme variables through Tailwind utilities:

```typescript
// Example: Input component using theme variables
<input
  className={cn(
    "text-vscode-input-foreground",           // Text color from VS Code theme
    "border border-vscode-dropdown-border",   // Border from VS Code theme
    "bg-vscode-input-background",             // Background from VS Code theme
    "focus-visible:border-vscode-focusBorder", // Focus state from VS Code theme
    className
  )}
/>
```

### Dynamic Theme Adaptation

The theme system automatically adapts to VS Code theme changes:

```typescript
// Theme context provides current theme data
const { theme } = useExtensionState()

// Components automatically inherit theme colors
// No manual theme switching required
```

## Core Components

### Button Component

The Button component provides multiple variants and sizes:

```typescript
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link" | "combobox"
  size?: "default" | "sm" | "lg" | "icon"
  asChild?: boolean
}

// Usage examples
<Button variant="default">Primary Action</Button>
<Button variant="outline" size="sm">Secondary Action</Button>
<Button variant="ghost" size="icon"><Icon /></Button>
```

#### Button Variants

```typescript
const buttonVariants = cva(
	// Base styles
	"inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xs text-base font-medium " +
		"transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring " +
		"disabled:pointer-events-none disabled:opacity-50",
	{
		variants: {
			variant: {
				default: "border border-vscode-input-border bg-primary text-primary-foreground hover:bg-primary/90",
				destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
				outline:
					"border border-vscode-input-border bg-transparent hover:bg-accent hover:text-accent-foreground",
				secondary:
					"border border-vscode-input-border bg-secondary text-secondary-foreground hover:bg-secondary/80",
				ghost: "hover:bg-accent hover:text-accent-foreground",
				link: "text-primary underline-offset-4 hover:underline",
			},
			size: {
				default: "h-7 px-3",
				sm: "h-6 px-2 text-sm",
				lg: "h-8 px-4 text-lg",
				icon: "h-7 w-7",
			},
		},
	},
)
```

### Input Components

#### Basic Input

```typescript
const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex w-full text-vscode-input-foreground border border-vscode-dropdown-border bg-vscode-input-background rounded-xs px-3 py-1 text-base transition-colors",
          "placeholder:text-muted-foreground",
          "focus:outline-0 focus-visible:outline-none focus-visible:border-vscode-focusBorder",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
```

#### Textarea Component

```typescript
// Auto-resizing textarea with VS Code theme integration
<Textarea
  placeholder="Enter your message..."
  value={value}
  onChange={(e) => setValue(e.target.value)}
  className="min-h-[100px]"
/>
```

### Dialog System

#### Basic Dialog

```typescript
<Dialog open={isOpen} onOpenChange={setIsOpen}>
  <DialogContent className="sm:max-w-[600px]">
    <DialogHeader>
      <DialogTitle>Dialog Title</DialogTitle>
      <DialogDescription>
        Dialog description text
      </DialogDescription>
    </DialogHeader>

    <div className="grid gap-4 py-4">
      {/* Dialog content */}
    </div>

    <DialogFooter>
      <Button variant="outline" onClick={() => setIsOpen(false)}>
        Cancel
      </Button>
      <Button onClick={handleConfirm}>
        Confirm
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

#### Alert Dialog

```typescript
<AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Are you sure?</AlertDialogTitle>
      <AlertDialogDescription>
        This action cannot be undone.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction onClick={handleDelete}>
        Delete
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

### Select Components

#### Basic Select

```typescript
<Select value={selectedValue} onValueChange={setSelectedValue}>
  <SelectTrigger className="w-[200px]">
    <SelectValue placeholder="Select an option" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="option1">Option 1</SelectItem>
    <SelectItem value="option2">Option 2</SelectItem>
    <SelectItem value="option3">Option 3</SelectItem>
  </SelectContent>
</Select>
```

#### Searchable Select

```typescript
<SearchableSelect
  options={options}
  value={selectedOption}
  onValueChange={setSelectedOption}
  placeholder="Search and select..."
  searchPlaceholder="Type to search..."
  emptyMessage="No results found"
/>
```

### Tooltip System

#### Standard Tooltip

```typescript
<StandardTooltip content="This is a helpful tooltip">
  <Button>Hover me</Button>
</StandardTooltip>
```

#### Custom Tooltip

```typescript
<Tooltip>
  <TooltipTrigger asChild>
    <Button variant="ghost" size="icon">
      <InfoIcon className="h-4 w-4" />
    </Button>
  </TooltipTrigger>
  <TooltipContent>
    <p>Detailed information about this feature</p>
  </TooltipContent>
</Tooltip>
```

### Badge Component

```typescript
// Badge variants
<Badge variant="default">Default</Badge>
<Badge variant="secondary">Secondary</Badge>
<Badge variant="destructive">Error</Badge>
<Badge variant="outline">Outline</Badge>
```

### Progress Indicators

```typescript
<Progress value={progressValue} className="w-full" />
```

## Icon System

### Lucide React Icons

The design system uses Lucide React for consistent iconography:

```typescript
import {
  Check,
  X,
  ChevronDown,
  Settings,
  Search,
  AlertTriangle
} from "lucide-react"

// Icon usage with consistent sizing
<Button variant="ghost" size="icon">
  <Settings className="h-4 w-4" />
</Button>
```

### VS Code Codicons

For VS Code-specific icons, the system uses the official codicon library:

```typescript
// Codicon usage
<i className="codicon codicon-settings" />
<i className="codicon codicon-search" />
```

### Icon Guidelines

1. **Size Consistency**: Use `h-4 w-4` for most icons, `h-5 w-5` for larger contexts
2. **Color Inheritance**: Icons inherit color from parent text color
3. **Accessibility**: Always provide appropriate ARIA labels for icon-only buttons
4. **Semantic Usage**: Choose icons that clearly represent their function

## Accessibility Features

### ARIA Support

Components include comprehensive ARIA support:

```typescript
// Button with ARIA label
<Button aria-label="Close dialog" variant="ghost" size="icon">
  <X className="h-4 w-4" />
</Button>

// Select with ARIA attributes
<SelectTrigger
  role="combobox"
  aria-expanded={open}
  aria-label="Select an option"
>
  <SelectValue />
</SelectTrigger>

// Toggle switch with ARIA
<div
  role="switch"
  aria-checked={checked}
  aria-label="Enable notifications"
  tabIndex={0}
>
  {/* Toggle content */}
</div>
```

### Keyboard Navigation

All interactive components support keyboard navigation:

- **Tab Navigation**: Proper tab order and focus management
- **Enter/Space**: Activation for buttons and toggles
- **Arrow Keys**: Navigation in selects and menus
- **Escape**: Close dialogs and dropdowns

### Screen Reader Support

```typescript
// Screen reader only text
<span className="sr-only">Close</span>

// Descriptive labels
<input
  aria-label="Search files"
  aria-describedby="search-help"
  placeholder="Type to search..."
/>
<div id="search-help" className="sr-only">
  Search through all files in the workspace
</div>
```

### Focus Management

```typescript
// Focus trap in dialogs
<DialogContent>
  {/* Content automatically traps focus */}
</DialogContent>

// Focus indicators
<Button className="focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
  Focusable Button
</Button>
```

## Utility Functions

### Class Name Merging

The `cn` utility function combines Tailwind classes efficiently:

```typescript
import { cn } from "@/lib/utils"

// Merges classes and resolves conflicts
const buttonClass = cn(
	"px-4 py-2", // Base styles
	"bg-blue-500", // Default background
	variant === "red" && "bg-red-500", // Conditional override
	className, // User-provided classes
)
```

### Class Variance Authority (CVA)

CVA provides type-safe component variants:

```typescript
import { cva, type VariantProps } from "class-variance-authority"

const alertVariants = cva("relative w-full rounded-lg border p-4", {
	variants: {
		variant: {
			default: "bg-background text-foreground",
			destructive: "border-destructive/50 text-destructive dark:border-destructive",
		},
	},
	defaultVariants: {
		variant: "default",
	},
})

interface AlertProps extends VariantProps<typeof alertVariants> {
	className?: string
}
```

## Component Usage Examples

### Form Components

```typescript
const SettingsForm = () => {
  const [name, setName] = useState("")
  const [enabled, setEnabled] = useState(false)
  const [category, setCategory] = useState("")

  return (
    <form className="space-y-4">
      <div>
        <label htmlFor="name" className="block text-sm font-medium mb-2">
          Configuration Name
        </label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Enter configuration name"
        />
      </div>

      <div className="flex items-center space-x-2">
        <Checkbox
          id="enabled"
          checked={enabled}
          onCheckedChange={setEnabled}
        />
        <label htmlFor="enabled" className="text-sm">
          Enable this configuration
        </label>
      </div>

      <div>
        <label htmlFor="category" className="block text-sm font-medium mb-2">
          Category
        </label>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger>
            <SelectValue placeholder="Select category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="general">General</SelectItem>
            <SelectItem value="advanced">Advanced</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex justify-end space-x-2">
        <Button variant="outline" type="button">
          Cancel
        </Button>
        <Button type="submit">
          Save Configuration
        </Button>
      </div>
    </form>
  )
}
```

### Interactive Components

```typescript
const InteractiveExample = () => {
  const [showDialog, setShowDialog] = useState(false)
  const [progress, setProgress] = useState(0)

  return (
    <div className="space-y-4">
      <div className="flex items-center space-x-2">
        <Button onClick={() => setShowDialog(true)}>
          Open Dialog
        </Button>

        <StandardTooltip content="Click to open settings dialog">
          <Button variant="ghost" size="icon">
            <Settings className="h-4 w-4" />
          </Button>
        </StandardTooltip>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span>Progress</span>
          <span>{progress}%</span>
        </div>
        <Progress value={progress} />
      </div>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>
              Configure your preferences
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <p>Dialog content goes here</p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

## Best Practices

### Component Design

1. **Composition over Configuration**: Use compound components for complex UI
2. **Prop Forwarding**: Forward all relevant HTML attributes
3. **Ref Forwarding**: Use `forwardRef` for components that need DOM access
4. **TypeScript**: Provide comprehensive type definitions

### Styling Guidelines

1. **Utility Classes**: Prefer Tailwind utilities over custom CSS
2. **Theme Variables**: Always use VS Code theme variables for colors
3. **Responsive Design**: Use responsive utilities for different screen sizes
4. **Consistent Spacing**: Use Tailwind's spacing scale consistently

### Accessibility Guidelines

1. **Semantic HTML**: Use appropriate HTML elements
2. **ARIA Labels**: Provide descriptive labels for screen readers
3. **Keyboard Support**: Ensure all interactions work with keyboard
4. **Focus Management**: Implement proper focus handling
5. **Color Contrast**: Ensure sufficient color contrast ratios

### Performance Considerations

1. **Tree Shaking**: Import only needed components
2. **Memoization**: Use React.memo for expensive components
3. **Bundle Size**: Monitor component bundle impact
4. **Lazy Loading**: Load heavy components lazily when possible

## Testing Components

### Component Testing

```typescript
import { render, screen, fireEvent } from '@testing-library/react'
import { Button } from './button'

test('button renders with correct text', () => {
  render(<Button>Click me</Button>)
  expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument()
})

test('button handles click events', () => {
  const handleClick = jest.fn()
  render(<Button onClick={handleClick}>Click me</Button>)

  fireEvent.click(screen.getByRole('button'))
  expect(handleClick).toHaveBeenCalledTimes(1)
})
```

### Accessibility Testing

```typescript
import { render } from '@testing-library/react'
import { axe, toHaveNoViolations } from 'jest-axe'

expect.extend(toHaveNoViolations)

test('component has no accessibility violations', async () => {
  const { container } = render(<MyComponent />)
  const results = await axe(container)
  expect(results).toHaveNoViolations()
})
```

## Migration and Updates

### Adding New Components

1. Create component in `components/ui/`
2. Follow existing patterns and conventions
3. Add to `index.ts` barrel export
4. Write comprehensive tests
5. Document usage examples

### Updating Existing Components

1. Maintain backward compatibility
2. Update TypeScript definitions
3. Test with existing usage
4. Update documentation
5. Consider migration path for breaking changes

The component library provides a solid foundation for building consistent, accessible, and themeable UI components
that integrate seamlessly with VS Code's design language.
