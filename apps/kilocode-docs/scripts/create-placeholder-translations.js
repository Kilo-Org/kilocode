#!/usr/bin/env node

/**
 * Create placeholder Chinese translation files for all missing documentation
 * 
 * This script:
 * 1. Scans the English docs directory
 * 2. Identifies files missing in the Chinese translation directory
 * 3. Copies English files to Chinese directory with a translation header
 * 4. Preserves directory structure
 */

const fs = require('fs');
const path = require('path');

const DOCS_DIR = path.join(__dirname, '../docs');
const ZH_CN_DIR = path.join(__dirname, '../i18n/zh-CN/docusaurus-plugin-content-docs/current');

const TRANSLATION_HEADER = `---
# ⚠️ 此文档需要翻译 / This document needs translation
# 英文原文如下 / English original below
---

`;

/**
 * Get all files in a directory recursively
 */
function getAllFiles(dir, baseDir = dir) {
  const files = [];
  const items = fs.readdirSync(dir, { withFileTypes: true });

  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    const relativePath = path.relative(baseDir, fullPath);

    if (item.isDirectory()) {
      files.push(...getAllFiles(fullPath, baseDir));
    } else if (item.isFile() && (item.name.endsWith('.md') || item.name.endsWith('.mdx'))) {
      files.push(relativePath);
    }
  }

  return files;
}

/**
 * Check if a file exists
 */
function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch (err) {
    return false;
  }
}

/**
 * Ensure directory exists
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Create placeholder translation file
 */
function createPlaceholderFile(sourceFile, targetFile) {
  // Read the English source file
  const content = fs.readFileSync(sourceFile, 'utf8');
  
  // Add translation header
  const translatedContent = TRANSLATION_HEADER + content;
  
  // Ensure target directory exists
  const targetDir = path.dirname(targetFile);
  ensureDir(targetDir);
  
  // Write the placeholder file
  fs.writeFileSync(targetFile, translatedContent, 'utf8');
  
  console.log(`✓ Created: ${path.relative(ZH_CN_DIR, targetFile)}`);
}

/**
 * Main function
 */
function main() {
  console.log('🔍 Scanning for missing Chinese translations...\n');

  // Get all English documentation files
  const englishFiles = getAllFiles(DOCS_DIR);
  
  console.log(`Found ${englishFiles.length} English documentation files\n`);

  // Find missing translations
  const missingFiles = [];
  
  for (const relativeFile of englishFiles) {
    const zhFile = path.join(ZH_CN_DIR, relativeFile);
    
    if (!fileExists(zhFile)) {
      missingFiles.push(relativeFile);
    }
  }

  console.log(`Found ${missingFiles.length} missing Chinese translations\n`);

  if (missingFiles.length === 0) {
    console.log('✅ All files are already translated!');
    return;
  }

  console.log('📝 Creating placeholder files...\n');

  // Create placeholder files
  let created = 0;
  let failed = 0;

  for (const relativeFile of missingFiles) {
    const sourceFile = path.join(DOCS_DIR, relativeFile);
    const targetFile = path.join(ZH_CN_DIR, relativeFile);

    try {
      createPlaceholderFile(sourceFile, targetFile);
      created++;
    } catch (err) {
      console.error(`✗ Failed to create ${relativeFile}: ${err.message}`);
      failed++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`✅ Successfully created ${created} placeholder files`);
  if (failed > 0) {
    console.log(`❌ Failed to create ${failed} files`);
  }
  console.log('='.repeat(60));
  
  console.log('\n📋 Summary:');
  console.log(`   Total English files: ${englishFiles.length}`);
  console.log(`   Missing translations: ${missingFiles.length}`);
  console.log(`   Created placeholders: ${created}`);
  console.log(`   Failed: ${failed}`);
  
  console.log('\n💡 Next steps:');
  console.log('   1. Review the created placeholder files');
  console.log('   2. Translate the content from English to Chinese');
  console.log('   3. Remove the translation header once translated');
}

// Run the script
main();
