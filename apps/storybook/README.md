# Storybook with Playwright Screenshot Integration

This Storybook setup includes automated integration with Playwright E2E test screenshots for visual regression testing.

## How It Works

1. **Playwright Tests**: E2E tests run and capture screenshots using the `takeScreenshot()` function
2. **Screenshot Processing**: The `generate-playwright-screenshot-stories.js` script finds all screenshots from test results
3. **Story Generation**: Screenshots are automatically converted into Storybook stories
4. **Chromatic Upload**: The complete Storybook (regular stories + screenshot stories) is uploaded to Chromatic

## Scripts

- `npm run generate-screenshot-stories` - Process Playwright screenshots into Storybook stories
- `npm run build-storybook-with-screenshots` - Generate screenshot stories and build Storybook
- `npm run chromatic-cli` - Run Chromatic CLI with custom build process

## Workflow

The GitHub Actions workflow (`.github/workflows/chromatic.yml`) now:

1. Runs Playwright tests to capture fresh screenshots
2. Generates Storybook stories from those screenshots
3. Builds the complete Storybook archive
4. Uploads to Chromatic using the CLI for visual regression testing

## Screenshot Stories

Generated screenshot stories are placed in `stories/generated/` and organized by test name. Each screenshot becomes a separate story that can be visually compared in Chromatic.

## Local Development

To test the screenshot integration locally:

```bash
# Run Playwright tests first
pnpm --filter @roo-code/playwright-e2e playwright

# Generate screenshot stories
pnpm --filter @roo-code/storybook generate-screenshot-stories

# Build and view Storybook
pnpm --filter @roo-code/storybook build-storybook
pnpm --filter @roo-code/storybook preview
```
