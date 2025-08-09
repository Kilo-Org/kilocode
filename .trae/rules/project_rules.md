# 测试规则

1. CSS不能内嵌，需要外联
2. 根据用户提出的问题，先理解需求，查阅代码
3. 用链式思考，分析问题，提出解决方案，给出代码
4. 按照解决方案，修改代码，并进行测试
5. 测试之前，在“buildInfo.ts”文件中，将buildNumber的值加1
6. 编写测试代码，对新增功能、修复功能进行正向、反向测试，直到功能达到预期
7. 如果需要编译，编译安装测试，执行如下步骤
    - 测试之后，执行如下代码，进行编译：

```bash
    pnpm lint
    pnpm -C webview-ui run build
    pnpm -C src bundle
```

- 调试通过之后，执行如下代码:

```bash
npm run build && NODE_ENV=development VSCODE_DEBUG_MODE=true code --extensionDevelopmentPath=${PWD}/src
```
