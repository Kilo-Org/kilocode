import esbuild from 'esbuild'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Plugin to resolve node modules from multiple locations
const nodeModulesPlugin = {
    name: 'node-modules',
    setup(build) {
        build.onResolve({ filter: /.*/ }, (args) => {
            // Skip if already resolved or is a relative/absolute path
            if (args.resolveDir === '' || args.path.startsWith('.') || args.path.startsWith('/')) {
                return
            }

            // Try to resolve from current package node_modules first
            const localPath = path.resolve(__dirname, 'node_modules', args.path)
            try {
                require.resolve(localPath)
                return { path: localPath }
            } catch { }

            // Try to resolve from workspace root node_modules
            const rootPath = path.resolve(__dirname, '../../node_modules', args.path)
            try {
                require.resolve(rootPath)
                return { path: rootPath }
            } catch { }

            // Let esbuild handle it normally
            return
        })
    },
}

const config = {
    entryPoints: ['src/cli/benchmark-cli.ts'],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    outfile: 'dist/benchmark-cli.cjs',
    external: [
        // Keep these as external dependencies
        'electron',
        'tiktoken', // Has WASM dependencies that can't be bundled
        'tree-sitter-wasms', // WASM files
        'web-tree-sitter', // WASM files
    ],
    alias: {
        // Map workspace dependencies to actual packages
        '@roo-code/telemetry': path.resolve(__dirname, '../telemetry/src'),
        '@roo-code/types': path.resolve(__dirname, '../types/src'),
        '@roo-code/ipc': path.resolve(__dirname, '../ipc/src'),
        '@roo-code/cloud': path.resolve(__dirname, '../cloud/src'),
        // Mock vscode module
        'vscode': path.resolve(__dirname, 'src/mocks/vscode.ts'),
    },
    plugins: [nodeModulesPlugin],
    define: {
        // Define globals that might be missing
        'process.env.NODE_ENV': '"production"',
    },
    loader: {
        '.hbs': 'text', // Load handlebars templates as text
    },
    resolveExtensions: ['.ts', '.js', '.json'],
    sourcemap: true,
    minify: false, // Keep readable for debugging
    logLevel: 'info',
    mainFields: ['module', 'main'],
    conditions: ['import', 'require', 'node'],
}

// Build function
async function build() {
    try {
        console.log('🔨 Building Ghost Benchmarks with esbuild...')
        await esbuild.build(config)
        console.log('✅ Build completed successfully!')
    } catch (error) {
        console.error('❌ Build failed:', error)
        process.exit(1)
    }
}

// Run build if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    build()
}

export { config, build }