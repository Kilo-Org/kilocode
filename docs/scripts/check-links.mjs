#!/usr/bin/env node

import { readFile } from 'fs/promises';
import { join } from 'path';
import { glob } from 'glob';

const DOCS_DIR = process.cwd();

/**
 * Check all links in documentation
 */
async function checkLinks() {
  console.log('🔗 Checking documentation links...');
  
  let hasErrors = false;
  
  try {
    // Find all markdown files
    const markdownFiles = await glob('**/*.md', {
      cwd: DOCS_DIR,
      ignore: ['node_modules/**', 'dist/**', 'scripts/**']
    });

    console.log(`📄 Checking links in ${markdownFiles.length} files`);

    // Check links in each file
    for (const file of markdownFiles) {
      const errors = await checkFileLinks(file);
      if (errors.length > 0) {
        hasErrors = true;
        console.error(`❌ ${file}:`);
        errors.forEach(error => console.error(`  - ${error}`));
      } else {
        console.log(`  ✓ ${file}`);
      }
    }

    if (hasErrors) {
      console.error('❌ Link check failed with errors');
      process.exit(1);
    } else {
      console.log('✅ All links are valid!');
    }
  } catch (error) {
    console.error('❌ Link check failed:', error);
    process.exit(1);
  }
}

/**
 * Check links in a single file
 */
async function checkFileLinks(filePath) {
  const errors = [];
  const fullPath = join(DOCS_DIR, filePath);
  
  try {
    const content = await readFile(fullPath, 'utf-8');
    const links = extractAllLinks(content);
    
    for (const link of links) {
      if (link.startsWith('http')) {
        // External link - we'll skip HTTP checks for now to avoid network dependencies
        continue;
      } else if (link.startsWith('mailto:')) {
        // Email link - basic validation
        if (!isValidEmail(link.substring(7))) {
          errors.push(`Invalid email link: ${link}`);
        }
      } else {
        // Internal link
        if (!(await internalLinkExists(link, filePath))) {
          errors.push(`Broken internal link: ${link}`);
        }
      }
    }
    
  } catch (error) {
    errors.push(`Failed to read file: ${error.message}`);
  }
  
  return errors;
}

/**
 * Extract all links from markdown content
 */
function extractAllLinks(content) {
  const links = [];
  
  // Markdown links: [text](url)
  const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match;
  while ((match = markdownLinkRegex.exec(content)) !== null) {
    links.push(match[2]);
  }
  
  // Reference links: [text][ref] and [ref]: url
  const refLinkRegex = /^\s*\[([^\]]+)\]:\s*(.+)$/gm;
  while ((match = refLinkRegex.exec(content)) !== null) {
    links.push(match[2].trim());
  }
  
  return links;
}

/**
 * Check if internal link exists
 */
async function internalLinkExists(link, currentFile) {
  // Remove anchor fragments
  const [filePart, anchor] = link.split('#');
  if (!filePart) return true; // Anchor-only links are valid for current file
  
  // Resolve relative to current file
  const currentDir = currentFile.includes('/') ? 
    currentFile.substring(0, currentFile.lastIndexOf('/')) : '';
  
  let targetPath;
  if (filePart.startsWith('./')) {
    targetPath = join(currentDir, filePart.substring(2));
  } else if (filePart.startsWith('../')) {
    targetPath = join(currentDir, filePart);
  } else if (filePart.startsWith('/')) {
    targetPath = filePart.substring(1);
  } else {
    targetPath = join(currentDir, filePart);
  }
  
  // Normalize path separators
  targetPath = targetPath.replace(/\\\\/g, '/');
  
  // Check if file exists
  try {
    const fullPath = join(DOCS_DIR, targetPath);
    await readFile(fullPath);
    
    // If there's an anchor, we could check if it exists in the target file
    // For now, we'll just verify the file exists
    return true;
  } catch {
    return false;
  }
}

/**
 * Basic email validation
 */
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Run link check
checkLinks();