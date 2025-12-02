# 终端 Shell 集成

终端 Shell 集成是一项关键功能，它使 Kilo Code 能够在您的终端中执行命令并智能地处理其输出。AI 与您的开发环境之间的这种双向通信解锁了强大的自动化功能。

## 什么是 Shell 集成？

Shell 集成在 Kilo Code 中自动启用，并直接连接到您的终端命令执行生命周期，无需您进行任何设置。此内置功能允许 Kilo Code：

- 通过 [`execute_command`](/features/tools/execute-command) 工具代表您执行命令
- 实时读取命令输出，无需手动复制粘贴
- 自动检测并修复正在运行的应用程序中的错误
- 观察命令退出代码以确定成功或失败
- 在您导航项目时跟踪工作目录更改
- 无需用户干预即可智能地响应终端输出

当 Kilo Code 需要执行安装依赖项、启动开发服务器或分析构建错误等任务时，shell 集成会在后台工作，使这些交互顺畅有效。

## Shell 集成入门

Shell 集成内置于 Kilo Code 中，在大多数情况下会自动工作。如果您看到“Shell 集成不可用”消息或遇到命令执行问题，请尝试以下解决方案：

1.  **将 VSCode/Cursor 更新**到最新版本（需要 VSCode 1.93+）
2.  **确保选择了兼容的 shell**：命令面板（`Ctrl+Shift+P` 或 `Cmd+Shift+P`）→ “终端：选择默认配置文件”→ 选择 bash、zsh、PowerShell 或 fish
3.  **Windows PowerShell 用户**：运行 `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser`，然后重新启动 VSCode
4.  **WSL 用户**：将 `. "$(code --locate-shell-integration-path bash)"` 添加到您的 `~/.bashrc`

## 终端集成设置

Kilo Code 提供了几个设置来微调 shell 集成。在 Kilo Code 侧边栏的“设置”→“终端”下访问这些设置。

### 基本设置

#### 终端输出限制

<img src="/docs/img/shell-integration/terminal-output-limit.png" alt="终端输出限制滑块设置为 500" width="500" />
控制从终端输出捕获的最大行数。超出时，它会保留开头 20% 和结尾 80%，中间有截断消息。这可以防止过度使用 token，同时保持上下文。默认值：500 行。
控制从终端输出捕获的最大行数。超出时，会从中间删除行以节省 token。默认值：500 行。

#### 终端 Shell 集成超时

<img src="/docs/img/shell-integration/shell-integration-timeout.png" alt="终端 shell 集成超时滑块设置为 15 秒" width="500" />

在执行命令之前等待 shell 集成初始化的最长时间。如果您遇到“Shell 集成不可用”错误，请增加此值。默认值：15 秒。

#### 终端命令延迟

<img src="/docs/img/shell-integration/terminal-command-delay.png" alt="终端命令延迟滑块设置为 0 毫秒" width="500" />

在运行命令后添加一个短暂的暂停，以帮助 Kilo Code 正确捕获所有输出。由于 VSCode 在不同操作系统和 shell 配置中实现终端集成的方式，此设置可能会显著影响 shell 集成的可靠性：

- **默认**：0 毫秒
- **常见值**：
    - 0 毫秒：对于某些使用较新 VSCode 版本的用户效果最佳
    - 50 毫秒：历史默认值，对许多用户仍然有效
    - 150 毫秒：推荐用于 PowerShell 用户
- **注意**：不同的值可能更适合您的：
    - VSCode 版本
    - Shell 自定义（oh-my-zsh、powerlevel10k 等）
    - 操作系统和环境

### 高级设置

:::info 重要
**这些设置需要重新启动终端**

高级终端设置的更改仅在重新启动终端后生效。要重新启动终端：

