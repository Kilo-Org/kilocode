# 浏览器使用

Kilo Code 提供复杂的浏览器自动化功能，让您可以直接从 VS Code 与网站交互。此功能支持测试 Web 应用程序、自动化浏览器任务和捕获屏幕截图，而无需离开您的开发环境。

:::info 需要模型支持
Kilo Code 中的浏览器使用需要使用高级智能体模型，并且仅在 Claude Sonnet 3.5、3.7 和 4 上进行过测试。
:::

## 浏览器使用工作原理

默认情况下，Kilo Code 使用内置浏览器，该浏览器：

- 当您要求 Kilo 访问网站时自动启动
- 捕获网页屏幕截图
- 允许 Kilo 与网页元素交互
- 在后台静默运行

所有这些都直接在 VS Code 中发生，无需设置。

## 浏览器使用

典型的浏览器交互遵循以下模式：

1.  要求 Kilo 访问网站
2.  Kilo 启动浏览器并向您显示屏幕截图
3.  请求其他操作（单击、键入、滚动）
4.  完成后 Kilo 关闭浏览器

例如：

```
打开浏览器并查看我们的网站。
```

```
您能检查一下我的网站 https://kilo.ai 是否正常显示吗？
```

```
浏览 http://localhost:3000，滚动到页面底部并检查页脚信息是否正常显示。
```

<img src="/docs/features/KiloCodeBrowser.png" alt="浏览器使用示例" width="300" />

## 浏览器操作工作原理

`browser_action` 工具控制一个浏览器实例，该实例在每次操作后返回屏幕截图和控制台日志，让您可以看到交互结果。

主要特性：

- 每个浏览器会话必须以 `launch` 开始并以 `close` 结束
- 每个消息只能使用一个浏览器操作
- 浏览器处于活动状态时，不能使用其他工具
- 在执行下一个操作之前，您必须等待响应（屏幕截图和日志）

### 可用的浏览器操作

| 操作          | 描述                       | 何时使用           |
| ------------- | -------------------------- | ------------------ |
| `launch`      | 在浏览器中打开指定的 URL   | 启动新的浏览器会话 |
| `click`       | 在特定坐标处单击           | 与按钮、链接等交互 |
| `type`        | 在当前聚焦的元素中键入文本 | 填写表单、搜索框   |
| `scroll_down` | 向下滚动一页               | 查看折叠下方的内容 |
| `scroll_up`   | 向上滚动一页               | 返回到以前的内容   |
| `close`       | 关闭浏览器                 | 结束浏览器会话     |

## 浏览器使用配置/设置

:::info 默认浏览器设置

- **启用浏览器工具**：已启用
- **视口大小**：小型桌面 (900x600)
- **屏幕截图质量**：75%
- **使用远程浏览器连接**：已禁用
  :::

### 访问设置

要更改 Kilo 中的浏览器/计算机使用设置：

1.  单击齿轮图标 <Codicon name="gear" /> → 浏览器/计算机使用 打开设置

    <img src="/docs/img/browser-use/browser-use.png" alt="浏览器设置菜单" width="600" />

### 启用/禁用浏览器使用

**目的**：主开关，使 Kilo 能够使用 Puppeteer 控制的浏览器与网站交互。

要更改此设置：

1.  在浏览器/计算机使用设置中选中或取消选中“启用浏览器工具”复选框

    <img src="/docs/img/browser-use/browser-use-2.png" alt="启用浏览器工具设置" width="300" />

### 视口大小

**目的**：确定 Kilo Code 使用的浏览器会话的分辨率。

**权衡**：较高的值提供更大的视口，但会增加 token 使用量。

要更改此设置：

1.  单击浏览器/计算机使用设置中“视口大小”下的下拉菜单
2.  选择可用选项之一：
    - 大型桌面 (1280x800)
    - 小型桌面 (900x600) - 默认
    - 平板电脑 (768x1024)
    - 移动设备 (360x640)
3.  选择您所需的分辨率。

    <img src="/docs/img/browser-use/browser-use-3.png" alt="视口大小设置" width="600" />

### 屏幕截图质量

**目的**：控制浏览器屏幕截图的 WebP 压缩质量。

**权衡**：较高的值提供更清晰的屏幕截图，但会增加 token 使用量。

要更改此设置：

1.  在浏览器/计算机使用设置中调整“屏幕截图质量”下的滑块
2.  设置 1-100% 之间的值（默认值为 75%）
3.  较高的值提供更清晰的屏幕截图，但会增加 token 使用量：

    - 40-50%：适用于基本的基于文本的网站
    - 60-70%：适用于大多数通用浏览
    - 80%+：在精细视觉细节至关重要时使用

    <img src="/docs/img/browser-use/browser-use-4.png" alt="屏幕截图质量设置" width="600" />

### 远程浏览器连接

**目的**：将 Kilo 连接到现有 Chrome 浏览器，而不是使用内置浏览器。

**优点**：

- 在容器化环境和远程开发工作流中工作
- 在浏览器使用之间保持经过身份验证的会话
- 消除重复的登录步骤
- 允许使用带有特定扩展的自定义浏览器配置文件

**要求**：Chrome 必须运行并启用远程调试。

要启用此功能：

1.  在浏览器/计算机使用设置中选中“使用远程浏览器连接”框
2.  单击“测试连接”以验证

    <img src="/docs/img/browser-use/browser-use-5.png" alt="远程浏览器连接设置" width="600" />

#### 常见用例

- **DevContainers**：从容器化 VS Code 连接到主机 Chrome 浏览器
- **远程开发**：将本地 Chrome 与远程 VS Code 服务器一起使用
- **自定义 Chrome 配置文件**：使用带有特定扩展和设置的配置文件

#### 连接到可见的 Chrome 窗口

连接到可见的 Chrome 窗口以实时观察 Kilo 的交互：

**macOS**

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug --no-first-run
```

**Windows**

```bash
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir=C:\chrome-debug --no-first-run
```

**Linux**

```bash
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug --no-first-run
```
