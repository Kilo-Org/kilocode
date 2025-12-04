# Technology Stack

## Core Framework

### Docusaurus 3.8.1

- **Purpose**: Modern static site generator optimized for documentation
- **Key Features**: React-based, MDX support, built-in search, theming
- **Configuration**: [`docusaurus.config.ts`](docusaurus.config.ts:1)

## Runtime Environment

### Node.js

- **Required Version**: Node.js 18.0 or higher
- **Package Manager**: npm (with package-lock.json for dependency locking)
- **Development Server**: Hot reload with live editing support

## Core Dependencies

### React Ecosystem

- **React 19.0.0**: Core UI library
- **React DOM 19.0.0**: DOM rendering
- **@mdx-js/react 3.0.0**: MDX component integration
- **clsx 2.0.0**: Conditional CSS class utility

### Docusaurus Plugins & Presets

- **@docusaurus/preset-classic 3.8.1**: Standard Docusaurus configuration
- **@docusaurus/plugin-client-redirects 3.8.1**: URL redirect management
- **@easyops-cn/docusaurus-search-local 0.48.5**: Local search functionality

### Styling & UI Components

- **@vscode/codicons 0.0.36**: VS Code icon integration
- **prism-react-renderer 2.3.0**: Syntax highlighting for code blocks
- **Custom CSS**: VS Code-inspired theme in [`src/css/custom.css`](src/css/custom.css:1)

### Analytics & Tracking

- **posthog-docusaurus 2.0.4**: User behavior analytics and insights
- **Configuration**: Environment-based with POSTHOG_API_KEY

## Development Dependencies

### TypeScript Support

- **TypeScript 5.6.2**: Type checking and development tooling
- **@docusaurus/types 3.8.1**: Docusaurus TypeScript definitions
- **@docusaurus/module-type-aliases 3.8.1**: Module type aliases
- **@docusaurus/tsconfig 3.8.1**: Shared TypeScript configuration

### Development Tools

- **dotenv 16.4.7**: Environment variable management
- **husky 9.1.7**: Git hooks for development workflow

## Build System

### Development Workflow

```bash
npm start          # Local development server with hot reload
npm run build      # Production build with optimization
npm run serve      # Serve built files locally
npm run clear      # Clear Docusaurus cache
```

Not that on Windows, it may be useful to use:

```bash
npx docusaurus start
npx docusaurus build
```

### Build Configuration

- **Host**: 0.0.0.0 (accessible from network)
- **Environment Variables**: Loaded via dotenv
- **Output**: Static HTML/CSS/JS files for CDN deployment

## Browser Support

### Production Targets

- **Modern Browsers**: >0.5% usage, not dead, not Opera Mini
- **Specific Exclusions**: Opera Mini (limited JavaScript support)

### Development Targets

- **Chrome**: Last 3 versions
- **Firefox**: Last 3 versions
- **Safari**: Last 5 versions

## External Integrations

### GitHub Integration

- **Repository**: https://github.com/Kilo-Org/docs
- **Edit Links**: Direct links to GitHub for documentation editing
- **Issue Reporting**: Integrated issue creation workflow

### Community Platforms

- **Discord**: https://kilo.ai/discord
- **Reddit**: https://www.reddit.com/r/kilocode/
- **Twitter**: https://x.com/kilocode
- **YouTube**: https://www.youtube.com/@Kilo-Code

### VS Code Marketplace

- **Extension URL**: https://marketplace.visualstudio.com/items?itemName=kilocode.kilo-code
- **Open VSX**: https://open-vsx.org/extension/kilocode/kilo-code

## Deployment Architecture

### Static Site Hosting

- **Production URL**: https://kilo.ai/docs
- **Base Path**: /docs (configured in docusaurus.config.ts)
- **CDN**: Static file distribution for global performance

### Content Delivery

- **Static Assets**: Images, downloads, and media files
- **Search Index**: Local search data bundled with site
- **Sitemap**: Automatic generation for SEO

## Development Constraints

### File Organization

- **Documentation**: Markdown/MDX files in `/docs` directory
- **Static Assets**: Organized by feature in `/static/img`
- **Components**: Custom React components in `/src/components`

### Content Management

- **Version Control**: Git-based workflow for all content
- **Asset Optimization**: Manual image optimization required
- **Link Validation**: Docusaurus validates internal links during build

## Performance Considerations

### Build Optimization

- **Code Splitting**: Automatic JavaScript bundle optimization
- **Static Generation**: Pre-rendered HTML for fast initial load
- **Asset Optimization**: CSS/JS minification in production builds

### Runtime Performance

- **Client-Side Routing**: Fast navigation between pages
- **Search Performance**: Local search index for instant results
- **Image Loading**: Manual lazy loading implementation where needed

## Security & Privacy

### Data Collection

- **Analytics**: PostHog for usage tracking (configurable)
- **Privacy Policy**: Links to both website and extension privacy policies
- **User Control**: Analytics can be disabled via environment configuration

### Content Security

- **Static Generation**: No server-side vulnerabilities
- **External Links**: Proper target and rel attributes for security
- **Asset Validation**: Build-time validation of all assets and links

## Maintenance Requirements

### Regular Updates

- **Dependencies**: Monthly security and feature updates
- **Docusaurus**: Follow major version updates for new features
- **Node.js**: Maintain compatibility with LTS versions

### Content Synchronization

- **Extension Features**: Documentation must reflect current extension capabilities
- **Provider APIs**: Keep provider setup guides current with API changes
- **Community Links**: Verify external links remain active
