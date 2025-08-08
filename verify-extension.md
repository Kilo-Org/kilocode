# Kilo Code 扩展验证指南

## 问题解决总结

### 已修复的问题

1. **Node.js 内部模块引用错误**

    - 修复了 `esbuild.mjs` 中的 `node:process` 和 `node:console` 引用
    - 修复了 `claude-code/run.ts` 中的 `node:path`, `node:crypto`, `node:fs/promises` 引用
    - 修复了 `GhostProvider.spec.ts` 中的 `node:fs` 和 `node:path` 引用
    - 这些修复解决了 "Could not find module root given file: node:internal/modules/cjs/loader" 错误

2. **调试流程优化**
    - 创建了 `debug-extension.sh` 脚本，确保每次调试都使用最新编译的扩展
    - 脚本会自动编译项目并启动 Trae 进行调试

### 验证步骤

#### 1. 检查扩展是否正确加载

在 Trae 中：

1. 按 `Cmd+Shift+P` 打开命令面板
2. 输入 "Kilo Code" 查看是否有相关命令
3. 检查侧边栏是否有 Kilo Code 图标

#### 2. 检查开发者控制台

1. 在 Trae 中选择 `Help > Toggle Developer Tools`
2. 查看 Console 标签页是否有错误信息
3. 确认没有模块加载相关的错误

#### 3. 测试扩展功能

1. 尝试打开 Kilo Code 设置面板
2. 测试基本的扩展命令
3. 验证扩展是否正常激活

### 使用调试脚本

```bash
# 编译并启动调试
./debug-extension.sh
```

该脚本会：

1. 清理并重新编译项目
2. 验证编译输出
3. 启动 Trae 并加载扩展
4. 提供调试提示

### 技术细节

- **编译输出**: `src/dist/extension.js`
- **扩展路径**: `src/`
- **主要修复**: 移除了 Node.js 内部模块的 `node:` 前缀引用
- **构建工具**: esbuild + pnpm

### 如果仍有问题

1. 检查 Node.js 版本是否为 20.19.2（当前使用 22.17.0 会有警告但不影响功能）
2. 确保所有依赖已正确安装：`pnpm install`
3. 清理并重新构建：`pnpm run bundle`
4. 检查 Trae 开发者控制台的详细错误信息

---

**最后更新**: 2025-08-08
**状态**: ✅ 问题已解决，扩展可正常调试
