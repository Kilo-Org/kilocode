#!/usr/bin/env node

/**
 * Apply patch for @vscode/policy-watcher to fix macOS compilation issues.
 * This script patches the PreferencesPolicy.hh file to include <optional> header.
 * 
 * The patch file is located at deps/patches/policy-watcher/macos-optional-fix.patch
 * This follows the same pattern as deps/patches/vscode/jetbrains.patch
 * 
 * Usage:
 *   node scripts/apply-policy-watcher-patch.js                    # Patch root node_modules
 *   node scripts/apply-policy-watcher-patch.js --target <dir>    # Patch specific directory
 * 
 * For pnpm, we need to patch files in the .pnpm store directly.
 * For regular npm installs (like in jetbrains/resources), we patch the direct node_modules structure.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PATCH_FILE = path.join(__dirname, '../deps/patches/policy-watcher/macos-optional-fix.patch');
const OPTIONAL_INCLUDE = '#include <optional>';

function findPolicyWatcherFiles(targetDir) {
  const baseDir = targetDir || path.join(__dirname, '..');
  const nodeModulesPath = path.join(baseDir, 'node_modules');
  
  const files = [];
  
  // Check if it's a pnpm structure (.pnpm store)
  const pnpmStorePath = path.join(nodeModulesPath, '.pnpm');
  if (fs.existsSync(pnpmStorePath)) {
    // Find all PreferencesPolicy.hh files in @vscode+policy-watcher@1.3.2 directories
    function searchDir(dir) {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name.includes('@vscode+policy-watcher@1.3.2')) {
              const policyFile = path.join(fullPath, 'node_modules/@vscode/policy-watcher/src/macos/PreferencesPolicy.hh');
              if (fs.existsSync(policyFile)) {
                files.push(policyFile);
              }
            } else {
              searchDir(fullPath);
            }
          }
        }
      } catch (err) {
        // Ignore permission errors
      }
    }
    searchDir(pnpmStorePath);
  }
  
  // Also check for regular npm/node_modules structure (for jetbrains/resources)
  const directPath = path.join(nodeModulesPath, '@vscode/policy-watcher/src/macos/PreferencesPolicy.hh');
  if (fs.existsSync(directPath)) {
    files.push(directPath);
  }
  
  return files;
}

function applyPatch(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Check if patch is already applied
    if (content.includes(OPTIONAL_INCLUDE)) {
      return false; // Already patched
    }
    
    // Check if std::optional is used (which requires the include)
    if (!content.includes('std::optional')) {
      return false; // No need to patch if optional is not used
    }
    
    // Find the insertion point (after CoreFoundation include, before Policy.hh)
    const lines = content.split('\n');
    let insertIndex = -1;
    
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('#include <CoreFoundation/CoreFoundation.h>')) {
        insertIndex = i + 1;
        // Skip empty lines
        while (insertIndex < lines.length && lines[insertIndex].trim() === '') {
          insertIndex++;
        }
        break;
      }
    }
    
    if (insertIndex === -1) {
      console.warn(`Could not find insertion point in ${filePath}`);
      return false;
    }
    
    // Insert the optional include
    lines.splice(insertIndex, 0, OPTIONAL_INCLUDE);
    const newContent = lines.join('\n');
    
    fs.writeFileSync(filePath, newContent, 'utf8');
    console.log(`✓ Patched ${filePath}`);
    return true;
  } catch (err) {
    console.error(`Error patching ${filePath}:`, err.message);
    return false;
  }
}

function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  let targetDir = null;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--target' && i + 1 < args.length) {
      targetDir = path.resolve(args[i + 1]);
      break;
    }
  }
  
  console.log('Applying @vscode/policy-watcher patch for macOS...');
  if (targetDir) {
    console.log(`Target directory: ${targetDir}`);
  }
  
  const files = findPolicyWatcherFiles(targetDir);
  
  if (files.length === 0) {
    console.warn('No @vscode/policy-watcher@1.3.2 files found to patch');
    return;
  }
  
  let patched = 0;
  for (const file of files) {
    if (applyPatch(file)) {
      patched++;
    }
  }
  
  if (patched > 0) {
    console.log(`✓ Successfully patched ${patched} file(s)`);
  } else {
    console.log('All files already patched or no changes needed');
  }
}

if (require.main === module) {
  main();
}

module.exports = { applyPatch, findPolicyWatcherFiles };
