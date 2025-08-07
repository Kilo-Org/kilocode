#!/bin/bash

echo "🔍 Debugging Kilo Code Extension Commands"
echo "========================================"

# 检查扩展是否安装
echo "📦 Checking installed extensions..."
trae --list-extensions --show-versions | grep -i kilo

echo ""
echo "🔧 Testing command availability..."

# 尝试获取所有可用命令
echo "Getting all available commands..."
trae --help | grep -i command

echo ""
echo "🎯 Testing specific command execution..."

# 创建一个简单的测试文件来触发扩展激活
echo "console.log('test');" > test-activation.js

echo "📝 Created test file to trigger extension activation"
echo "Now opening Trae with the test file..."

# 打开文件以触发扩展激活
trae test-activation.js &
TRAE_PID=$!

echo "🚀 Trae started with PID: $TRAE_PID"
echo "Waiting 5 seconds for extension to activate..."
sleep 5

echo "✅ Extension should now be activated"
echo "📋 Manual test steps:"
echo "1. In Trae, press Cmd+Shift+P to open Command Palette"
echo "2. Type 'kilo-code.settingsButtonClicked'"
echo "3. Check if the command appears in the list"
echo "4. Execute the command and verify it works"

echo ""
echo "🧹 Cleaning up..."
rm -f test-activation.js

echo "✨ Debug script completed"