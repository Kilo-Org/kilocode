# Kilocode Change Marking Guidelines

We are a fork of Roo. We regularly merge in the Roo codebase. To enable us to merge more easily, we mark all
our own changes with `kilocode_change` comments.

## Basic Usage

### Single Line Changes

For single line changes, add the comment at the end of the line:

```typescript
let i = 2 // kilocode_change
```

### Multi-line Changes

For multiple consecutive lines, wrap them with start/end comments:

```typescript
// kilocode_change start
let i = 2
let j = 3
// kilocode_change end
```

## Language-Specific Examples

### HTML/JSX/TSX

```html
{/* kilocode_change start */}
<CustomKiloComponent />
{/* kilocode_change end */}
```

### CSS/SCSS

```css
/* kilocode_change */
.kilocode-specific-class {
	color: blue;
}

/* kilocode_change start */
.another-class {
	background: red;
}
/* kilocode_change end */
```

## Special Cases

### New Files

If you're creating a completely new file that doesn't exist in Roo, add this comment at the top:

```
// kilocode_change - new file
```

### Kilocode specific file - these rules take precedence over all other rules above

- if the filename or directory name contains kilocode no marking with comments is required
- all the following folders are kilocode-specific and need no marking with comments:
    - jetbrains/
    - cli/
    - src/services/ghost/
    - src/services/continuedev/
