# Documentation Tasks

This file documents common repetitive tasks and workflows for maintaining the Kilo Code documentation site.

## Add New Provider Documentation

**Last performed:** Initial documentation setup
**Files to modify:**

- `/docs/providers/[provider-name].md` - Create new provider documentation
- `/sidebars.ts` - Add provider to navigation structure
- `/src/constants.ts` - Add provider URLs if needed

**Steps:**

1. Create new provider documentation file in `/docs/providers/`
2. Follow the standard provider documentation template:
    - Introduction and website link
    - Getting an API Key section
    - Supported Models section
    - Configuration in Kilo Code section
    - Tips and Notes section
3. Add provider to the Model Providers section in `sidebars.ts`
4. Update constants file if new URLs are needed
5. Test documentation locally with `npm start`
6. Verify all links work correctly

**Template structure:**

```markdown
---
sidebar_label: Provider Name
---

# Using [Provider Name] With Kilo Code

Brief description of the provider and their strengths.

**Website:** [Provider URL]

## Getting an API Key

[Step-by-step instructions]

## Supported Models

[List of supported models]

## Configuration in Kilo Code

[Setup instructions]

## Tips and Notes

[Additional helpful information]
```

## Add New Tool Documentation

**Last performed:** Tool reference documentation setup
**Files to modify:**

- `/docs/features/tools/[tool-name].md` - Create new tool documentation
- `/sidebars.ts` - Add tool to Tools Reference section
- `/docs/features/tools/tool-use-overview.md` - Update tool overview if needed

**Steps:**

1. Create new tool documentation file in `/docs/features/tools/`
2. Follow the standard tool documentation template
3. Add tool to the Tools Reference section in `sidebars.ts`
4. Update tool overview page if the tool represents a new category
5. Test documentation locally
6. Verify code examples and parameter descriptions are accurate

**Important notes:**

- Include practical examples of tool usage
- Document all parameters with their types and requirements
- Explain when and why to use the tool
- Include common error scenarios and solutions

## Update Feature Documentation

**Last performed:** Feature documentation organization
**Files to modify:**

- Relevant feature documentation files in `/docs/features/`
- `/sidebars.ts` - Update navigation if structure changes
- `/docs/index.mdx` - Update feature highlights if major features added

**Steps:**

1. Identify which feature documentation needs updates
2. Review current documentation for accuracy
3. Update content to reflect latest extension capabilities
4. Add new screenshots if UI has changed
5. Update navigation structure if needed
6. Test all internal links
7. Verify examples still work with current extension version

**Important considerations:**

- Keep screenshots current with latest extension UI
- Ensure feature descriptions match actual extension behavior
- Update version-specific information
- Maintain consistency in documentation style

## Add New Blog Post

**Last performed:** Auto-generate commit messages blog post
**Files to modify:**

- `/blog-posts/[post-name].md` - Create new blog post
- Consider adding to main documentation if content is reference material

**Steps:**

1. Create new blog post file in `/blog-posts/`
2. Follow the established blog post style and tone
3. Include practical examples and real-world usage
4. Add relevant images to `/static/img/` if needed
5. Consider if content should also be added to main documentation
6. Review for clarity and technical accuracy

**Content guidelines:**

- Focus on practical benefits and real-world usage
- Include specific examples and code snippets
- Maintain conversational but informative tone
- Link to relevant documentation sections

## Update Provider API Changes

**Last performed:** Provider documentation updates
**Files to modify:**

- Relevant provider documentation in `/docs/providers/`
- `/docs/getting-started/connecting-api-provider.md` - If setup process changes

**Steps:**

1. Identify which providers have API changes
2. Update supported models lists
3. Update configuration instructions if needed
4. Update pricing information references
5. Test configuration steps with actual provider APIs
6. Update screenshots if provider UIs have changed

**Important notes:**

- Verify model names and capabilities with provider documentation
- Check for new authentication methods or requirements
- Update rate limit information if changed
- Ensure all external links are still valid

## Reorganize Documentation Structure

**Last performed:** Features section reorganization
**Files to modify:**

