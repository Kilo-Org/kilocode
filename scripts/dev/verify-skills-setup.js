#!/usr/bin/env node

/**
 * Quick verification script for skills feature setup
 * Run this to check if all files are in place before testing
 */

const fs = require('fs')
const path = require('path')

console.log('🔍 Verifying Skills Feature Setup...\n')

const requiredFiles = [
  'src/services/claude-code-styles/CodeStyleExtractor.ts',
  'src/services/claude-code-styles/SkillsIntegrationService.ts',
  'src/services/claude-code-styles/index.ts',
  'src/services/claude-code-styles/README.md',
  'src/services/claude-code-styles/TESTING_GUIDE.md',
  'src/services/claude-code-styles/__tests__/CodeStyleExtractor.test.ts',
  '.kilocode/rules/codestyle.md',
  '.kilocode/rules/skills.md'
]

let allFilesExist = true

  const filePath = path.join(__dirname, '../../', file)
  const filePath = path.join(__dirname, file)
  if (fs.existsSync(filePath)) {
    console.log(`✅ ${file}`)
  } else {
    console.log(`❌ ${file} - MISSING`)
    allFilesExist = false
  }
})

console.log('\n' + '='.repeat(50))

if (allFilesExist) {
  console.log('🎉 All required files are present!')
  console.log('\nNext steps:')
  console.log('1. cd kilocode')
  console.log('2. pnpm install')
  console.log('3. pnpm run build')
  console.log('4. Press F5 in VSCode to start extension development')
  console.log('\n📖 See TESTING_GUIDE.md for detailed testing instructions')
} else {
  console.log('❌ Some files are missing. Please check the setup.')
  process.exit(1)
}
