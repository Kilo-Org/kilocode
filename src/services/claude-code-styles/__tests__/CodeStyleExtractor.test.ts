import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { CodeStyleExtractor } from '../CodeStyleExtractor.js'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// Mock dependencies
vi.mock('glob')
vi.mock('node:fs/promises')

describe('CodeStyleExtractor', () => {
  let extractor: CodeStyleExtractor
  let tempDir: string
  let mockFs: typeof fs

  beforeEach(async () => {
    // Use a fake tempDir path since fs is mocked
    tempDir = '/mock-temp-dir'
    extractor = new CodeStyleExtractor(tempDir)
    mockFs = fs as any
  })

  afterEach(async () => {
    // No real cleanup needed since fs is mocked
  })

  describe('extractStylesAndSkills', () => {
    it('should extract styles and skills from project', async () => {
      // Mock package.json
      const packageJson = {
        name: 'test-project',
        eslintConfig: {
          extends: ['@typescript-eslint/recommended']
        },
        scripts: {
          test: 'jest',
          'test:unit': 'vitest'
        },
        dependencies: {
          react: '^18.0.0',
          typescript: '^5.0.0'
        },
        devDependencies: {
          jest: '^29.0.0',
          prettier: '^3.0.0'
        }
      }

      mockFs.readFile = vi.fn()
        .mockResolvedValueOnce(JSON.stringify(packageJson))
        .mockResolvedValueOnce(JSON.stringify({ compilerOptions: { strict: true } }))

      const result = await extractor.extractStylesAndSkills()

      expect(result).toHaveProperty('styles')
      expect(result).toHaveProperty('skills')
      expect(result).toHaveProperty('lastUpdated')
      expect(result.styles).toBeInstanceOf(Array)
      expect(result.skills).toBeInstanceOf(Array)
    })
  })

  describe('extractFromConfigFiles', () => {
    it('should detect ESLint configuration', async () => {
      const packageJson = {
        eslintConfig: {
          extends: ['@typescript-eslint/recommended']
        }
      }

      mockFs.readFile = vi.fn().mockResolvedValue(JSON.stringify(packageJson))

      const rules = await (extractor as any).extractFromConfigFiles()

      expect(rules).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'formatting',
            category: 'ESLint',
            value: 'ESLint configuration detected',
            description: 'Code linting and formatting rules'
          })
        ])
      )
    })

    it('should detect Prettier configuration', async () => {
      const packageJson = {
        prettier: {
          semi: false,
          singleQuote: true
        }
      }

      mockFs.readFile = vi.fn().mockResolvedValue(JSON.stringify(packageJson))

      const rules = await (extractor as any).extractFromConfigFiles()

      expect(rules).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'formatting',
            category: 'Prettier',
            value: 'Prettier configuration detected',
            description: 'Code formatting rules'
          })
        ])
      )
    })

    it('should detect testing scripts', async () => {
      const packageJson = {
        scripts: {
          test: 'jest',
          'test:unit': 'vitest',
          'test:integration': 'jest --config integration'
        }
      }

      mockFs.readFile = vi.fn().mockResolvedValue(JSON.stringify(packageJson))

      const rules = await (extractor as any).extractFromConfigFiles()

      expect(rules).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'testing',
            category: 'Testing',
            value: 'test, test:unit, test:integration',
            description: 'Test scripts detected'
          })
        ])
      )
    })

    it('should detect preferred libraries', async () => {
      const packageJson = {
        dependencies: {
          react: '^18.0.0',
          'react-dom': '^18.0.0'
        },
        devDependencies: {
          typescript: '^5.0.0',
          eslint: '^8.0.0'
        }
      }

      mockFs.readFile = vi.fn().mockResolvedValue(JSON.stringify(packageJson))

      const rules = await (extractor as any).extractFromConfigFiles()

      expect(rules).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'library',
            category: 'Preferred Libraries',
            value: expect.stringContaining('React'),
            description: 'Detected project dependencies'
          })
        ])
      )
    })
  })

  describe('extractFromCustomRules', () => {
    it('should extract styles from markdown files', async () => {
      const rulesDir = path.join(tempDir, '.kilocode', 'rules')
      await fs.mkdir(rulesDir, { recursive: true })

      const styleContent = `# Code Style Rules

## Formatting
- Indentation: 2 spaces
- Line length: 100 characters
- **Variable naming:** camelCase

## Documentation
- **Comments:** JSDoc format
- **File headers:** License information required`

      await fs.writeFile(path.join(rulesDir, 'codestyle.md'), styleContent)

      const result = await (extractor as any).extractFromCustomRules()

      expect(result.styles).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'formatting',
            category: 'Indentation',
            value: '2 spaces'
          }),
          expect.objectContaining({
            type: 'formatting',
            category: 'Line length',
            value: '100 characters'
          }),
          expect.objectContaining({
            type: 'naming',
            category: 'Variable naming',
            value: 'camelCase'
          })
        ])
      )
    })

    it('should extract skills from markdown files', async () => {
      const rulesDir = path.join(tempDir, '.kilocode', 'rules')
      await fs.mkdir(rulesDir, { recursive: true })

      const skillsContent = `# Skills

## Frontend Development
- React component architecture
- State management with Redux
- TypeScript integration

## Backend Development
- RESTful API design
- Database modeling
- Authentication systems`

      await fs.writeFile(path.join(rulesDir, 'skills.md'), skillsContent)

      const result = await (extractor as any).extractFromCustomRules()

      expect(result.skills).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            category: 'Frontend Development',
            skills: [
              'React component architecture',
              'State management with Redux',
              'TypeScript integration'
            ]
          }),
          expect.objectContaining({
            category: 'Backend Development',
            skills: [
              'RESTful API design',
              'Database modeling',
              'Authentication systems'
            ]
          })
        ])
      )
    })

    it('should handle missing .kilocode/rules directory', async () => {
      const result = await (extractor as any).extractFromCustomRules()

      expect(result.styles).toEqual([])
      expect(result.skills).toEqual([])
    })
  })

  describe('analyzeProjectStructure', () => {
    it('should detect language skills', async () => {
      const globMock = vi.mocked(await import('glob')).glob
      globMock.mockResolvedValue([
        'src/index.ts',
        'src/utils.ts',
        'src/components/Button.tsx',
        'src/hooks/useAuth.ts'
      ])

      const result = await (extractor as any).analyzeProjectStructure()

      expect(result.skills).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            category: 'TypeScript Development',
            skills: expect.arrayContaining(['Type safety', 'Interface design', 'Generic programming'])
          })
        ])
      )
    })

    it('should detect testing skills', async () => {
      const globMock = vi.mocked(await import('glob')).glob
      globMock
        .mockResolvedValueOnce(['src/index.ts']) // source files
        .mockResolvedValueOnce(['src/__tests__/index.test.ts', 'src/utils.spec.ts']) // test files

      const result = await (extractor as any).analyzeProjectStructure()

      expect(result.skills).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            category: 'Testing',
            skills: expect.arrayContaining([
              'Test-driven development',
              'Unit testing',
              'Integration testing'
            ])
          })
        ])
      )
    })

    it('should detect documentation skills', async () => {
      const globMock = vi.mocked(await import('glob')).glob
      globMock
        .mockResolvedValueOnce(['src/index.ts']) // source files
        .mockResolvedValueOnce([]) // test files
        .mockResolvedValueOnce(['README.md', 'docs/api.md', 'CONTRIBUTING.md']) // doc files

      const result = await (extractor as any).analyzeProjectStructure()

      expect(result.skills).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            category: 'Documentation',
            skills: expect.arrayContaining([
              'Technical documentation',
              'API documentation',
              'Code comments'
            ])
          })
        ])
      )
    })

    it('should detect frontend framework skills', async () => {
      const globMock = vi.mocked(await import('glob')).glob
      globMock
        .mockResolvedValueOnce(['src/index.tsx']) // source files
        .mockResolvedValueOnce([]) // test files
        .mockResolvedValueOnce([]) // doc files

      const hasFileMatchingMock = (extractor as any).hasFileMatching
      hasFileMatchingMock.mockResolvedValue(true)

      const result = await (extractor as any).analyzeProjectStructure()

      expect(result.skills).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            category: 'Frontend Framework',
            skills: expect.arrayContaining([
              'React development',
              'Component-based architecture',
              'State management'
            ])
          })
        ])
      )
    })
  })

  describe('parseMarkdownStyles', () => {
    it('should parse various style patterns', async () => {
      const content = `# Code Styles

## Formatting
- Indentation: 2 spaces
- **Line length:** 120 characters
- Braces: Same line

## Naming
**Variables:** camelCase
**Constants:** UPPER_SNAKE_CASE

## Documentation
- Comments: JSDoc format
- **File headers:** Required`

      const rules = await (extractor as any).parseMarkdownStyles(content, 'codestyle.md')

      expect(rules).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'indentation',
            category: 'Indentation',
            value: '2 spaces'
          }),
          expect.objectContaining({
            type: 'formatting',
            category: 'Line length',
            value: '120 characters'
          }),
          expect.objectContaining({
            type: 'naming',
            category: 'Variables',
            value: 'camelCase'
          }),
          expect.objectContaining({
            type: 'documentation',
            category: 'Comments',
            value: 'JSDoc format'
          })
        ])
      )
    })
  })

  describe('parseMarkdownSkills', () => {
    it('should parse skills from markdown', async () => {
      const content = `# Skills

## Frontend Development
- React hooks
- Component composition
- TypeScript integration

## Backend Development
- RESTful APIs
- Database design
- Authentication

## Testing
- Unit testing
- Integration testing
- E2E testing`

      const skills = await (extractor as any).parseMarkdownSkills(content)

      expect(skills).toEqual([
        expect.objectContaining({
          category: 'Frontend Development',
          skills: [
            'React hooks',
            'Component composition',
            'TypeScript integration'
          ]
        }),
        expect.objectContaining({
          category: 'Backend Development',
          skills: [
            'RESTful APIs',
            'Database design',
            'Authentication'
          ]
        }),
        expect.objectContaining({
          category: 'Testing',
          skills: [
            'Unit testing',
            'Integration testing',
            'E2E testing'
          ]
        })
      ])
    })
  })

  describe('categorizeStyleType', () => {
    it('should categorize style types correctly', async () => {
      const categorize = (extractor as any).categorizeStyleType

      expect(categorize('Indentation')).toBe('indentation')
      expect(categorize('Variable naming')).toBe('naming')
      expect(categorize('Code formatting')).toBe('formatting')
      expect(categorize('Documentation style')).toBe('documentation')
      expect(categorize('Testing patterns')).toBe('testing')
      expect(categorize('Preferred libraries')).toBe('library')
      expect(categorize('Architecture patterns')).toBe('architecture')
    })
  })

  describe('detectLibraries', () => {
    it('should detect various libraries from dependencies', async () => {
      const detectLibraries = (extractor as any).detectLibraries

      const dependencies = {
        react: '^18.0.0',
        '@angular/core': '^15.0.0',
        typescript: '^5.0.0',
        jest: '^29.0.0',
        webpack: '^5.0.0',
        next: '^13.0.0'
      }

      const libraries = detectLibraries(dependencies)

      expect(libraries).toEqual(
        expect.arrayContaining([
          'React',
          'Angular',
          'TypeScript',
          'Jest',
          'Webpack',
          'Next.js'
        ])
      )
    })
  })

  describe('getLanguageSkill', () => {
    it('should return language-specific skills', async () => {
      const getLanguageSkill = (extractor as any).getLanguageSkill

      const skill = getLanguageSkill('.ts', 10)

      expect(skill).toEqual({
        category: 'TypeScript Development',
        skills: [
          'Type safety',
          'Interface design',
          'Generic programming'
        ],
        examples: ['10 TS files detected']
      })
    })

    it('should return null for unknown extensions', async () => {
      const getLanguageSkill = (extractor as any).getLanguageSkill

      const skill = getLanguageSkill('.xyz', 5)

      expect(skill).toBeNull()
    })
  })
})