# Contributing to Documentation

This guide explains how to contribute to the Kilo Code documentation.

## Documentation Structure

The documentation follows a structured approach:

```text
docs/
├── README.md                    # Main documentation entry point
├── architecture/               # System architecture documentation
├── core-components/           # Component-specific documentation
├── development/               # Development guides and workflows
├── api-reference/             # API documentation
└── scripts/                   # Build and validation scripts
```

## Writing Documentation

### Markdown Standards

- Use ATX-style headers (`#` instead of `===`)
- Keep lines under 100 characters when possible
- Use consistent indentation (2 spaces)
- Include a title header (`# Title`) in each document
- Use descriptive link text

### Content Guidelines

1. **Be Clear and Concise** - Write for developers who may be new to the project
2. **Include Examples** - Provide code examples and practical usage
3. **Keep It Current** - Update documentation when code changes
4. **Link Appropriately** - Use relative links for internal documentation

### File Organization

- Use lowercase filenames with hyphens: `getting-started.md`
- Place files in appropriate directories based on content type
- Create README.md files for directory overviews
- Use consistent naming conventions

## Development Workflow

### Building Documentation

```bash
# Build all documentation
pnpm docs:build

# Build and watch for changes
pnpm docs:dev
```

### Validation

```bash
# Validate documentation structure and content
pnpm docs:validate

# Check for broken links
pnpm docs:check-links

# Lint markdown files
cd docs && pnpm lint

# Format markdown files
cd docs && pnpm format
```

### Testing Changes

1. **Build Locally** - Always build and test your changes locally
2. **Validate Links** - Run link checking to ensure all references work
3. **Check Formatting** - Use the linter to maintain consistent style
4. **Review Output** - Check the generated HTML in `docs/dist/`

## Documentation Types

### Architecture Documentation

- High-level system design
- Component relationships
- Design decisions and rationale
- Include diagrams using Mermaid when helpful

### Component Documentation

- Detailed component functionality
- API interfaces and usage
- Integration patterns
- Testing approaches

### Development Guides

- Step-by-step procedures
- Tool usage and configuration
- Troubleshooting guides
- Best practices

### API Reference

- Complete function signatures
- Parameter descriptions
- Return value documentation
- Usage examples

## Review Process

1. **Self-Review** - Check your documentation builds and validates correctly
2. **Peer Review** - Have another developer review for clarity and accuracy
3. **Link Validation** - Ensure all links work and point to correct locations
4. **Integration Testing** - Verify documentation integrates well with existing content

## Tools and Scripts

### Build Scripts

- `scripts/build-docs.mjs` - Main documentation build script
- `scripts/validate-docs.mjs` - Content validation and checking
- `scripts/check-links.mjs` - Link validation
- `scripts/dev-docs.mjs` - Development server with file watching

### Configuration Files

- `.markdownlint.json` - Markdown linting rules
- `package.json` - Dependencies and scripts
- `turbo.json` - Build system configuration

## Common Issues

### Broken Links

- Use relative paths for internal links
- Check file paths and extensions
- Verify target files exist

### Build Failures

- Check for syntax errors in markdown
- Ensure all dependencies are installed
- Verify file permissions and paths

### Validation Errors

- Fix markdown formatting issues
- Add missing titles to documents
- Remove TODO/FIXME comments before committing

## Getting Help

- Check existing documentation for examples
- Review the validation output for specific errors
- Ask questions in team communication channels
- Refer to the main project documentation for context
