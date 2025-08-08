# 测试规则

1. CSS不能内嵌，需要外联
2. 调试之前，在“buildInfo.ts”文件中，将buildNumber的值加1
3. 测试之后，执行如下代码，进行编译：

```bash
    pnpm lint
    npx turbo build
    pnpm -C webview-ui run build
    pnpm -C src bundle
```

4. 调试通过之后，执行如下代码:

```bash
npm run build && NODE_ENV=development VSCODE_DEBUG_MODE=true code --extensionDevelopmentPath=${PWD}/src
```

5. 编写测试代码，对新增功能、修复功能进行正向、反向测试，直到功能达到预期
