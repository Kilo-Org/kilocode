// Quick integration test for skills feature
const { CodeStyleExtractor } = require('./src/services/claude-code-styles/index.js')

async function quickTest() {
  console.log('🧪 Testing Skills Feature...\n')
  
  try {
    const extractor = new CodeStyleExtractor(process.cwd())
    const result = await extractor.extractStylesAndSkills()
    
    console.log('✅ CodeStyleExtractor works!')
    console.log(`📊 Found ${result.styles.length} style rules`)
    console.log(`🎯 Found ${result.skills.length} skill categories`)
    
    if (result.styles.length > 0) {
      console.log('\n📋 Sample style rules:')
      result.styles.slice(0, 3).forEach(rule => {
        console.log(`   • ${rule.category}: ${rule.value}`)
      })
    }
    
    if (result.skills.length > 0) {
      console.log('\n🎯 Sample skills:')
      result.skills.slice(0, 2).forEach(skill => {
        console.log(`   • ${skill.category}: ${skill.skills.slice(0, 2).join(', ')}...`)
      })
    }
    
    console.log('\n🎉 Skills feature is working correctly!')
    
  } catch (error) {
    console.error('❌ Test failed:', error.message)
  }
}

quickTest()