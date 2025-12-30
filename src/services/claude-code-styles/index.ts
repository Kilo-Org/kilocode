// Export all types and classes from the claude-code-styles module
export * from './CodeStyleExtractor.js'
export * from './SkillsIntegrationService.js'

// Re-export types for convenience
export type {
  CodeStyleRule,
  CodingSkill,
  CodeStylesSkills,
} from './CodeStyleExtractor.js'

// Export the main classes
export { CodeStyleExtractor } from './CodeStyleExtractor.js'
export { SkillsIntegrationService } from './SkillsIntegrationService.js'