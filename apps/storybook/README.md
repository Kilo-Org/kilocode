# Storybook

Component library and design system documentation for the VS Code extension.

## Quick Start

```bash
# Install dependencies
pnpm install

# Run Storybook
pnpm storybook
```

Visit [http://localhost:6006](http://localhost:6006) to view the component library.

## VS Code Themes

This Storybook uses **automatically generated VS Code themes** to ensure our components match the official VS Code appearance exactly. The themes are generated from Microsoft's official VS Code theme files and converted to CSS variables.

### Available Themes

- **Dark Modern** - VS Code's default dark theme
- **Light Modern** - VS Code's default light theme

Use the theme switcher in the Storybook toolbar to toggle between themes.

### Theme Regeneration

The theme CSS files are checked into the repository and rarely need updating. To regenerate themes (only needed when VS Code releases new theme updates):

```bash
pnpm generate-theme-styles
```

This script:

1. Fetches the latest theme JSON files from the VS Code repository
2. Resolves theme includes (e.g., `dark_modern` includes `dark_plus`)
3. Converts theme colors to CSS variables (e.g., `editor.background` → `--vscode-editor-background`)
4. Outputs CSS files to `.storybook/themes/`

## Scripts

- `pnpm storybook` - Start development server
- `pnpm build` - Build static Storybook
- `pnpm generate-theme-styles` - Regenerate VS Code theme CSS files
- `pnpm test` - Run component tests
