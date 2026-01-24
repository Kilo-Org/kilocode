#!/usr/bin/env node

/**
 * Translation Script for Kilo Code Documentation
 * 
 * This script translates English documentation files to Simplified Chinese (zh-CN)
 * using the Anthropic Claude API. It follows the translation guidelines from
 * .kilocode/skills/translation/SKILL.md
 * 
 * Usage: ANTHROPIC_API_KEY=your_key node scripts/translate-docs.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// Configuration
const DOCS_DIR = path.join(__dirname, '..', 'docs');
const ZH_CN_DIR = path.join(__dirname, '..', 'i18n', 'zh-CN', 'docusaurus-plugin-content-docs', 'current');
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-3-5-sonnet-20241022';
const RATE_LIMIT_DELAY = 1000; // 1 second between API calls

// Files to translate (relative to docs/)
const FILES_TO_TRANSLATE = [
  'advanced-usage/agent-manager.md',
  'advanced-usage/appbuilder.md',
  'advanced-usage/auto-cleanup.md',
  'advanced-usage/cloud-agent.md',
  'advanced-usage/code-reviews.md',
  'advanced-usage/deploy.md',
  'advanced-usage/integrations.md',
  'advanced-usage/managed-indexing.md',
  'advanced-usage/migrating-from-cursor-windsurf.md',
  'advanced-usage/sessions.md',
  'agent-behavior/agents-md.md',
  'agent-behavior/custom-instructions.md',
  'agent-behavior/custom-modes.md',
  'agent-behavior/custom-rules.md',
  'agent-behavior/prompt-engineering.md',
  'agent-behavior/skills.md',
  'agent-behavior/workflows.mdx',
  'basic-usage/adding-credits.md',
  'basic-usage/byok.md',
  'basic-usage/settings-management.md',
  'cli.md',
  'contributing/architecture/annual-billing.md',
  'contributing/architecture/enterprise-mcp-controls.md',
  'contributing/architecture/feature-template.md',
  'contributing/architecture/index.md',
  'contributing/architecture/mcp-oauth-authorization.md',
  'contributing/architecture/model-o11y.md',
  'contributing/architecture/onboarding-engagement-improvements.md',
  'contributing/architecture/organization-modes-library.md',
  'contributing/architecture/security-reviews.md',
  'contributing/architecture/track-repo-url.md',
  'contributing/architecture/vercel-ai-gateway.md',
  'contributing/architecture/voice-transcription.md',
  'contributing/development-environment.md',
  'contributing/index.md',
  'features/auto-launch-configuration.md',
  'features/experimental/native-function-calling.md',
  'features/experimental/voice-transcription.md',
  'features/mcp/using-mcp-in-cli.md',
  'features/tools/delete-file.md',
  'jetbrains-troubleshooting.md',
  'plans/about.md',
  'plans/adoption-dashboard/for-team-leads.md',
  'plans/adoption-dashboard/improving-your-score.md',
  'plans/adoption-dashboard/overview.md',
  'plans/adoption-dashboard/understanding-your-score.md',
  'plans/analytics.md',
  'plans/billing.md',
  'plans/custom-modes.md',
  'plans/dashboard.md',
  'plans/enterprise/audit-logs.md',
  'plans/enterprise/model-access.md',
  'plans/enterprise/SSO.md',
  'plans/getting-started.md',
  'plans/migration.md',
  'plans/team-management.md',
  'providers/cerebras.md',
  'providers/inception.md',
  'providers/minimax.md',
  'providers/moonshot.md',
  'providers/openai-chatgpt-plus-pro.md',
  'providers/sap-ai-core.md',
  'providers/synthetic.md',
  'providers/vercel-ai-gateway.md',
  'slack.md'
];

// Translation system prompt based on SKILL.md guidelines
const TRANSLATION_SYSTEM_PROMPT = `You are a professional translator specializing in technical documentation translation from English to Simplified Chinese (zh-CN).

Follow these critical guidelines:

## Key Terminology Rules:
- Keep technical terms in English: API, Token, Prompt, MCP, CLI, etc.
- Use "API 费用" not "API 成本" for API Cost
- Use "Token" not "令牌" or "代币"
- Use "缓存" not "高速缓存" for Cache
- Use "上下文" for Context
- Use "右键菜单" not "上下文菜单" for Context Menu
- Use "自动批准" not "始终批准" for Auto-approve
- Use "存档点" not "检查点" or "快照" for Checkpoint
- Use "MCP 服务" not "MCP 服务器" for MCP Server
- Use "终端" not "命令行" for Terminal
- Use "差异更新" not "差分" or "补丁" for diff
- Use "提示词缓存" for prompt caching
- Use "计算机交互" not "计算机使用" for computer use

## Formatting Rules:
1. Add spaces between Chinese and English/numbers: "API 费用" not "API费用"
2. Use Chinese full-width punctuation
3. Keep all markdown formatting, frontmatter, code blocks, and links exactly as they are
4. Preserve all variable placeholders like {{variable}} exactly
5. Keep code examples and command-line instructions unchanged
6. Preserve all URLs and file paths

## Style Guidelines:
- Use informal tone (direct address)
- Use concise, clear language
- Use active voice
- Break long sentences into shorter ones
- Keep button text to 2-4 Chinese characters when possible
- Use "点击" for Click, "输入" for Type, "滚动" for Scroll

## Quality Requirements:
- Maintain consistent terminology throughout
- Preserve the original meaning precisely
- Keep technical accuracy
- Ensure natural-sounding Chinese
- Adapt culturally appropriate expressions

Your task is to translate the provided English documentation to Simplified Chinese following these guidelines exactly. Return ONLY the translated content without any additional commentary or explanation.`;

/**
 * Ensure directory exists, creating it if necessary
 */
