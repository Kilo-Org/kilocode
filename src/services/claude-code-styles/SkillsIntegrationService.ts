import { CodeStyleExtractor, CodeStylesSkills } from './CodeStyleExtractor.js'
import * as vscode from 'vscode'
import * as path from 'node:path'

/**
 * Service for managing skills and code styles integration with Claude Code provider
 */
export class SkillsIntegrationService {
  private extractor: CodeStyleExtractor
  private context: vscode.ExtensionContext

  constructor(context: vscode.ExtensionContext, workspaceRoot: string) {
    this.context = context
    this.extractor = new CodeStyleExtractor(workspaceRoot)
  }

  /**
   * Initialize the skills service by ensuring required directories and files exist
   */
  async initialize(): Promise<void> {
    await this.ensureRulesDirectory()
    await this.createExampleFilesIfMissing()
  }

  /**
   * Extract and cache skills for the current workspace
   */
  async extractWorkspaceSkills(): Promise<CodeStylesSkills> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
    if (!workspaceFolder) {
      throw new Error('No workspace folder found')
    }

    const skills = await this.extractor.extractStylesAndSkills()
    
    await this.extractor.addMissingSkills(skills.skills)

    // Cache the results
    await this.context.workspaceState.update('kilocode.skills', {
      ...skills,
      extractedAt: new Date().toISOString()
    })

