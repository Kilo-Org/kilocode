# Webview UI - UI Components Feature

**Quick Navigation for AI Agents**

---

## Overview

Reusable UI component library based on shadcn/ui. Provides consistent, accessible components for the Kilocode interface.

**Source Location**: `webview-ui/src/components/ui/`

---

## Components

### Form Controls

| Component | File | Purpose |
|-----------|------|---------|
| Button | `button.tsx` | Clickable buttons |
| Input | `input.tsx` | Text input fields |
| Textarea | `textarea.tsx` | Multi-line text |
| AutosizeTextarea | `autosize-textarea.tsx` | Auto-expanding textarea |
| Checkbox | `checkbox.tsx` | Checkboxes |
| ToggleSwitch | `toggle-switch.tsx` | Toggle switches |
| Select | `select.tsx` | Dropdown select |
| SearchableSelect | `searchable-select.tsx` | Searchable dropdown |
| Slider | `slider.tsx` | Range sliders |

### Feedback

| Component | File | Purpose |
|-----------|------|---------|
| Progress | `progress.tsx` | Progress bars |
| LabeledProgress | `labeled-progress.tsx` | Progress with label |
| Badge | `badge.tsx` | Status badges |
| Tooltip | `tooltip.tsx` | Hover tooltips |
| StandardTooltip | `standard-tooltip.tsx` | Standard tooltip |

### Overlays

| Component | File | Purpose |
|-----------|------|---------|
| Dialog | `dialog.tsx` | Modal dialogs |
| AlertDialog | `alert-dialog.tsx` | Alert confirmations |
| Popover | `popover.tsx` | Popover containers |
| DropdownMenu | `dropdown-menu.tsx` | Dropdown menus |

### Layout

| Component | File | Purpose |
|-----------|------|---------|
| Tabs | `tabs.tsx` | Tab navigation |
| Collapsible | `collapsible.tsx` | Collapsible sections |
| Separator | `separator.tsx` | Visual separators |

### Special

| Component | File | Purpose |
|-----------|------|---------|
| Command | `command.tsx` | Command palette |
| PathTooltip | `PathTooltip.tsx` | File path tooltip |
| ShimmerText | `shimmer-text.tsx` | Loading shimmer |

---

## Usage Pattern

```tsx
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

<Button variant="primary" onClick={handleClick}>
  Submit
</Button>

<Input placeholder="Enter text..." onChange={handleChange} />
```

---

## Styling

- **Framework**: Tailwind CSS
- **Base**: shadcn/ui components
- **Theme**: VS Code theme integration

---

[← Back to Webview UI](../../Feature-Index.md)