- `/sidebars.ts` - Primary navigation structure changes
- `/docusaurus.config.ts` - Add redirects for moved content
- Multiple documentation files - Update internal links

**Steps:**

1. Plan new documentation structure
2. Update `sidebars.ts` with new organization
3. Add redirects in `docusaurus.config.ts` for moved content
4. Update internal links throughout documentation
5. Test all navigation paths
6. Verify search functionality still works
7. Update any hardcoded paths in components

**Important considerations:**

- Always add redirects for moved content to prevent broken links
- Update internal link references throughout the site
- Test navigation flow from user perspective
- Consider impact on external links and bookmarks

## Add New Custom Component

**Last performed:** YouTube embed and image components
**Files to modify:**

- `/src/components/[ComponentName]/` - Create new component directory
- `/src/theme/MDXComponents.ts` - Register component for MDX usage
- Documentation files where component will be used

**Steps:**

1. Create component directory in `/src/components/`
2. Implement React component with TypeScript
3. Add component styles in separate CSS module if needed
4. Register component in `MDXComponents.ts` for MDX usage
5. Test component in development environment
6. Document component usage for other contributors
7. Use component in relevant documentation files

**Component guidelines:**

- Follow existing component patterns and styling
- Use TypeScript for type safety
- Include proper error handling
- Make components reusable and configurable
- Follow accessibility best practices

## Update Screenshots and Visual Assets

**Last performed:** Ongoing maintenance need
**Files to modify:**

- `/static/img/[feature-directories]/` - Update screenshot files
- Documentation files with embedded images - Update image references
- `/docs/getting-started/` - Installation and setup screenshots
- `/docs/basic-usage/` - Interface and workflow screenshots

**Steps:**

1. Identify which features have UI changes from extension releases
2. Take new screenshots in consistent browser/OS environment
3. Optimize images for web (compress, appropriate dimensions)
4. Replace old screenshots in `/static/img/` directories
5. Update any image references in documentation files
6. Test that all images load correctly in development
7. Verify images are accessible and have proper alt text

**Important considerations:**

- Maintain consistent screenshot style (browser, zoom level, theme)
- Use descriptive filenames that match the feature being documented
- Compress images to keep site performance optimal
- Update alt text for accessibility
- Consider creating a screenshot style guide for consistency

## Graduate Experimental Features to Stable

**Last performed:** Codebase indexing graduation
**Files to modify:**

- Feature documentation files - Remove experimental warnings
- `/sidebars.ts` - Move from experimental to appropriate section
- `/docs/features/experimental/` - Remove from experimental list
- Related tool documentation - Update experimental status
- `/docusaurus.config.ts` - Add redirects if URLs change

**Steps:**

1. Identify features graduating from experimental status
2. Remove experimental warnings and disclaimers from documentation
3. Update navigation structure in `sidebars.ts`
4. Move documentation files if directory structure changes
5. Add redirects for any changed URLs
6. Update cross-references throughout documentation
7. Remove duplicate documentation if it exists
8. Update feature overview pages to reflect stable status

**Important considerations:**

- Always add redirects for moved content to prevent broken links
- Search for all references to the feature across documentation
- Update any "experimental features" overview pages
- Consider if feature deserves more prominent placement in navigation
- Verify all examples and instructions work with stable version

## Process Extension Release Documentation Updates

**Last performed:** Version-specific updates from todos.md
**Files to modify:**

- Multiple feature documentation files based on release notes
- Provider documentation for new models or API changes
- Tool documentation for behavior changes
- Getting started guides for new onboarding features
- FAQ or troubleshooting sections for resolved issues

**Steps:**

1. Review extension release notes for documentation impacts
2. Categorize changes: UI updates, new features, bug fixes, model additions
3. Update relevant feature documentation with new capabilities
4. Add or update screenshots for UI changes
5. Update provider documentation for new models
6. Update tool documentation for behavior changes
7. Add troubleshooting entries for resolved issues
8. Test all updated examples and instructions

**Important considerations:**

- Prioritize user-facing changes that affect documentation accuracy
- Update version-specific information where relevant
- Ensure examples still work with current extension version
- Consider if changes require updates to getting started flow
- Document any breaking changes or migration steps

