# 系统通知

系统通知是原生操作系统通知，会出现在系统的通知中心或系统托盘中。与仅在编辑器内显示的 VSCode 内置通知不同，系统通知在以下情况下仍然可见：

- VSCode 处于最小化状态或在后台运行
- 您正在使用其他应用程序时
- 你的屏幕被锁定（取决于操作系统设置）
- 您离开电脑时

Kilo Code 使用系统通知向您告知以下信息：

- 任务完成状态
- 重要错误或警告信息
- 长时间运行操作的进度更新
- 关键系统事件

## 支持的操作系统

Kilo Code 的系统通知可在所有主要操作系统上运行，但底层技术不同：

| 操作系统    | 技术                            | 要求                    |
| ----------- | ------------------------------- | ----------------------- |
| **macOS**   | AppleScript + terminal-notifier | 内置支持，可选增强功能  |
| **Windows** | PowerShell + Windows Runtime    | PowerShell 执行策略配置 |
| **Linux**   | notify-send                     | 安装 libnotify 包       |

## 平台特定设置

### macOS 设置

macOS 有最佳的系统通知内置支持，提供以下两种可用方法：

#### 方法 1：内置 AppleScript（备用）

无需额外设置。Kilo Code 使用 macOS 的内置命令来显示通知。

#### 方法 2：使用 terminal-notifier 增强（推荐）

要获得带有自定义图标的增强通知，请安装 terminal-notifier：

```bash
# 通过 Homebrew 安装
brew install terminal-notifier

# 或通过 npm 安装
npm install -g terminal-notifier
```

**工作原理：** Kilo Code 会首先尝试使用 `terminal-notifier`，如果未安装则自动回退到 AppleScript。

### Windows 设置

Windows 通知需要配置 PowerShell 执行策略才能正常工作。

#### 步骤 1：配置 PowerShell 执行策略

以管理员身份打开 PowerShell 并运行：

```powershell
# 检查当前执行策略
Get-ExecutionPolicy

# 设置执行策略以允许本地脚本运行
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
```

#### 步骤 2：验证 Windows Runtime 访问权限

Windows 通知通过 PowerShell 使用 `Windows.UI.Notifications` API。此功能在以下系统版本中可用：

- ✅ Windows 10（所有版本）
- ✅ Windows 11（所有版本）
- ✅ Windows Server 2016 及更高版本
- ❌ Windows 8.1 及更早版本（支持有限）

#### 执行策略选项

| 策略           | 描述                               | 安全级别 | 推荐程度    |
| -------------- | ---------------------------------- | -------- | ----------- |
| `Restricted`   | 不允许运行脚本（默认）             | 最高     | ❌ 阻止通知 |
| `RemoteSigned` | 本地脚本可运行，下载的脚本需要签名 | 高       | ✅ **推荐** |
| `Unrestricted` | 所有脚本运行但会显示警告           | 中等     | ⚠️ 谨慎使用 |
| `AllSigned`    | 所有脚本都必须经过签名             | 最高     | ❌ 过于严格 |

### Linux 设置

Linux 通知需要 `libnotify` 包和 `notify-send` 命令。

#### Ubuntu/Debian 安装

```bash
# 安装 libnotify 包
sudo apt update
sudo apt install libnotify-bin

# 验证安装是否成功
which notify-send
```

#### Red Hat/CentOS/Fedora 安装

```bash
# RHEL/CentOS
sudo yum install libnotify

# Fedora
sudo dnf install libnotify

# 验证安装
which notify-send
```

#### Arch Linux 安装

```bash
# 安装 libnotify 包
sudo pacman -S libnotify

# 验证安装是否成功
which notify-send
```

#### 桌面环境要求

系统通知在以下桌面环境中效果最佳：

| 桌面环境       | 支持级别    | 说明                     |
| -------------- | ----------- | ------------------------ |
| **GNOME**      | ✅ 完全支持 | 原生通知中心             |
| **KDE Plasma** | ✅ 完全支持 | 原生通知系统             |
| **XFCE**       | ✅ 良好支持 | 需要通知守护进程         |
| **Unity**      | ✅ 完全支持 | Ubuntu 的通知系统        |
| **i3/Sway**    | ⚠️ 有限支持 | 需要手动设置通知守护进程 |
| **Headless**   | ❌ 不支持   | 无显示服务器可用         |

#### 通知守护进程设置（高级）

对于轻量级窗口管理器，您可能需要启动通知守护进程：

```bash
# 安装并启动 dunst（轻量级通知守护进程）
sudo apt install dunst  # Ubuntu/Debian
sudo pacman -S dunst    # Arch Linux

# 手动启动 dunst 服务
dunst &

# 或添加到窗口管理器的启动脚本中
echo "dunst &" >> ~/.xinitrc
```

## 验证系统通知

### 各平台的测试命令

#### macOS 测试

```bash
# 测试 AppleScript 方法
osascript -e 'display notification "测试消息" with title "测试标题" sound name "Tink"'

# 测试 terminal-notifier（如果已安装）
terminal-notifier -message "测试消息" -title "测试标题" -sound Tink
```

#### Windows 测试

```powershell
# 测试 PowerShell 通知
$template = @"
<toast>
    <visual>
        <binding template="ToastText02">
            <text id="1">测试标题</text>
            <text id="2">测试消息</text>
        </binding>
    </visual>
</toast>
"@

[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml($template)
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Test App").Show($toast)
```

#### Linux 测试

```bash
# 测试 notify-send
notify-send "测试标题" "测试消息"

# 带图标的测试（可选）
notify-send -i dialog-information "测试标题" "测试消息"
```

## 故障排除

### 常见问题及解决方案

#### macOS 问题

**问题：** 通知未出现

- **解决方案 1：** 检查系统偏好设置 → 通知 → 终端（或 VSCode）→ 允许通知
- **解决方案 2：** 确认勿扰模式已禁用
- **解决方案 3：** 使用上述手动命令测试
- **解决方案 4：** 确保 terminal-notifier 已正确安装：`brew install terminal-notifier`

#### Windows 问题

**问题：** “Execution of scripts is disabled” 错误

- **解决方案：** 按照设置说明配置 PowerShell 执行策略
- **命令：** `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser`

**问题：** Windows 11 中通知不显示

- **解决方案 1：** 检查设置 → 系统 → 通知 → 允许通知
- **解决方案 2：** 确保专注助手未阻止通知
- **解决方案 3：** 验证 Windows 通知服务是否正在运行

**问题：** PowerShell 脚本错误

- **解决方案：** 将 PowerShell 更新到 5.1 或更高版本
- **检查版本：** `$PSVersionTable.PSVersion`

#### Linux 问题

**问题：** `notify-send: command not found`

- **解决方案：** 为你的发行版安装 libnotify 包
- **Ubuntu/Debian：** `sudo apt install libnotify-bin`
- **RHEL/CentOS：** `sudo yum install libnotify`
- **Arch：** `sudo pacman -S libnotify`

**问题：** 在轻量级窗口管理器中通知不显示

- **解决方案：** 安装并配置通知守护程序，如 dunst
- **安装：** `sudo apt install dunst`（Ubuntu/Debian）
- **启动服务：** `dunst &`

**问题：** 出现权限被拒绝错误

- **解决方案：** 确保你的用户有权访问显示服务器
- **检查命令：** `echo $DISPLAY` 应返回类似 `:0` 的结果
