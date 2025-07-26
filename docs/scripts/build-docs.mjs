#!/usr/bin/env node

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname, relative, extname } from 'path';
import { glob } from 'glob';
import { remark } from 'remark';
import remarkHtml from 'remark-html';
import remarkGfm from 'remark-gfm';
import matter from 'gray-matter';

const DOCS_DIR = process.cwd();
const BUILD_DIR = join(DOCS_DIR, 'dist');

/**
 * Build documentation by processing markdown files
 */
async function buildDocs() {
  console.log('🔨 Building documentation...');
  
  try {
    // Find all markdown files
    const markdownFiles = await glob('**/*.md', {
      cwd: DOCS_DIR,
      ignore: ['node_modules/**', 'dist/**', 'scripts/**']
    });

    console.log(`📄 Found ${markdownFiles.length} markdown files`);

    // Process each markdown file
    for (const file of markdownFiles) {
      await processMarkdownFile(file);
    }

    // Generate navigation structure
    await generateNavigation(markdownFiles);

    console.log('✅ Documentation build complete!');
  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  }
}

/**
 * Process a single markdown file
 */
async function processMarkdownFile(filePath) {
  const fullPath = join(DOCS_DIR, filePath);
  const content = await readFile(fullPath, 'utf-8');
  
  // Parse frontmatter
  const { data: frontmatter, content: markdown } = matter(content);
  
  // Process markdown with remark
  const processor = remark()
    .use(remarkGfm)
    .use(remarkHtml, { sanitize: false });
    
  const result = await processor.process(markdown);
  const html = result.toString();
  
  // Generate output path
  const outputPath = join(BUILD_DIR, filePath.replace('.md', '.html'));
  await mkdir(dirname(outputPath), { recursive: true });
  
  // Create HTML page with template
  const htmlPage = createHtmlPage({
    title: frontmatter.title || getPageTitle(markdown),
    content: html,
    filePath,
    frontmatter
  });
  
  await writeFile(outputPath, htmlPage);
  console.log(`  ✓ ${filePath} → ${relative(DOCS_DIR, outputPath)}`);
}

/**
 * Extract page title from markdown content
 */
function getPageTitle(markdown) {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1] : 'Documentation';
}

/**
 * Create HTML page with basic template
 */
function createHtmlPage({ title, content, filePath, frontmatter }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Kilo Code Documentation</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
      color: #333;
    }
    pre {
      background: #f5f5f5;
      padding: 15px;
      border-radius: 5px;
      overflow-x: auto;
    }
    code {
      background: #f5f5f5;
      padding: 2px 4px;
      border-radius: 3px;
    }
    pre code {
      background: none;
      padding: 0;
    }
    blockquote {
      border-left: 4px solid #ddd;
      margin: 0;
      padding-left: 20px;
      color: #666;
    }
    table {
      border-collapse: collapse;
      width: 100%;
    }
    th, td {
      border: 1px solid #ddd;
      padding: 8px;
      text-align: left;
    }
    th {
      background-color: #f5f5f5;
    }
  </style>
</head>
<body>
  <nav>
    <a href="../README.html">← Back to Documentation Home</a>
  </nav>
  <main>
    ${content}
  </main>
  <footer>
    <hr>
    <p><small>Generated from <code>${filePath}</code></small></p>
  </footer>
</body>
</html>`;
}

/**
 * Generate navigation structure
 */
async function generateNavigation(files) {
  const navigation = {
    sections: {},
    files: []
  };
  
  for (const file of files) {
    const parts = file.split('/');
    let current = navigation.sections;
    
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!current[part]) {
        current[part] = { sections: {}, files: [] };
      }
      current = current[part].sections;
    }
    
    const section = parts.slice(0, -1).join('/');
    if (section) {
      if (!navigation.sections[section]) {
        navigation.sections[section] = { sections: {}, files: [] };
      }
      navigation.sections[section].files.push(file);
    } else {
      navigation.files.push(file);
    }
  }
  
  const navPath = join(BUILD_DIR, 'navigation.json');
  await mkdir(dirname(navPath), { recursive: true });
  await writeFile(navPath, JSON.stringify(navigation, null, 2));
  console.log('  ✓ Generated navigation.json');
}

// Run the build
buildDocs();