## Manage Documentation Redirects

**Last performed:** MCP and features section reorganization
**Files to modify:**

- `/docusaurus.config.ts` - Add redirect configurations
- `/sidebars.ts` - Update navigation structure
- Documentation files - Update internal links

**Steps:**

1. Plan new documentation structure or identify moved content
2. Document all URL changes that will occur
3. Add redirect entries in `docusaurus.config.ts`
4. Update navigation structure in `sidebars.ts`
5. Update internal links throughout documentation
6. Test all redirect paths work correctly
7. Verify search functionality still works
8. Update any hardcoded paths in components

**Important considerations:**

- Always add redirects before moving content to prevent 404 errors
- Use permanent redirects (301) for moved content
- Test redirects work for both old and new URLs
- Update internal links to use new URLs directly
- Consider impact on external links and bookmarks
- Document redirect rationale for future reference

## Resolve Duplicate/Conflicting Documentation

**Last performed:** Codebase search tool documentation cleanup needed
**Files to modify:**

- Duplicate documentation files
- Navigation structure
- Internal links and cross-references
- Redirect configuration if URLs change

**Steps:**

1. Identify duplicate or conflicting documentation files
2. Compare content to determine which version is authoritative
3. Merge useful content from both versions if needed
4. Remove or redirect the duplicate file
5. Update navigation to remove duplicate entries
6. Update internal links to point to single authoritative source
7. Add redirects if removing a file that might be bookmarked
8. Verify no broken links remain

**Important considerations:**

- Determine which version has more accurate/current information
- Preserve any unique content from the version being removed
- Check git history to understand why duplicates exist
- Ensure the remaining version covers all use cases
- Update any cross-references throughout the site

## Update Tool Documentation for Behavior Changes

**Last performed:** Tool fixes mentioned in v4.58.0 release
**Files to modify:**

- Individual tool documentation files in `/docs/features/tools/`
- Tool overview page if categories change
- Examples and usage patterns in tool docs

**Steps:**

1. Review extension release notes for tool behavior changes
2. Identify which tools have updated functionality
3. Update parameter descriptions and requirements
4. Update examples to reflect new behavior
5. Add or update limitation sections
6. Update "when is it used" sections if use cases change
7. Test examples to ensure they work correctly
8. Update tool overview page if needed

**Important considerations:**

- Verify all parameter descriptions are accurate
- Test code examples with current extension version
- Update any error scenarios or troubleshooting information
- Ensure examples demonstrate best practices
- Consider if changes affect tool categorization

## Audit and Fix Broken Links

**Last performed:** Ongoing maintenance need
**Files to modify:**

- All documentation files with internal or external links
- Navigation configuration files
- Component files with hardcoded links

**Steps:**

1. Run Docusaurus build to identify broken internal links
2. Use link checking tools for external links
3. Manually verify provider URLs and external service links
4. Update or remove broken external links
5. Fix internal link references
6. Update navigation structure if needed
7. Test all fixed links work correctly
8. Document any permanently removed external resources

**Important considerations:**

- Docusaurus automatically checks internal links during build
- External links may break due to provider website changes
- Consider using archive.org links for historical references
- Update provider URLs when services rebrand or move
- Remove links to discontinued services
- Add redirects if internal link structure changes

## Update Model Lists Across Providers

**Last performed:** Ongoing as providers add models
**Files to modify:**

- Individual provider documentation files in `/docs/providers/`
- Provider comparison information if it exists
- Getting started guides mentioning specific models

**Steps:**

1. Review provider websites and APIs for new model additions
2. Update supported models lists in provider documentation
3. Add model capabilities and limitations information
4. Update pricing references if available
5. Test configuration with new models if possible
6. Update any model comparison information
7. Verify model names and identifiers are correct
8. Update examples to use current model names

**Important considerations:**

- Verify model names exactly match provider APIs
- Include context window sizes and capabilities where relevant
- Note any special configuration requirements for new models
- Update rate limit information if it varies by model
- Consider if new models change provider recommendations
- Test actual API connectivity when possible
