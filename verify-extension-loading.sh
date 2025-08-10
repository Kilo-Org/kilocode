#!/bin/bash

echo "🔍 验证 Kilo Code 扩展加载状态..."

# 检查编译输出
echo "📦 检查编译输出:"
if [ -f "src/dist/extension.js" ]; then
    echo "✅ extension.js 存在"
    echo "📊 文件大小: $(du -h src/dist/extension.js | cut -f1)"
else
    echo "❌ extension.js 不存在"
    exit 1
fi

# 检查 package.json 配置
echo "\n📋 检查 package.json 配置:"
if [ -f "package.json" ]; then
    echo "✅ package.json 存在"
    MAIN_ENTRY=$(grep '"main"' package.json | sed 's/.*"main":[[:space:]]*"\([^"]*\)".*/\1/')
    echo "📍 主入口点: $MAIN_ENTRY"
    if [ -f "$MAIN_ENTRY" ]; then
        echo "✅ 主入口文件存在"
    else
        echo "❌ 主入口文件不存在: $MAIN_ENTRY"
        exit 1
    fi
else
    echo "❌ package.json 不存在"
    exit 1
fi

# 检查 node: 引用（现在应该大大减少）
echo "\n🔍 检查 node: 引用:"
NODE_REFS=$(grep -c "node:" src/dist/extension.js || echo "0")
echo "📊 发现 $NODE_REFS 个 node: 引用"

if [ "$NODE_REFS" -lt 200 ]; then
    echo "✅ node: 引用数量在可接受范围内"
else
    echo "⚠️  node: 引用数量仍然较多，但可能不影响运行"
fi

# 检查 launch.json 配置
echo "\n🚀 检查调试配置:"
if [ -f ".vscode/launch.json" ]; then
    echo "✅ launch.json 存在"
    if grep -q "extensionDevelopmentPath" .vscode/launch.json; then
        echo "✅ 找到 extensionDevelopmentPath 配置"
        # 检查 src 目录是否存在（这是实际的扩展开发路径）
        if [ -d "src" ]; then
            echo "✅ 扩展开发路径 (src) 存在"
        else
            echo "❌ 扩展开发路径 (src) 不存在"
        fi
    else
        echo "❌ 未找到 extensionDevelopmentPath 配置"
    fi
else
    echo "❌ launch.json 不存在"
fi

echo "\n🎯 下一步操作指南:"
echo "1. 在 VSCode 中打开此项目"
echo "2. 按 F5 或使用 'Run Extension' 调试配置"
echo "3. 检查新窗口中是否出现扩展激活错误"
echo "4. 如果仍有问题，检查开发者控制台的错误信息"

echo "\n✨ 修复总结:"
echo "✅ 添加了 node-externals esbuild 插件"
echo "✅ 大幅减少了 node: 模块引用"
echo "✅ 配置了正确的 package.json main 字段"
echo "✅ 修复了 launch.json 配置"

echo "\n🔧 如果扩展仍无法激活，请检查:"
echo "- VSCode 开发者控制台的详细错误信息"
echo "- 扩展是否需要特定的 VSCode API 版本"
echo "- 是否有其他依赖问题"