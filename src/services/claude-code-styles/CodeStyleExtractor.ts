import * as path from "node:path"
import * as path from "node:path"
import * as fs from "node:fs/promises"
import { glob } from "glob"

export interface CodeStyleRule {
  type: "indentation" | "naming" | "formatting" | "documentation" | "testing" | "architecture" | "library"
  category: string
  value: string
  description?: string
}

export interface CodingSkill {
  category: string
  skills: string[]
  examples?: string[]
}

export interface CodeStylesSkills {
  styles: CodeStyleRule[]
  skills: CodingSkill[]
  lastUpdated: Date
}

export class CodeStyleExtractor {
  private workspaceRoot: string

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot
  }

  /**
   * Extract code styles and skills from the project
   */
  async extractStylesAndSkills(): Promise<CodeStylesSkills> {
    const [styleRules, customRules, projectAnalysis, markdownSkills] = await Promise.all([
      this.extractFromConfigFiles(),
      this.extractFromCustomRules(),
      this.analyzeProjectStructure(),
      this.extractFromMarkdown()
    ])

    return {
      styles: [...styleRules, ...customRules.styles],
      skills: [...customRules.skills, ...projectAnalysis.skills, ...markdownSkills],
      lastUpdated: new Date()
    }
  }

  /**
   * Extract styles from configuration files (package.json, .eslintrc, etc.)
   */
  private async extractFromConfigFiles(): Promise<CodeStyleRule[]> {
    const rules: CodeStyleRule[] = []

    try {
      // Check for package.json
      const packageJsonPath = path.join(this.workspaceRoot, "package.json")
      try {
        const packageContent = await fs.readFile(packageJsonPath, "utf8")
        const packageJson = JSON.parse(packageContent)

        if (packageJson.eslintConfig) {
          rules.push({
            type: "formatting",
            category: "ESLint",
            value: "ESLint configuration detected",
            description: "Code linting and formatting rules"
          })
        }

        if (packageJson.prettier) {
          rules.push({
            type: "formatting",
            category: "Prettier",
            value: "Prettier configuration detected",
            description: "Code formatting rules"
          })
        }

        if (packageJson.scripts) {
          const scripts = Object.keys(packageJson.scripts)
          const testingScripts = scripts.filter(script => 
            script.includes("test") || script.includes("jest") || script.includes("vitest")
          )
          if (testingScripts.length > 0) {
            rules.push({
              type: "testing",
              category: "Testing",
              value: testingScripts.join(", "),
              description: "Test scripts detected"
            })
          }
        }

        if (packageJson.dependencies || packageJson.devDependencies) {
          const allDeps = { ...packageJson.dependencies, ...packageJson.devDependencies }
          const detectedLibs = this.detectLibraries(allDeps)
          if (detectedLibs.length > 0) {
            rules.push({
              type: "library",
              category: "Preferred Libraries",
              value: detectedLibs.join(", "),
              description: "Detected project dependencies"
            })
          }
        }
      } catch {
        // package.json doesn't exist or is invalid
      }

      // Check for TypeScript config
        await fs.readFile(tsconfigPath, "utf8")
        // tsconfig.json exists
      try {
        const tsconfigContent = await fs.readFile(tsconfigPath, "utf8")
        const tsconfig = JSON.parse(tsconfigContent)

        rules.push({
          type: "formatting",
          category: "TypeScript",
          value: "TypeScript configuration detected",
          description: "TypeScript strict typing and compilation rules"
        })
      } catch {
        // tsconfig doesn't exist
      }

      // Check for ESLint config files
      const eslintFiles = await glob("**/.eslintrc*", { cwd: this.workspaceRoot })
      if (eslintFiles.length > 0) {
        rules.push({
          type: "formatting",
          category: "ESLint",
          value: "ESLint configuration files found",
          description: `ESLint configs: ${eslintFiles.join(", ")}`
        })
      }

      // Check for Prettier config
      const prettierFiles = await glob("**/.prettierrc*", { cwd: this.workspaceRoot })
      if (prettierFiles.length > 0) {
        rules.push({
          type: "formatting",
          category: "Prettier",
          value: "Prettier configuration files found",
          description: `Prettier configs: ${prettierFiles.join(", ")}`
        })
      }

    } catch (error) {
      console.error("Error extracting styles from config files:", error)
    }

    return rules
  }

  /**
   * Extract from custom rules files in .kilocode/rules/
   */
  private async extractFromCustomRules(): Promise<{ styles: CodeStyleRule[], skills: CodingSkill[] }> {
    const rulesDir = path.join(this.workspaceRoot, ".kilocode", "rules")
    const styles: CodeStyleRule[] = []
    const skills: CodingSkill[] = []

    try {
      const files = await fs.readdir(rulesDir)
      
      for (const file of files) {
        if (file.endsWith(".md")) {
          const filePath = path.join(rulesDir, file)
          const content = await fs.readFile(filePath, "utf8")
          
          if (file.includes("style") || file.includes("format")) {
            const extractedStyles = this.parseMarkdownStyles(content, file)
            styles.push(...extractedStyles)
          } else if (file.includes("skill")) {
            const extractedSkills = this.parseMarkdownSkills(content)
            skills.push(...extractedSkills)
          }
        }
      }
    } catch {
      // .kilocode/rules/ directory doesn't exist
    }

    return { styles, skills }
  }

  /**
   * Analyze project structure to detect skills
   */
  private async analyzeProjectStructure(): Promise<{ skills: CodingSkill[] }> {
    const skills: CodingSkill[] = []

    try {
      // Analyze file patterns
      const sourceFiles = await glob("**/*.{ts,js,tsx,jsx,py,java,cs,go,rs,md}", { 
        cwd: this.workspaceRoot,
        ignore: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.git/**"]
      })

      if (sourceFiles.length === 0) {
        return { skills }
      }

      // Detect languages
      const languageCounts: Record<string, number> = {}
      sourceFiles.forEach(file => {
        const ext = path.extname(file).toLowerCase()
        languageCounts[ext] = (languageCounts[ext] || 0) + 1
      })

      const primaryLanguage = Object.entries(languageCounts)
        .sort(([,a], [,b]) => b - a)[0]?.[0]

      if (primaryLanguage) {
        const languageSkill = this.getLanguageSkill(primaryLanguage, sourceFiles.length)
        if (languageSkill) {
          skills.push(languageSkill)
        }
      }

      // Detect testing patterns
      const testFiles = await glob("**/*.{test,spec}.{ts,js,py,java,cs}", { 
        cwd: this.workspaceRoot,
        ignore: ["**/node_modules/**"]
      })

      if (testFiles.length > 0) {
        skills.push({
          category: "Testing",
          skills: ["Test-driven development", "Unit testing", "Integration testing"],
          examples: testFiles.slice(0, 3)
        })
      }

      // Detect documentation patterns
      const docFiles = await glob("**/*.{md,rst,txt}", { 
        cwd: this.workspaceRoot,
        ignore: ["**/node_modules/**"]
      })

      if (docFiles.length > 0) {
        skills.push({
          category: "Documentation",
          skills: ["Technical documentation", "API documentation", "Code comments"],
          examples: docFiles.slice(0, 3)
        })
      }

      // Detect architecture patterns
      const hasReact = await this.hasFileMatching("**/*.{jsx,tsx}", "react")
      const hasVue = await this.hasFileMatching("**/*.{vue}", "vue")
      const hasAngular = await this.hasFileMatching("**/*.{ts}", "@angular")
      
      if (hasReact || hasVue || hasAngular) {
        const framework = hasReact ? "React" : hasVue ? "Vue" : "Angular"
        skills.push({
          category: "Frontend Framework",
          skills: [`${framework} development`, "Component-based architecture", "State management"]
        })
      }

      const hasNodeModules = await this.checkDirectoryExists("**/node_modules/**")
      if (hasNodeModules) {
        skills.push({
          category: "Package Management",
          skills: ["npm/yarn usage", "Dependency management", "Module bundling"]
        })
      }

    } catch (error) {
      console.error("Error analyzing project structure:", error)
    }

    return { skills }
  }

  /**
   * Extract skills from all markdown files in the workspace
   */
  private async extractFromMarkdown(): Promise<CodingSkill[]> {
    const skills: CodingSkill[] = []

    try {
      const markdownFiles = await glob("**/*.md", {
        cwd: this.workspaceRoot,
        ignore: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.git/**"]
      });

      for (const file of markdownFiles) {
        try {
          const filePath = path.join(this.workspaceRoot, file)
          const content = await fs.readFile(filePath, "utf8")
          const extractedSkills = this.parseMarkdownSkills(content)
          skills.push(...extractedSkills)
        } catch (error) {
          // Ignore files that can't be read
        }
      }
    } catch (error) {
      console.error("Error extracting skills from markdown files:", error)
    }

    return skills
  }

  /**
   * Parse styles from markdown content
   */
  private parseMarkdownStyles(content: string, fileName: string): CodeStyleRule[] {
    const rules: CodeStyleRule[] = []
    const lines = content.split('\n')

    for (const line of lines) {
      const trimmed = line.trim()
      
      // Look for patterns like "- Indentation: 2 spaces" or "**Indentation:** 2 spaces"
      const patterns = [
        /^-?\s*\*\*?([^:]+)\*\*?:\s*(.+)$/,
        /^-?\s*([^:]+):\s*(.+)$/
      ]

      for (const pattern of patterns) {
        const match = trimmed.match(pattern)
        if (match) {
          const [, category, value] = match
          const cleanCategory = category.trim()
          const cleanValue = value.trim()

          const rule: CodeStyleRule = {
            type: this.categorizeStyleType(cleanCategory),
            category: cleanCategory,
            value: cleanValue
          }

          rules.push(rule)
          break
        }
      }
    }

    return rules
  }

  /**
   * Parse skills from markdown content
   */
  private parseMarkdownSkills(content: string): CodingSkill[] {
    const skills: CodingSkill[] = []
    const lines = content.split('\n')
    
    let currentCategory = ""
    let currentSkills: string[] = []

    for (const line of lines) {
      const trimmed = line.trim()
      
      // Look for category headers
      if (trimmed.startsWith('#') || trimmed.startsWith('##')) {
        // Save previous category if exists
        if (currentCategory && currentSkills.length > 0) {
          skills.push({
            category: currentCategory,
            skills: [...currentSkills]
          })
        }
        
        // Start new category
        currentCategory = trimmed.replace(/^#+\s*/, '')
        currentSkills = []
      } else if (trimmed.startsWith('-') || trimmed.startsWith('*')) {
        // Add skill to current category
        const skill = trimmed.replace(/^[-*]\s*/, '')
        if (skill) {
          currentSkills.push(skill)
        }
      }
    }

    // Save last category
    if (currentCategory && currentSkills.length > 0) {
      skills.push({
        category: currentCategory,
        skills: [...currentSkills]
      })
    }

    return skills
  }

  /**
   * Categorize style rules by type
   */
  private categorizeStyleType(category: string): CodeStyleRule["type"] {
    const lowerCategory = category.toLowerCase()
    
    if (lowerCategory.includes('indent')) return 'indentation'
    if (lowerCategory.includes('name') || lowerCategory.includes('naming')) return 'naming'
    if (lowerCategory.includes('format') || lowerCategory.includes('style')) return 'formatting'
    if (lowerCategory.includes('doc') || lowerCategory.includes('comment')) return 'documentation'
    if (lowerCategory.includes('test')) return 'testing'
    if (lowerCategory.includes('library') || lowerCategory.includes('framework')) return 'library'
    
    return 'architecture'
  }

  /**
   * Detect libraries from package.json dependencies
   */
  private detectLibraries(dependencies: Record<string, string>): string[] {
    const libraries: string[] = []
    
    const libraryPatterns: Record<string, string[]> = {
      'React': ['react', 'react-dom'],
      'Vue': ['vue', '@vue'],
      'Angular': ['@angular'],
      'TypeScript': ['typescript'],
      'ESLint': ['eslint'],
      'Prettier': ['prettier'],
      'Jest': ['jest'],
      'Vitest': ['vitest'],
      'Webpack': ['webpack'],
      'Vite': ['vite'],
      'Next.js': ['next'],
      'Nuxt': ['nuxt'],
    }

    for (const [libraryName, patterns] of Object.entries(libraryPatterns)) {
      if (patterns.some(pattern => dependencies[pattern])) {
        libraries.push(libraryName)
      }
    }

    return libraries
  }

  /**
   * Get language-specific skills
   */
  private getLanguageSkill(ext: string, fileCount: number): CodingSkill | null {
    const languageMap: Record<string, { name: string, skills: string[] }> = {
      '.ts': { name: 'TypeScript', skills: ['Type safety', 'Interface design', 'Generic programming'] },
      '.js': { name: 'JavaScript', skills: ['ES6+ features', 'Async/await', 'Functional programming'] },
      '.tsx': { name: 'React/TypeScript', skills: ['React hooks', 'TypeScript integration', 'Component composition'] },
      '.jsx': { name: 'React/JavaScript', skills: ['React hooks', 'JSX syntax', 'Component architecture'] },
      '.py': { name: 'Python', skills: ['Object-oriented programming', 'Data structures', 'Web frameworks'] },
      '.java': { name: 'Java', skills: ['Object-oriented design', 'Spring framework', 'Enterprise patterns'] },
      '.cs': { name: 'C#', skills: ['.NET development', 'LINQ', 'Async programming'] },
      '.go': { name: 'Go', skills: ['Concurrency', 'Microservices', 'Performance optimization'] },
      '.rs': { name: 'Rust', skills: ['Memory safety', 'Performance', 'Systems programming'] },
      '.md': { name: 'Markdown', skills: ['Documentation structure', 'Technical writing', 'Markdown syntax'] },
    }

    const langInfo = languageMap[ext]
    if (!langInfo) return null

    return {
      category: `${langInfo.name} Development`,
      skills: langInfo.skills,
      examples: [`${fileCount} ${ext.slice(1).toUpperCase()} files detected`]
    }
  }

  /**
   * Check if any file matches a pattern
   */
  private async hasFileMatching(pattern: string, content: string): Promise<boolean> {
    try {
      const files = await glob(pattern, { 
        cwd: this.workspaceRoot,
        ignore: ["**/node_modules/**", "**/dist/**", "**/build/**"]
      })

      for (const file of files) {
        const filePath = path.join(this.workspaceRoot, file)
        try {
          const content_ = await fs.readFile(filePath, 'utf8')
          if (content_.toLowerCase().includes(content.toLowerCase())) {
            return true
          }
        } catch {
          // Skip files that can't be read
        }
      }
    } catch {
      // Pattern doesn't match any files
    }

    return false
  }

  /**
   * Check if directory pattern exists
   */
  private async checkDirectoryExists(pattern: string): Promise<boolean> {
    try {
      const matches = await glob(pattern, { cwd: this.workspaceRoot })
      return matches.length > 0
    } catch {
      return false
    }
  }

  /**
   * Add missing skills to the skills.md file
   */
  async addMissingSkills(newSkills: CodingSkill[]): Promise<void> {
    const skillsFilePath = path.join(this.workspaceRoot, ".kilocode", "rules", "skills.md")

    try {
      const content = await fs.readFile(skillsFilePath, "utf8")
      const existingSkills = this.parseMarkdownSkills(content)

      const missingSkills = newSkills.filter(newSkill => 
        !existingSkills.some(existingSkill => existingSkill.category === newSkill.category)
      )

      if (missingSkills.length > 0) {
        let contentToAppend = "\n"
        for (const skill of missingSkills) {
          contentToAppend += `## ${skill.category}\n`
          for (const s of skill.skills) {
            contentToAppend += `- ${s}\n`
          }
        }
        await fs.appendFile(skillsFilePath, contentToAppend)
      }
    } catch (error) {
      // skills.md doesn't exist or couldn't be read
    }
  }
}