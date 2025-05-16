#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m'
};

console.log(`${colors.bright}${colors.cyan}Building Continue Wrapper...${colors.reset}`);

try {
  // Ensure dist directory exists
  const distDir = path.join(__dirname, 'dist');
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  // Run TypeScript compiler
  console.log(`${colors.yellow}Running TypeScript compiler...${colors.reset}`);
  execSync('npx tsc -p ./tsconfig.npm.json', { stdio: 'inherit' });

  // Copy package.json to dist
  console.log(`${colors.yellow}Copying package.json to dist...${colors.reset}`);
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  
  // Modify package.json for distribution
  packageJson.main = 'index.js';
  packageJson.types = 'index.d.ts';
  
  fs.writeFileSync(
    path.join(distDir, 'package.json'),
    JSON.stringify(packageJson, null, 2)
  );

  console.log(`${colors.green}${colors.bright}Continue Wrapper built successfully!${colors.reset}`);
} catch (error) {
  console.error(`${colors.red}${colors.bright}Build failed:${colors.reset}`, error);
  process.exit(1);
}