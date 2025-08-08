# 测试规则

1. 调试之前，先编译，需要执行如下代码：

    ```bash
        pnpm lint
        pnpm -C webview-ui run build
        pnpm -C src bundle
    ```

    2. 调试通过之后，执行如下代码:

    ```bash
    npm run build && NODE_ENV=development VSCODE_DEBUG_MODE=true code --extensionDevelopmentPath=${PWD}/src
    ```
