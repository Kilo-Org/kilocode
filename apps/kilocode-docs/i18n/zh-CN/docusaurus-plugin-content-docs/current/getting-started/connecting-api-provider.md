---
sidebar_label: 连接到提供商
---

# 连接 AI 提供商

Kilo Code 需要 AI 模型提供商的 API 密钥才能运行。

我们推荐以下选项来访问强大的 **Claude 4 Sonnet** 模型：

- **Kilo Code API 提供商（推荐）：** 以有竞争力的价格提供对 OpenRouter 可用的所有模型的访问权限，并提供免费积分以供入门。 [查看定价](https://kilo.ai/pricing)
- **OpenRouter：** 通过单个 API 密钥提供对多个 AI 模型的访问权限。 [查看定价](https://openrouter.ai/models?order=pricing-low-to-high)。
- **Anthropic：** 直接访问 Claude 模型。需要 API 访问批准，并且可能[根据您的层级有速率限制](https://docs.anthropic.com/en/api/rate-limits#requirements-to-advance-tier)。有关详细信息，请参阅 [Anthropic 的定价页面](https://www.anthropic.com/pricing#anthropic-api)。

## 使用 Kilo Code 提供商

默认情况下，当您安装 Kilo Code 扩展时，系统会提示您在 [Kilo Code 提供商](/providers/kilocode)中登录或创建帐户。

这将引导您完成帐户设置并*自动*正确配置 Kilo Code 以帮助您入门。如果您更喜欢使用其他提供商，则需要按照以下说明手动获取您的 API 密钥。

## 使用其他 API 提供商

_即将登陆 Kilo Code Teams 和 Enterprise 平台！_

### 获取您的API密钥

#### 选项1：LLM路由器

LLM路由器让您可以通过一个API密钥访问多个AI模型，简化了成本管理和模型切换。通常提供[更具竞争力的价格](https://openrouter.ai/models?order=pricing-low-to-high)。

##### OpenRouter

1. 访问 [openrouter.ai](https://openrouter.ai/)
2. 使用Google或GitHub账号登录
3. 导航到[API密钥页面](https://openrouter.ai/keys)并创建新密钥
4. 复制您的API密钥 - 您需要它来设置Kilo Code

<img src="/docs/img/connecting-api-provider/connecting-api-provider-4.png" alt="OpenRouter API密钥页面" width="600" />

_OpenRouter仪表板，带有"创建密钥"按钮。命名您的密钥并在创建后复制它。_

##### Requesty

1. 访问 [requesty.ai](https://requesty.ai/)
2. 使用Google账号或电子邮件登录
3. 导航到[API管理页面](https://app.requesty.ai/manage-api)并创建新密钥
4. **重要：** 立即复制您的API密钥，因为它不会再次显示

<img src="/docs/img/connecting-api-provider/connecting-api-provider-7.png" alt="Requesty API管理页面" width="600" />

_Requesty API管理页面，带有"创建API密钥"按钮。立即复制您的密钥 - 它只会显示一次。_

#### 选项2：直接提供商

直接访问特定模型的原提供商，完全使用其功能和特性：

##### Anthropic

1. 访问 [console.anthropic.com](https://console.anthropic.com/)
2. 注册账号或登录
3. 导航到[API密钥部分](https://console.anthropic.com/settings/keys)并创建新密钥
4. **重要：** 立即复制您的API密钥，因为它不会再次显示

<img src="/docs/img/connecting-api-provider/connecting-api-provider-5.png" alt="Anthropic控制台API密钥部分" width="600" />

_Anthropic控制台API密钥部分，带有"创建密钥"按钮。命名您的密钥，设置过期时间，并立即复制它。_

##### OpenAI

1. 访问 [platform.openai.com](https://platform.openai.com/)
2. 注册账号或登录
3. 导航到[API密钥部分](https://platform.openai.com/api-keys)并创建新密钥
4. **重要：** 立即复制您的API密钥，因为它不会再次显示

<img src="/docs/img/connecting-api-provider/connecting-api-provider-6.png" alt="OpenAI API密钥页面" width="600" />

_OpenAI平台，带有"创建新密钥"按钮。命名您的密钥并在创建后立即复制它。_

### 在VS Code中配置Kilo Code

获取API密钥后：

1. 点击VS Code侧边栏中的Kilo Code图标(<img src="/docs/img/kilo-v1.svg" width="12" />)打开Kilo Code侧边栏
2. 在欢迎界面，从下拉菜单中选择您的API提供商
3. 将API密钥粘贴到相应字段中
4. 选择您的模型：
    - 对于**OpenRouter**：选择`anthropic/claude-3.7-sonnet` ([模型详情](https://openrouter.ai/anthropic/claude-3.7-sonnet))
    - 对于**Anthropic**：选择`claude-3-7-sonnet-20250219` ([模型详情](https://www.anthropic.com/pricing#anthropic-api))
5. 点击"Let's go!"保存设置并开始使用Kilo Code