    return skills
  }

  /**
   * Get cached skills or extract fresh ones
   */
  async getSkills(): Promise<CodeStylesSkills> {
    const cached = this.context.workspaceState.get<CodeStylesSkills & { extractedAt: string }>('kilocode.skills')
    
    // Return cached version if it's less than 1 hour old
    if (cached?.extractedAt) {
      const cacheTime = new Date(cached.extractedAt)
      const now = new Date()
      const hoursDiff = (now.getTime() - cacheTime.getTime()) / (1000 * 60 * 60)
      
      if (hoursDiff < 1) {
        return {
          styles: cached.styles,
          skills: cached.skills,
          lastUpdated: cached.lastUpdated
        }
      }
    }

    // Extract fresh skills
    return await this.extractWorkspaceSkills()
  }

  /**
   * Format skills for Claude Code provider display
   */
  formatSkillsForProvider(skills: CodeStylesSkills): string {
    const formattedStyles = skills.styles.map(style => 
      `- **${style.category}:** ${style.value}${style.description ? ` (${style.description})` : ''}`
    ).join('\n')

    const formattedSkillCategories = skills.skills.map(category => 
      `## ${category.category}\n${category.skills.map(skill => `- ${skill}`).join('\n')}${category.examples ? `\n\n*Examples:* ${category.examples.join(', ')}` : ''}`
    ).join('\n\n')

    return `## Code Styles & Skills

${formattedStyles}

### Detected Skills
${formattedSkillCategories}

*Last updated: ${skills.lastUpdated.toLocaleDateString()}*`
  }

  /**
   * Ensure the .kilocode/rules directory exists
   */
  private async ensureRulesDirectory(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
    if (!workspaceFolder) return

    const rulesDir = path.join(workspaceFolder.uri.fsPath, '.kilocode', 'rules')
    
    try {
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(rulesDir))
    } catch (error) {
      // Directory might already exist, ignore error
      console.log('Rules directory already exists or could not be created:', error)
    }
  }

  /**
   * Create example rule files if they don't exist
   */
  private async createExampleFilesIfMissing(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
    if (!workspaceFolder) return

    const rulesDir = path.join(workspaceFolder.uri.fsPath, '.kilocode', 'rules')
    
    await this.createExampleFile(rulesDir, 'codestyle.md', this.getCodestyleExample())
    await this.createExampleFile(rulesDir, 'skills.md', this.getSkillsExample())
  }

  /**
   * Create an example file if it doesn't exist
   */
  private async createExampleFile(rulesDir: string, filename: string, content: string): Promise<void> {
    const filePath = path.join(rulesDir, filename)
    
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(filePath))
      // File exists, don't overwrite
      return
    } catch {
      // File doesn't exist, create it
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(filePath),
        Buffer.from(content, 'utf8')
      )
    }
  }

  /**
   * Example code style rules
   */
  private getCodestyleExample(): string {
    return `# Code Style Rules

## Formatting
- Indentation: 2 spaces
- Line length: 100 characters
- **Trailing commas:** Always
- **Semicolons:** Always

## Naming
**Variables:** camelCase
**Constants:** UPPER_SNAKE_CASE
**Classes:** PascalCase
**Functions:** camelCase

## Documentation
- **Comments:** JSDoc format for functions and classes
- **File headers:** Include copyright and purpose
- **README:** Required for each major component

## Testing
- **Test files:** *.test.* or *.spec.*
- **Test coverage:** Minimum 80%
- **Mocking:** Use Jest mocks for external dependencies

## Code Organization
- **Imports:** Group by type (external, internal, relative)
- **Export:** Use named exports over default exports
- **File size:** Maximum 200 lines per file`
  }

  /**
   * Example skills file
   */
  private getSkillsExample(): string {
    return `# Project Skills

## Frontend Development
- React component architecture
- State management with Redux Toolkit
- TypeScript integration
- CSS-in-JS with Styled Components
- Responsive design principles

## Backend Development
- RESTful API design
- GraphQL schema design
- Database modeling and optimization
- Authentication and authorization
- Microservices architecture

## DevOps & Tooling
- Docker containerization
- CI/CD pipeline management
- Infrastructure as Code (Terraform)
- Monitoring and logging
- Performance optimization

## Quality Assurance
- Test-driven development (TDD)
- Behavior-driven development (BDD)
- Code review processes
- Static code analysis
- Security best practices

## Team Collaboration
- Agile/Scrum methodologies
- Technical documentation
- Knowledge sharing
- Mentoring and code pairing
- Cross-functional communication`
  }

  /**
   * Watch for changes in rules files and refresh cache
   */
  setupFileWatcher(): void {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
    if (!workspaceFolder) return

    const rulesPattern = new vscode.RelativePattern(
      workspaceFolder,
      '.kilocode/rules/**/*'
    )

    const fileWatcher = vscode.workspace.createFileSystemWatcher(rulesPattern)
    
    fileWatcher.onDidChange(async () => {
      // Clear cache to force refresh on next request
      await this.context.workspaceState.update('kilocode.skills', undefined)
    })

    fileWatcher.onDidCreate(async () => {
      await this.context.workspaceState.update('kilocode.skills', undefined)
    })

    fileWatcher.onDidDelete(async () => {
      await this.context.workspaceState.update('kilocode.skills', undefined)
    })

    // Dispose of watcher when extension context is disposed
    this.context.subscriptions.push(fileWatcher)
  }

  /**
   * Command to refresh skills cache
   */
  async refreshSkills(): Promise<void> {
    await this.context.workspaceState.update('kilocode.skills', undefined)
    const skills = await this.extractWorkspaceSkills()
    
    vscode.window.showInformationMessage(
      `Skills refreshed! Found ${skills.styles.length} style rules and ${skills.skills.length} skill categories.`
    )
  }

  /**
   * Command to open rules directory
   */
  async openRulesDirectory(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('No workspace folder found')
      return
    }

    const rulesDir = path.join(workspaceFolder.uri.fsPath, '.kilocode', 'rules')
    
    try {
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(rulesDir), true)
    } catch (error) {
      vscode.window.showErrorMessage(`Could not open rules directory: ${error}`)
    }
  }

  /**
   * Get skills statistics for dashboard/UI
   */
  getSkillsStats(skills: CodeStylesSkills): {
    totalStyles: number
    totalSkills: number
    categories: string[]
    lastUpdated: Date
  } {
    return {
      totalStyles: skills.styles.length,
      totalSkills: skills.skills.reduce((total, category) => total + category.skills.length, 0),
      categories: skills.skills.map(category => category.category),
      lastUpdated: skills.lastUpdated
    }
  }
}