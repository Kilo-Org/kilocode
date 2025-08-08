const esbuild = require('esbuild')
const path = require('path')
const fs = require('fs')

const config = {
    entryPoints: ['src/index.ts'],
    bundle: true,
    platform: 'node',
    target: 'node18',
    outfile: 'dist/index.js',
    external: [
        'fsevents',
        'node-pty',
    ],
    alias: {
        'vscode': '@kilo-code/vscode-mock/dist/vscode-api',
        '@vscode/ripgrep': '@kilo-code/vscode-mock/dist/mocks/ripgrep'
    },
    define: {
        'process.env.KILO_CLI': '"true"',
        'process.env.NODE_ENV': '"production"'
    },
    format: 'cjs',
    sourcemap: true,
    minify: false,
    keepNames: true,
    resolveExtensions: ['.ts', '.js', '.json', '.wasm'],
    loader: {
        '.json': 'json',
        '.wasm': 'binary'
    },
    plugins: [
        {
            name: 'wasm-loader',
            setup(build) {
                build.onLoad({ filter: /\.wasm$/ }, async (args) => {
                    const wasmPath = args.path
                    const wasmData = await fs.promises.readFile(wasmPath)
                    const wasmBase64 = wasmData.toString('base64')

                    const wasmFileName = path.basename(wasmPath)
                    const distWasmPath = path.join('dist', wasmFileName)
                    await fs.promises.mkdir('dist', { recursive: true })
                    await fs.promises.copyFile(wasmPath, distWasmPath)
                    return {
                        contents: `
                            const fs = require('fs');
                            const path = require('path');
                            
                            function loadWasm() {
                                const wasmFileName = '${wasmFileName}';
                                const possiblePaths = [
                                    path.join(__dirname, wasmFileName),
                                    path.join(process.cwd(), wasmFileName),
                                    path.join(process.cwd(), 'dist', wasmFileName)
                                ];
                                
                                for (const wasmPath of possiblePaths) {
                                    try {
                                        if (fs.existsSync(wasmPath)) {
                                            return fs.readFileSync(wasmPath);
                                        }
                                    } catch (e) {
                                        continue;
                                    }
                                }
                                
                                return Buffer.from('${wasmBase64}', 'base64');
                            }
                            
                            module.exports = loadWasm();
                        `,
                        loader: 'js'
                    }
                })
            }
        },
        // Plugin to build and copy worker files
        {
            name: 'workers-builder',
            setup(build) {
                build.onEnd(async () => {
                    try {
                        console.log('🔧 Building worker files...')

                        // Create workers directory
                        const distWorkersPath = path.join('dist', 'workers')
                        await fs.promises.mkdir(distWorkersPath, { recursive: true })

                        // Build countTokens worker
                        const workerSrcPath = path.join('../../src/workers/countTokens.ts')
                        const workerDistPath = path.join(distWorkersPath, 'countTokens.js')

                        if (fs.existsSync(workerSrcPath)) {
                            await esbuild.build({
                                entryPoints: [workerSrcPath],
                                bundle: true,
                                platform: 'node',
                                target: 'node18',
                                outfile: workerDistPath,
                                format: 'cjs',
                                external: [], // Bundle everything including workerpool
                                alias: {
                                    // Use the same aliases as main build
                                    'vscode': '@kilo-code/vscode-mock/dist/vscode-api',
                                }
                            })
                            console.log('✅ countTokens worker built successfully!')
                        } else {
                            console.warn(`⚠️  Worker source not found: ${workerSrcPath}`)
                        }
                    } catch (error) {
                        console.error('❌ Error building worker files:', error)
                        // Don't fail the build for worker issues
                    }
                })
            }
        },
        // Plugin to copy i18n locale files to output directory
        {
            name: 'i18n-locales-copier',
            setup(build) {
                build.onEnd(async () => {
                    try {
                        console.log('📁 Copying i18n locale files...')

                        // Source and destination paths
                        const srcLocalesPath = path.join('../../src/i18n/locales')
                        const distI18nPath = path.join('dist/i18n')
                        const distLocalesPath = path.join(distI18nPath, 'locales')

                        // Create destination directories
                        await fs.promises.mkdir(distI18nPath, { recursive: true })
                        await fs.promises.mkdir(distLocalesPath, { recursive: true })

                        // Check if source directory exists
                        if (!fs.existsSync(srcLocalesPath)) {
                            console.warn(`⚠️  Source locales directory not found: ${srcLocalesPath}`)
                            return
                        }

                        // Copy all locale directories and files
                        const languageDirs = await fs.promises.readdir(srcLocalesPath, { withFileTypes: true })

                        for (const dirent of languageDirs) {
                            if (dirent.isDirectory()) {
                                const langName = dirent.name
                                const srcLangPath = path.join(srcLocalesPath, langName)
                                const distLangPath = path.join(distLocalesPath, langName)

                                // Create language directory
                                await fs.promises.mkdir(distLangPath, { recursive: true })

                                // Copy all JSON files in the language directory
                                const files = await fs.promises.readdir(srcLangPath)
                                for (const file of files) {
                                    if (file.endsWith('.json')) {
                                        const srcFilePath = path.join(srcLangPath, file)
                                        const distFilePath = path.join(distLangPath, file)
                                        await fs.promises.copyFile(srcFilePath, distFilePath)
                                    }
                                }
                            }
                        }

                        console.log('✅ i18n locale files copied successfully!')
                    } catch (error) {
                        console.error('❌ Error copying i18n locale files:', error)
                        // Don't fail the build for i18n issues
                    }
                })
            }
        },
        // Plugin to replace ripgrep imports with our mock
        {
            name: 'ripgrep-replacer',
            setup(build) {
                build.onResolve({ filter: /.*\/services\/ripgrep$/ }, (args) => {
                    // console.log(`[DEBUG] Intercepting ripgrep import: ${args.path}`)
                    return {
                        path: path.resolve(__dirname, '../vscode-mock/dist/mocks/ripgrep.js'),
                        external: false
                    }
                })
            }
        }
    ]
}

// Build function
async function build() {
    try {
        console.log('🔨 Building CLI with VS Code module aliasing...')
        await esbuild.build(config)
        console.log('✅ CLI build completed successfully!')
    } catch (error) {
        console.error('❌ Build failed:', error)
        process.exit(1)
    }
}

// Watch function for development
async function watch() {
    try {
        console.log('👀 Starting CLI watch mode...')
        const context = await esbuild.context({
            ...config,
            minify: false,
            sourcemap: true,
            // Add additional watch paths for dependencies
            plugins: [
                ...config.plugins,
                {
                    name: 'dependency-watcher',
                    setup(build) {
                        build.onStart(() => {
                            console.log('🔄 Rebuilding CLI due to changes...')
                        })
                        build.onEnd(() => {
                            console.log('✅ CLI rebuild completed!')
                        })
                    }
                }
            ]
        })
        await context.watch()
        console.log('✅ CLI watch mode started!')
        console.log('📁 Watching: src/, ../vscode-mock/dist/')
    } catch (error) {
        console.error('❌ Watch mode failed:', error)
        process.exit(1)
    }
}

// Export config and functions
module.exports = { config, build, watch }

// Run build if called directly
if (require.main === module) {
    const command = process.argv[2]
    if (command === 'watch') {
        watch()
    } else {
        build()
    }
}