# Architecture Overview

## System Architecture

The Kilo Code documentation site is built using Docusaurus 3.8.1, a modern static site generator optimized for documentation websites. The architecture follows a standard Docusaurus pattern with custom enhancements for the Kilo Code brand and functionality.

## Project Structure

### Root Configuration

- [`package.json`](package.json:1) - Project dependencies and build scripts
- [`docusaurus.config.ts`](docusaurus.config.ts:1) - Main Docusaurus configuration
- [`sidebars.ts`](sidebars.ts:1) - Documentation navigation structure
- [`.env.example`](.env.example:1) - Environment variables template

### Source Code Organization

#### `/src` Directory

- [`src/constants.ts`](src/constants.ts:1) - Application-wide constants (URLs, links, configuration)
- [`src/components/`](src/components/) - Custom React components
    - [`Codicon.tsx`](src/components/Codicon.tsx:1) - VS Code icon component
    - [`Image.js`](src/components/Image.js:1) - Enhanced image component
    - [`ReportIssue/`](src/components/ReportIssue/) - Issue reporting component
    - [`YouTubeEmbed/`](src/components/YouTubeEmbed/) - YouTube video embedding
- [`src/css/custom.css`](src/css/custom.css:1) - Global styling and theme customization
- [`src/theme/`](src/theme/) - Docusaurus theme customizations

#### `/docs` Directory Structure

The documentation follows a hierarchical organization:

```
docs/
├── index.mdx                    # Landing page
├── getting-started/             # Installation and setup
├── basic-usage/                 # Core functionality
├── features/                    # Feature documentation
│   ├── tools/                   # Tool reference
│   ├── mcp/                     # MCP integration
│   ├── slash-commands/          # Command workflows
│   └── experimental/            # Beta features
├── advanced-usage/              # Advanced topics
├── providers/                   # AI provider setup guides
└── extending/                   # Development and contribution
```

#### `/static` Directory

- [`static/img/`](static/img/) - Images organized by feature/section
- [`static/downloads/`](static/downloads/) - Downloadable resources

### Key Technical Decisions

#### Documentation Organization

- **Feature-First Structure**: Documentation is organized by user journey and feature categories rather than technical implementation
- **Provider Separation**: Each AI provider has dedicated documentation for setup and configuration
- **Tool Reference**: Comprehensive tool documentation with individual pages for each tool

#### Navigation Design

- **Progressive Disclosure**: Information is layered from basic to advanced usage
- **Cross-References**: Extensive internal linking between related concepts
- **Search Integration**: Local search with @easyops-cn/docusaurus-search-local

#### Content Strategy

- **MDX Support**: Enhanced markdown with React component integration
- **Code Examples**: Extensive use of code blocks with syntax highlighting
- **Visual Documentation**: Screenshots and diagrams for complex concepts

## Component Relationships

### Core Components

1. **Docusaurus Core** - Static site generation and routing
2. **Custom Theme** - VS Code-inspired styling and branding
3. **Search Integration** - Local search functionality
4. **Analytics** - PostHog integration for usage tracking
5. **Custom Components** - Enhanced documentation experience

### Data Flow

1. **Content Creation** - Markdown/MDX files in `/docs`
2. **Build Process** - Docusaurus compilation and optimization
3. **Static Generation** - HTML/CSS/JS output for hosting
4. **Deployment** - Static files served at https://kilo.ai/docs

## Critical Implementation Paths

### Build System

- **Development**: `npm start` - Local development server with hot reload
- **Production**: `npm run build` - Optimized static site generation
- **Deployment**: Static files hosted with CDN distribution

### Content Management

- **Documentation Updates**: Direct markdown file editing
- **Asset Management**: Static files in organized directory structure
- **Version Control**: Git-based workflow for content updates

### Search Implementation

- **Local Search**: @easyops-cn/docusaurus-search-local plugin
- **Indexing**: Automatic content indexing during build
- **Search UI**: Integrated search bar with contextual results

### Customization Points

- **Theme Overrides**: Custom CSS and component swizzling
- **Plugin Configuration**: Docusaurus plugin ecosystem integration
- **Content Enhancement**: MDX components for interactive documentation

## Integration Points

### External Services

- **PostHog Analytics**: User behavior tracking and insights
- **GitHub Integration**: Edit links and issue reporting
- **Community Platforms**: Discord, Reddit, Twitter integration

### VS Code Extension Integration

- **Deep Linking**: Direct links to extension installation
- **Context Sharing**: Documentation references from extension
- **Feature Parity**: Documentation reflects current extension capabilities

## Performance Considerations

### Build Optimization

- **Static Generation**: Pre-built HTML for fast loading
- **Asset Optimization**: Image compression and lazy loading
- **Code Splitting**: JavaScript bundle optimization

### User Experience

- **Mobile Responsive**: Optimized for all device sizes
- **Fast Navigation**: Client-side routing for smooth transitions
- **Search Performance**: Local search for instant results

## Maintenance Patterns

### Content Updates

- **Regular Reviews**: Documentation accuracy validation
- **Feature Alignment**: Updates synchronized with extension releases
- **Community Feedback**: User-driven improvements and corrections

### Technical Maintenance

- **Dependency Updates**: Regular package updates and security patches
- **Performance Monitoring**: Build time and site performance tracking
- **Accessibility**: WCAG compliance and usability improvements
