#!/usr/bin/env node

import { watch } from 'chokidar';
import { spawn } from 'child_process';
import { join } from 'path';

const DOCS_DIR = process.cwd();

/**
 * Development server for documentation
 */
async function startDevServer() {
  console.log('🚀 Starting documentation development server...');
  
  // Initial build
  await runBuild();
  
  // Watch for changes
  const watcher = watch('**/*.md', {
    cwd: DOCS_DIR,
    ignored: ['node_modules/**', 'dist/**', 'scripts/**'],
    persistent: true
  });
  
  watcher.on('change', async (path) => {
    console.log(`📝 File changed: ${path}`);
    await runBuild();
  });
  
  watcher.on('add', async (path) => {
    console.log(`➕ File added: ${path}`);
    await runBuild();
  });
  
  watcher.on('unlink', async (path) => {
    console.log(`🗑️  File removed: ${path}`);
    await runBuild();
  });
  
  console.log('👀 Watching for changes... (Press Ctrl+C to stop)');
  
  // Keep the process running
  process.on('SIGINT', () => {
    console.log('\\n🛑 Stopping development server...');
    watcher.close();
    process.exit(0);
  });
}

/**
 * Run the documentation build
 */
async function runBuild() {
  return new Promise((resolve, reject) => {
    const buildProcess = spawn('node', ['scripts/build-docs.mjs'], {
      cwd: DOCS_DIR,
      stdio: 'inherit'
    });
    
    buildProcess.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Build failed with code ${code}`));
      }
    });
  });
}

// Start the dev server
startDevServer().catch(error => {
  console.error('❌ Dev server failed:', error);
  process.exit(1);
});