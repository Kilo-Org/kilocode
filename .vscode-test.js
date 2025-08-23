const { defineConfig } = require('@vscode/test-cli');

module.exports = defineConfig({
    files: 'dist/e2e-tests/**/*.test.js'
});
