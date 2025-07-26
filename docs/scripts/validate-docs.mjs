#!/usr/bin/env node

import { readFile } from 'fs/promises';
import { join } from 'path';
import { glob } from 'glob';
import matter from 'gray-matter';

const DOCS_DIR = process.cwd();

/**
 * Validate documentation files
 */
async function validateDocs() {
  console.log('🔍 Validating documentation...');
  
  let hasErrors = false;
  
  try {
    // Find all markdown files
    const markdownFiles = await glob('**/*.md', {
      cwd: DOCS_DIR,
      ignore: ['node_modules/**', 'dist/**', 'scripts/**']
    });

    console.log(`📄 Validating ${markdownFiles.length} files`);

    // Validate each file
    for (const file of markdownFiles) {
      const errors = await validateFile(file);
      if (errors.length > 0) {
        hasErrors = true;
        console.error(`❌ ${file}:`);
        errors.forEach(error => console.error(`  - ${error}`));
      } else {
        console.log(`  ✓ ${file}`);
      }
    }

    if (hasErrors) {
      console.error('❌ Validation failed with errors');
      process.exit(1);
    } else {
      console.log('✅ All documentation files are valid!');
    }
  } catch (error) {
    console.error('❌ Validation failed:', error);
    process.exit(1);
  }
}

/**
 * Validate a single markdown file
 */
async function validateFile(filePath) {
  const errors = [];
  const fullPath = join(DOCS_DIR, filePath);
  
  try {
    const content = await readFile(fullPath, 'utf-8');
    const { data: frontmatter, content: markdown } = matter(content);
    
    // Check for required title
    if (!hasTitle(markdown) && !frontmatter.title) {
      errors.push('Missing title (no # heading or frontmatter title)');
    }
    
    // Check for empty content
    if (markdown.trim().length === 0) {
      errors.push('File is empty');
    }
    
    // Check for broken internal links
    const internalLinks = extractInternalLinks(markdown);
    for (const link of internalLinks) {
      if (!(await linkExists(link, filePath))) {
        errors.push(`Broken internal link: ${link}`);
      }
    }
    
    // Check for TODO/FIXME comments
    const todos = extractTodos(markdown);
    if (todos.length > 0) {
      errors.push(`Contains TODO/FIXME comments: ${todos.join(', ')}`);
    }
    
  } catch (error) {
    errors.push(`Failed to read file: ${error.message}`);
  }
  
  return errors;
}

/**
 * Check if markdown has a title
 */
function hasTitle(markdown) {
  return /^#\s+.+$/m.test(markdown);
}

/**
 * Extract internal links from markdown
 */
function extractInternalLinks(markdown) {
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  const links = [];
  let match;
  
  while ((match = linkRegex.exec(markdown)) !== null) {
    const url = match[2];
    // Only check relative links (internal links)
    if (!url.startsWith('http') && !url.startsWith('mailto:')) {
      links.push(url);
    }
  }
  
  return links;
}

/**
 * Check if a link target exists
 */
async function linkExists(link, currentFile) {
  // Remove anchor fragments
  const cleanLink = link.split('#')[0];
  if (!cleanLink) return true; // Anchor-only links are valid
  
  // Resolve relative to current file
  const currentDir = currentFile.includes('/') ? 
    currentFile.substring(0, currentFile.lastIndexOf('/')) : '';
  
  let targetPath;
  if (cleanLink.startsWith('./')) {
    targetPath = join(currentDir, cleanLink.substring(2));
  } else if (cleanLink.startsWith('../')) {
    targetPath = join(currentDir, cleanLink);
  } else {
    targetPath = cleanLink;
  }
  
  // Check if file exists
  try {
    const fullPath = join(DOCS_DIR, targetPath);
    await readFile(fullPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract TODO/FIXME comments
 */
function extractTodos(markdown) {
  const todoRegex = /(?:TODO|FIXME|XXX)(?::|\\s)([^\\n]*)/gi;
  const todos = [];
  let match;
  
  while ((match = todoRegex.exec(markdown)) !== null) {
    todos.push(match[0].trim());
  }
  
  return todos;
}

// Run validation
validateDocs();