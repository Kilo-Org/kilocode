import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 获取项目根目录
const projectRoot = join(__dirname, '..');

// 读取 src/package.json (实际的扩展包信息)
const packageJsonPath = join(projectRoot, 'src/package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const packageName = packageJson.name;
const packageVersion = packageJson.version;

// 读取 buildInfo.ts
const buildInfoPath = join(projectRoot, 'webview-ui/src/utils/buildInfo.ts');
const buildInfoContent = readFileSync(buildInfoPath, 'utf8');
const buildNumberMatch = buildInfoContent.match(/export const buildNumber = "(\d+)"/);
let buildNumber = "000";
if (buildNumberMatch && buildNumberMatch[1]) {
    buildNumber = buildNumberMatch[1];
}

// 获取功能说明 (从命令行参数或环境变量)
const featureDescription = process.argv[2] || process.env.FEATURE_DESCRIPTION || 'release';

// 构建 vsix 文件名: kilo-code-版本号-编译号-功能说明.vsix
const vsixFileName = `${packageName}-${packageVersion}-${buildNumber}-${featureDescription}.vsix`;
const outputDir = join(projectRoot, 'out'); // 假设 vsix 文件输出到 out 目录

if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
}

// 执行 vsce package 命令
try {
    console.log(`正在打包扩展到 ${vsixFileName}...`);
    // 切换到 src 目录执行 vsce package 命令，因为 package.json 在 src 目录下
    const srcDir = join(projectRoot, 'src');
    execSync(`npx vsce package --no-dependencies --out "${join(outputDir, vsixFileName)}"`, { 
        stdio: 'inherit',
        cwd: srcDir
    });
    console.log(`成功生成 ${vsixFileName}`);
} catch (error) {
    console.error(`打包失败: ${error.message}`);
    process.exit(1);
}
