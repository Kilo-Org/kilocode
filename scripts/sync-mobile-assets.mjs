import fs from 'fs';
import path from 'path';

// This script runs from the 'kilo' directory root.
const projectRoot = process.cwd();

const sourcePath = path.join(
  projectRoot,
  '../VSCode-darwin-arm64/Code - OSS.app/Contents/Resources/app/extensions/kilocode.kilo-code/package.json'
);

const destDir = path.join(
  projectRoot,
  '../code-chief-mobile/code_chief_mobile/assets'
);
const destPath = path.join(destDir, 'kilo_package.json');

try {
  if (!fs.existsSync(sourcePath)) {
    console.error(`Error: Source file not found at ${sourcePath}`);
    process.exit(1);
  }

  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
    console.log(`Created destination directory: ${destDir}`);
  }

  fs.copyFileSync(sourcePath, destPath);
  console.log(`Successfully copied ${sourcePath} to ${destPath}`);
} catch (error) {
  console.error('Failed to sync mobile assets:', error);
  process.exit(1);
}