function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Make an API call to Anthropic Claude
 * 
 * @param {string} content - The content to translate
 * @returns {Promise<string>} - The translated content
 */
function callAnthropicAPI(content) {
  return new Promise((resolve, reject) => {
    const requestBody = JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
      system: TRANSLATION_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Translate the following English documentation to Simplified Chinese (zh-CN):\n\n${content}`
        }
      ]
    });

    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(requestBody)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const response = JSON.parse(data);
            if (response.content && response.content[0] && response.content[0].text) {
              resolve(response.content[0].text);
            } else {
              reject(new Error('Unexpected API response format'));
            }
          } catch (error) {
            reject(new Error(`Failed to parse API response: ${error.message}`));
          }
        } else {
          reject(new Error(`API request failed with status ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`API request error: ${error.message}`));
    });

    req.write(requestBody);
    req.end();
  });
}

/**
 * Translate content using Claude API
 * 
 * @param {string} content - The original English content
 * @returns {Promise<string>} - The translated content
 */
async function translateContent(content) {
  try {
    const translatedContent = await callAnthropicAPI(content);
    return translatedContent;
  } catch (error) {
    throw new Error(`Translation failed: ${error.message}`);
  }
}

/**
 * Sleep for specified milliseconds
 * 
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Translate a single documentation file
 * 
 * @param {string} relativePath - Path relative to docs/ directory
 * @param {number} index - Current file index
 * @param {number} total - Total number of files
 * @returns {Promise<boolean>} - Success status
 */
async function translateFile(relativePath, index, total) {
  const sourcePath = path.join(DOCS_DIR, relativePath);
  const targetPath = path.join(ZH_CN_DIR, relativePath);
  
  console.log(`\n[${index}/${total}] Translating: ${relativePath}`);
  
  // Check if source file exists
  if (!fs.existsSync(sourcePath)) {
    console.error(`  ❌ Source file not found: ${sourcePath}`);
    return false;
  }
  
  // Read the English content
  let content;
  try {
    content = fs.readFileSync(sourcePath, 'utf8');
  } catch (error) {
    console.error(`  ❌ Error reading file: ${error.message}`);
    return false;
  }
  
  // Translate the content
  console.log(`  🤖 Calling Claude API...`);
  let translatedContent;
  try {
    translatedContent = await translateContent(content);
  } catch (error) {
    console.error(`  ❌ Translation error: ${error.message}`);
    return false;
  }
  
  // Ensure target directory exists
  const targetDir = path.dirname(targetPath);
  ensureDirectoryExists(targetDir);
  
  // Write the translated file
  try {
    fs.writeFileSync(targetPath, translatedContent, 'utf8');
    console.log(`  ✅ Successfully translated and saved`);
    return true;
  } catch (error) {
    console.error(`  ❌ Error writing file: ${error.message}`);
    return false;
  }
}

/**
 * Main function to translate all files
 */
async function main() {
  // Check for API key
  if (!ANTHROPIC_API_KEY) {
    console.error('❌ Error: ANTHROPIC_API_KEY environment variable is not set');
    console.error('Usage: ANTHROPIC_API_KEY=your_key node scripts/translate-docs.js');
    process.exit(1);
  }
  
  console.log('🚀 Starting AI-powered documentation translation...\n');
  console.log(`Source directory: ${DOCS_DIR}`);
  console.log(`Target directory: ${ZH_CN_DIR}`);
  console.log(`Files to translate: ${FILES_TO_TRANSLATE.length}`);
  console.log(`Model: ${MODEL}`);
  console.log(`Rate limit: ${RATE_LIMIT_DELAY}ms between requests\n`);
  console.log('='.repeat(60));
  
  let successCount = 0;
  let failCount = 0;
  const failedFiles = [];
  
  // Translate each file
  for (let i = 0; i < FILES_TO_TRANSLATE.length; i++) {
    const file = FILES_TO_TRANSLATE[i];
    
    try {
      const success = await translateFile(file, i + 1, FILES_TO_TRANSLATE.length);
      
      if (success) {
        successCount++;
      } else {
        failCount++;
        failedFiles.push(file);
      }
      
      // Rate limiting: wait between API calls (except for the last file)
      if (i < FILES_TO_TRANSLATE.length - 1) {
        console.log(`  ⏳ Waiting ${RATE_LIMIT_DELAY}ms before next request...`);
        await sleep(RATE_LIMIT_DELAY);
      }
    } catch (error) {
      console.error(`  ❌ Unexpected error: ${error.message}`);
      failCount++;
      failedFiles.push(file);
    }
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 Translation Summary:');
  console.log(`✅ Successfully translated: ${successCount} files`);
  console.log(`❌ Failed: ${failCount} files`);
  console.log(`📝 Total: ${FILES_TO_TRANSLATE.length} files`);
  console.log('='.repeat(60));
  
  if (failCount > 0) {
    console.log('\n⚠️  Failed files:');
    failedFiles.forEach(file => console.log(`  - ${file}`));
    console.log('\n💡 Tip: You can re-run the script to retry failed translations.');
    process.exit(1);
  } else {
    console.log('\n✨ All files translated successfully!');
    console.log('🎉 Documentation is now available in Simplified Chinese (zh-CN)');
  }
}

// Run the script
if (require.main === module) {
  main().catch(error => {
    console.error('\n❌ Fatal error:', error.message);
    process.exit(1);
  });
}

module.exports = { translateFile, translateContent };
