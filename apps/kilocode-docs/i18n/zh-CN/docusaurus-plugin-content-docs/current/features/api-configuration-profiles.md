# API 配置配置文件

API 配置配置文件允许您创建和切换不同的 AI 设置集。每个配置文件可以为每种模式设置不同的配置，让您根据手头的任务优化您的体验。

:::info
拥有多个配置配置文件可以让您快速切换不同的 AI 提供商、模型和设置，而无需每次更改设置时都重新配置所有内容。
:::

## 工作原理

配置配置文件可以拥有自己的：

- API 提供商（OpenAI、Anthropic、OpenRouter、Glama 等）
- API 密钥和身份验证详细信息
- 模型选择（o3-mini-high、Claude 3.7 Sonnet、DeepSeek R1 等）
- [温度设置](/features/model-temperature)用于控制响应随机性
- 思维预算
- 特定于提供商的设置

请注意，可用设置因提供商和模型而异。每个提供商提供不同的配置选项，即使在同一提供商内，不同的模型也可能支持不同的参数范围或功能。

## 创建和管理配置文件

### 创建配置文件

1.  单击齿轮图标 <Codicon name="gear" /> → Providers 打开设置
2.  单击配置文件选择器旁边的“+”按钮

    <img src="/docs/img/api-configuration-profiles/api-configuration-profiles-1.png" alt="带加号按钮的配置文件选择器" width="550" />

3.  输入新配置文件的名称

    <img src="/docs/img/api-configuration-profiles/api-configuration-profiles.png" alt="创建新配置文件对话框" width="550" />

4.  配置配置文件设置：

    - 选择您的 API 提供商

                            <img src="/docs/img/api-configuration-profiles/api-configuration-profiles-2.png" alt="提供商选择下拉菜单" width="550" />

    - 输入 API 密钥

                            <img src="/docs/img/api-configuration-profiles/api-configuration-profiles-3.png" alt="API 密钥输入字段" width="550" />

    - 选择模型

                            <img src="/docs/img/api-configuration-profiles/api-configuration-profiles-8.png" alt="模型选择界面" width="550" />

    - 调整模型参数

                            <img src="/docs/img/api-configuration-profiles/api-configuration-profiles-5.png" alt="模型参数调整控件" width="550" />

### 切换配置文件

通过两种方式切换配置文件：

1.  从设置面板：从下拉菜单中选择不同的配置文件

    <img src="/docs/img/api-configuration-profiles/api-configuration-profiles-7.png" alt="设置中的配置文件选择下拉菜单" width="550" />

2.  聊天期间：访问聊天界面中的 API 配置下拉菜单

    <img src="/docs/img/api-configuration-profiles/api-configuration-profiles-6.png" alt="聊天界面中的 API 配置下拉菜单" width="550" />

### 固定和排序配置文件

API 配置下拉菜单现在支持固定您喜欢的配置文件，以便更快访问：

1.  将鼠标悬停在下拉菜单中的任何配置文件上以显示图钉图标
2.  单击图钉图标将配置文件添加到您的固定列表
3.  固定配置文件显示在下拉菜单顶部，按字母顺序排序
4.  未固定配置文件显示在分隔符下方，也按字母顺序排序
5.  您可以再次单击同一图标以取消固定配置文件

<img src="/docs/img/api-configuration-profiles/api-configuration-profiles-4.png" alt="固定 API 配置配置文件" width="550" />

此功能使您更容易在常用配置文件之间导航，尤其是在您有许多配置时。

### 编辑和删除配置文件

<img src="/docs/img/api-configuration-profiles/api-configuration-profiles-10.png" alt="配置文件编辑界面" width="550" />
- 在设置中选择配置文件以修改任何设置
- 单击铅笔图标以重命名配置文件
- 单击垃圾桶图标以删除配置文件（您不能删除唯一剩余的配置文件）

## 将配置文件链接到模式

在 <Codicon name="notebook" /> 提示选项卡中，您可以将特定配置配置文件与每个模式明确关联。系统还会自动记住您上次与每个模式一起使用的配置文件，从而提高您的工作效率。

观看此演示，了解如何将配置配置文件与特定模式连接以优化工作流：

<video width="600" controls>
  <source src="/docs/img/api-configuration-profiles/provider-modes.mp4" type="video/mp4" />
  您的浏览器不支持此视频标签。
</video>

## 安全注意事项

API 密钥安全地存储在 VSCode 的 Secret Storage 中，绝不会以纯文本形式公开。

## 相关功能

- 适用于您创建的[自定义模式](/agent-behavior/custom-modes)
- 与[本地模型](/advanced-usage/local-models)集成以进行离线工作
- 支持每个模式的[温度设置](/features/model-temperature)
- 通过[速率限制和使用跟踪](/advanced-usage/rate-limits-costs)增强成本管理
