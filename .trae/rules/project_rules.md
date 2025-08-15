# 测试规则

1. 根据用户提出的问题，先理解需求，查阅代码
2. 用链式思考，全面分析问题，修改代码
3. 如果源代码中已存在相应代码，需要在原代码基础上优化、重构、修改，不要重复或创造全新的，导致代码冗余
4. 测试之后，修改编译信息，在“webview-ui/src/utils/buildInfo.ts”文件中
    - 将buildNumber的值加1
    - 修改featureDescription，改为将当前新增/修改的功能简要的单行描述
5. 修改检查：对修改过的文件，进行代码审查，jshint，tcslint等进行检查，确保代码质量没有问题
6. 如果文件被破坏，需要git获取改文件上一版本，进行差异对比，再进行修复
7. 如果需要编译，编译安装测试，执行如下步骤

```bash
    pnpm lint
    pnpm -C webview-ui run build
    pnpm -C src bundle
```

7. 调试通过之后，执行如下代码:

```bash
npm run build && NODE_ENV=development VSCODE_DEBUG_MODE=true code --extensionDevelopmentPath=${PWD}/src
```

8. 最后把所有修改的代码，生成git提交信息，自动提交代码，需要注明是AI自动提交（临时保存）