1.  单击终端面板中的垃圾桶图标以关闭当前终端
2.  使用“终端”→“新建终端”或 <kbd>Ctrl</kbd>+<kbd>`</kbd>（反引号）打开新终端

更改任何这些设置后，务必重新启动所有打开的终端。
:::

#### PowerShell 计数器解决方法

<img src="/docs/img/shell-integration/power-shell-workaround.png" alt="PowerShell 计数器解决方法复选框" width="600" />

帮助 PowerShell 连续多次运行相同的命令。如果您发现 Kilo Code 无法在 PowerShell 中连续运行相同的命令，请启用此功能。

#### 清除 ZSH EOL 标记

<img src="/docs/img/shell-integration/clear-zsh-eol-mark.png" alt="清除 ZSH EOL 标记复选框" width="600" />

防止 ZSH 在输出行末尾添加特殊字符，这些字符在 Kilo Code 读取终端结果时可能会造成混淆。

#### Oh My Zsh 集成

<img src="/docs/img/shell-integration/oh-my-zsh.png" alt="启用 Oh My Zsh 集成复选框" width="600" />

使 Kilo Code 更好地与流行的 [Oh My Zsh](https://ohmyz.sh/) shell 自定义框架配合使用。如果您使用 Oh My Zsh 并遇到终端问题，请打开此功能。

#### Powerlevel10k 集成

<img src="/docs/img/shell-integration/power10k.png" alt="启用 Powerlevel10k 集成复选框" width="600" />

如果您使用 ZSH 的 Powerlevel10k 主题，则可提高兼容性。如果您的花哨终端提示导致 Kilo Code 出现问题，请打开此功能。

#### ZDOTDIR 处理

<img src="/docs/img/shell-integration/zdotdir.png" alt="启用 ZDOTDIR 处理复选框" width="600" />

帮助 Kilo Code 与自定义 ZSH 配置配合使用，而不会干扰您的个人 shell 设置和自定义。

## Shell 集成故障排除

### PowerShell 执行策略 (Windows)

PowerShell 默认限制脚本执行。要配置：

1.  以管理员身份打开 PowerShell
2.  检查当前策略：`Get-ExecutionPolicy`
3.  设置适当的策略：`Set-ExecutionPolicy RemoteSigned -Scope CurrentUser`

常见策略：

- `Restricted`：不允许任何脚本（默认）
- `RemoteSigned`：本地脚本可以运行；下载的脚本需要签名
- `Unrestricted`：所有脚本都带警告运行
- `AllSigned`：所有脚本都必须签名

### 手动 Shell 集成安装

如果自动集成失败，请将适当的行添加到您的 shell 配置中：

**Bash** (`~/.bashrc`)：

```bash
[[ "$TERM_PROGRAM" == "vscode" ]] && . "$(code --locate-shell-integration-path bash)"
```

**Zsh** (`~/.zshrc`)：

```bash
[[ "$TERM_PROGRAM" == "vscode" ]] && . "$(code --locate-shell-integration-path zsh)"
```

**PowerShell** (`$Profile`)：

```powershell
if ($env:TERM_PROGRAM -eq "vscode") { . "$(code --locate-shell-integration-path pwsh)" }
```

**Fish** (`~/.config/fish/config.fish`)：

```fish
string match -q "$TERM_PROGRAM" "vscode"; and . (code --locate-shell-integration-path fish)
```

### 终端自定义问题

如果您使用终端自定义工具：

**Powerlevel10k**：

```bash
# 在 ~/.zshrc 中 source powerlevel10k 之前添加
typeset -g POWERLEVEL9K_TERM_SHELL_INTEGRATION=true
```

**替代方案**：在 Kilo Code 设置中启用 Powerlevel10k 集成设置。

### 验证 Shell 集成状态

使用以下命令确认 shell 集成处于活动状态：

**Bash**：

```bash
set | grep -i '[16]33;'
echo "$PROMPT_COMMAND" | grep vsc
trap -p DEBUG | grep vsc
```

**Zsh**：

```zsh
functions | grep -i vsc
typeset -p precmd_functions preexec_functions
```

**PowerShell**：

```powershell
Get-Command -Name "*VSC*" -CommandType Function
Get-Content Function:\Prompt | Select-String "VSCode"
```

**Fish**：

```fish
functions | grep -i vsc
functions fish_prompt | grep -i vsc
```

活动 shell 集成的视觉指示器：

1.  终端标题栏中的 shell 集成指示器
2.  命令检测高亮显示
3.  终端标题中的工作目录更新
4.  命令持续时间和退出代码报告

## WSL 终端集成方法

使用 Windows Subsystem for Linux (WSL) 时，有两种不同的方法可以使用 VSCode 和 WSL，每种方法对 shell 集成都有不同的影响：

### 方法 1：VSCode Windows 与 WSL 终端

在此设置中：

- VSCode 在 Windows 中原生运行
- 您在 VSCode 中使用 WSL 终端集成功能
- Shell 命令通过 WSL 桥接执行
- 由于 Windows-WSL 通信，可能会出现额外的延迟
- Shell 集成标记可能会受到 WSL-Windows 边界的影响：您必须确保在 WSL 环境中为您的 shell 加载 `source "$(code --locate-shell-integration-path <shell>)"`，因为它可能不会自动加载；请参阅上文。

### 方法 2：VSCode 在 WSL 中运行

在此设置中：

- 您直接从 WSL 中使用 `code .` 启动 VSCode
- VSCode 服务器在 Linux 环境中原生运行
- 直接访问 Linux 文件系统和工具
- 更好的 shell 集成性能和可靠性
- Shell 集成会自动加载，因为 VSCode 在 Linux 环境中原生运行
- WSL 开发的推荐方法

为了与 WSL 实现最佳 shell 集成，我们建议：

1.  打开您的 WSL 发行版
2.  导航到您的项目目录
3.  使用 `code .` 启动 VSCode
4.  使用 VSCode 中的集成终端

## 已知问题与解决方法

### 针对 Windows 上 Fish + Cygwin 的 VS Code Shell 集成

对于在 Cygwin 环境中运行 Fish 终端的 Windows 用户，以下是 VS Code shell 集成的配置方法：

1.  **（可选）定位 Shell 集成脚本：**
    在 _VS Code 内_ 打开您的 Fish 终端并运行以下命令：

    ```bash
    code --locate-shell-integration-path fish
    ```

    这会输出 `shellIntegration.fish` 脚本的路径。请记下此路径。

2.  **更新您的 Fish 配置：**
    编辑您的 `config.fish` 文件（通常位于 Cygwin 主目录下的 `~/.config/fish/config.fish`）。添加以下行，最好放在 `if status is-interactive` 代码块内或文件的末尾：

    ```fish
    # config.fish 结构示例
    if status is-interactive
        # 您的其他交互式 shell 配置...
        # 自动定位集成脚本：
        string match -q "$TERM_PROGRAM" "vscode"; and . (code --locate-shell-integration-path fish)

        # 或者，如果上述方法对您无效：
        # 加载 VS Code shell 集成脚本
        # 重要提示：请将下面的示例路径替换为您在第 1 步中找到的实际路径。
        # 确保路径格式是 Cygwin 可以识别的（例如，使用 /cygdrive/c/...）。
        # source "/cygdrive/c/Users/YourUser/.vscode/extensions/..../shellIntegration.fish"
    end
    ```

    _请记得将示例路径替换为第 1 步中获得的实际路径，并确保其格式适用于 Cygwin。_

3.  **配置 VS Code 终端配置文件：**
    打开您的 VS Code `settings.json` 文件（Ctrl+Shift+P -\> "首选项: 打开用户设置 (JSON)"）。在 `terminal.integrated.profiles.windows` 下更新或添加 Fish 配置文件，如下所示：

    ```json
    {
      // ... 其他设置 ...

      "terminal.integrated.profiles.windows": {
        // ... 其他配置文件 ...

        // 推荐：使用 bash.exe 以登录 shell 方式启动 fish
        "fish": {
          "path": "C:\\cygwin64\\bin\\bash.exe", // 或您的 Cygwin bash 路径
          "args": [
            "--login", // 确保登录脚本运行（对 Cygwin 环境很重要）
            "-i",      // 确保 bash 以交互模式运行
            "-c",
            "exec fish" // 将 bash 进程替换为 fish
          ],
          "icon": "terminal-bash" // 可选：使用一个易于识别的图标
        }
        // 备选方案（如果上述方法失败）：直接启动 fish
        "fish-direct": {
          "path": "C:\\cygwin64\\bin\\fish.exe", // 确保此路径在您的 Windows PATH 中或提供完整路径
          // 此处使用 'options' 而非 'args'；否则可能会遇到“终端进程已终止，退出代码 1”的错误。
          "options": ["-l", "-c"], // 示例：登录和交互式标志
          "icon": "terminal-fish" // 可选：使用 fish 图标
        }
      },

      // 可选：如果需要，将 fish 设置为默认终端
      // "terminal.integrated.defaultProfile.windows": "fish", // 或 "fish-direct"，取决于您使用的配置

      // ... 其他设置 ...
    }
    ```

    _注意：在 Cygwin 环境中，使用 `bash.exe --login -i -c "exec fish"` 通常更可靠，可以确保在 `fish` 启动前正确设置环境。但是，如果该方法无效，请尝试 `fish-direct` 配置文件。_

4.  **重启 VS Code：**
    完全关闭并重新打开 Visual Studio Code 以应用更改。

5.  **验证：**
    在 VS Code 中打开一个新的 Fish 终端。Shell 集成功能（如命令修饰、更好的命令历史导航等）现在应该已激活。您可以通过运行像 `echo "Hello from integrated Fish!"` 这样的简单命令来测试基本功能。 \<img src="/img/shell-integration/shell-integration-8.png" alt="Fish Cygwin Integration Example" width="600" /\>

此设置在使用 Cygwin、Fish 和 Starship 提示符的 Windows 系统上运行稳定，并应能帮助有类似配置的用户。

### VSCode 1.98 版本后 Shell 集成失败

**问题**：VSCode 更新到 1.98 以上版本后，shell 集成可能会失败，并显示错误 “VSCE output start escape sequence (]633;C or ]133;C) not received”。

**解决方案**：

1. **设置终端命令延迟**：

    - 在 Kilo Code 设置中将“终端命令延迟”设置为 50 毫秒。
    - 更改此设置后，重启所有终端。
    - 这与旧版的默认行为匹配，可能解决问题，但有用户报告称设置为 0 毫秒效果更好。这是针对上游 VSCode 问题的解决方法。

2. **回退 VSCode 版本**：

    - 从 [VSCode 更新页面](https://code.visualstudio.com/updates/v1_98) 下载 VSCode v1.98。
    - 替换您当前的 VSCode 安装。
    - 无需备份 Kilo 设置。

3. **WSL 特定解决方法**：

    - 如果使用 WSL，请确保您是从 WSL 内部通过 `code .` 命令启动 VSCode。

4. **ZSH 用户**：
    - 尝试在 Kilo Code 设置中启用部分或全部 ZSH 相关的解决方法。
    - 无论您的操作系统是什么，这些设置都可能有所帮助。

## 已知问题及解决方法

### Ctrl+C 的行为

**问题**：当 Kilo Code 尝试运行命令时，如果终端中已经输入了文本，Kilo Code 会先按 Ctrl+C 来清空当前行，这可能会中断正在运行的进程。

**解决方法**：在要求 Kilo Code 执行终端命令之前，请确保您的终端提示符是空的（没有输入任何部分命令）。

### 多行命令问题

**问题**：跨多行的命令可能会让 Kilo Code 混淆，并可能将先前命令的输出与当前输出混合在一起。

**解决方法**：不要使用多行命令，而是使用 `&&` 进行命令链接，将所有内容保持在一行（例如，使用 `echo a && echo b`，而不是分行输入每个命令）。

### PowerShell 特定问题

1.  **过早完成**：PowerShell 有时会在所有输出显示完毕前就通知 Kilo Code 命令已完成。
2.  **重复命令**：PowerShell 可能会拒绝连续两次运行相同的命令。

**解决方法**：启用“PowerShell 计数器解决方法”设置，并在设置中将终端命令延迟设置为 150 毫秒，以便为命令留出更多完成时间。

### 终端输出不完整

**问题**：有时 VS Code 不会显示或捕获命令的全部输出。

**解决方法**：如果您发现输出缺失，请尝试关闭并重新打开终端选项卡，然后再次运行该命令。这会刷新终端连接。

## 故障排除资源

### 检查调试日志

当出现 shell 集成问题时，请检查调试日志：

1.  打开“帮助” → “切换开发人员工具” → “控制台”。
2.  将日志级别设置为“显示所有级别”以查看所有日志消息。
3.  查找包含 `[Terminal Process]` 的消息。
4.  检查错误消息中的 `preOutput` 内容：
    - 空的 `preOutput` (`''`) 意味着 VSCode 没有发送任何数据。
    - 这表明可能存在 VSCode shell 集成问题，或者是我们无法控制的上游 bug。
    - 缺少 shell 集成标记可能需要调整设置，以解决与 shell 初始化和 VSCode 加载特殊 shell 集成钩子相关的上游 bug 或本地工作站配置问题。

### 使用 VSCode Terminal Integration Test 扩展

[VSCode Terminal Integration Test 扩展](https://github.com/KJ7LNW/vsce-test-terminal-integration) 通过测试不同的设置组合来帮助诊断 shell 集成问题：

1.  **当命令卡住时**：

    - 如果您看到“命令已在运行”的警告，请单击“重置统计信息”以重置终端状态。
    - 这些警告表明 shell 集成未正常工作。
    - 尝试不同的设置组合，直到找到一个可行的。
    - 如果问题确实卡住了，通过关闭窗口并按 F5 来重启扩展。

2.  **测试设置**：

    - 系统地尝试以下设置的不同组合：
        - 终端命令延迟
        - Shell 集成设置
    - 记录哪些组合成功或失败。
    - 这有助于识别 shell 集成问题的模式。

3.  **报告问题**：
    - 一旦找到有问题的配置。
    - 记录下确切的设置组合。
    - 注明您的环境（操作系统、VSCode 版本、shell 以及任何 shell 提示符自定义）。
    - 提交一个包含这些详细信息的问题，以帮助改进 shell 集成。

## 支持

如果您已遵循上述步骤但仍遇到问题，请：

1.  查看 [Kilo Code GitHub Issues](https://github.com/Kilo-Org/kilocode/issues) 页面，看是否有人报告了类似的问题。
2.  如果没有，请创建一个新 issue，并提供有关您的操作系统、VSCode/Cursor 版本以及您已尝试过的步骤的详细信息。

如需更多帮助，请加入我们的 [Discord](https://kilo.ai/discord)。如需其他帮助，请加入我们的 [Discord](https://kilo.ai/discord)。
