# 测试规则

1. 调试之前，先编译，需要执行如下代码：


    ```bash
        pnpm -C webview-ui run build
        pnpm -C src bundle
    ```
    2. 调试通过之后，执行如下代码:
    ```bash
    code --extensionDevelopmentPath=./src --disable-extensions
    ```
