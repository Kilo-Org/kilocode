---
sidebar_label: AWS Bedrock
---

# 在Kilo Code中使用AWS Bedrock

Kilo Code支持通过Amazon Bedrock访问模型，这是一个完全托管的服务，通过单一API提供来自领先AI公司的高性能基础模型(FMs)。

**官网:** [https://aws.amazon.com/bedrock/](https://aws.amazon.com/bedrock/)

## 前提条件

- **AWS账户:** 需要有效的AWS账户
- **Bedrock访问权限:** 必须申请并获得Amazon Bedrock的访问权限。详见[AWS Bedrock文档](https://docs.aws.amazon.com/bedrock/latest/userguide/getting-started.html)
- **模型访问权限:** 需要在Bedrock中申请使用特定模型(如Anthropic Claude)的权限
- **安装AWS CLI:** 使用AWS CLI配置账户认证
    ```bash
     aws configure
    ```

## 获取凭证

有两种主要配置方式：

1.  **AWS访问密钥(推荐用于开发):**
    - 创建具有必要权限的IAM用户(至少需要`bedrock:InvokeModel`)
    - 生成该用户的访问密钥ID和秘密访问密钥
    - (可选)根据IAM配置需要创建会话令牌
2.  **AWS配置文件:**
    - 使用AWS CLI或手动编辑AWS凭证文件配置配置文件。详见[AWS CLI文档](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-profiles.html)

## 支持的模型

根据源代码，Kilo Code支持通过Bedrock访问以下模型：

- **Amazon:**
    - `amazon.nova-pro-v1:0`
    - `amazon.nova-pro-latency-optimized-v1:0`
    - `amazon.nova-lite-v1:0`
    - `amazon.nova-micro-v1:0`
    - `amazon.titan-text-lite-v1:0`
    - `amazon.titan-text-express-v1:0`
    - `amazon.titan-text-embeddings-v1:0`
    - `amazon.titan-text-embeddings-v2:0`
- **Anthropic:**
    - `anthropic.claude-3-7-sonnet-20250219-v1:0`
    - `anthropic.claude-3-5-sonnet-20241022-v2:0`
    - `anthropic.claude-3-5-haiku-20241022-v1:0`
    - `anthropic.claude-3-5-sonnet-20240620-v1:0`
    - `anthropic.claude-3-opus-20240229-v1:0`
    - `anthropic.claude-3-sonnet-20240229-v1:0`
    - `anthropic.claude-3-haiku-20240307-v1:0`
    - `anthropic.claude-2-1-v1:0`
    - `anthropic.claude-2-0-v1:0`
    - `anthropic.claude-instant-v1:0`
- **DeepSeek:**
    - `deepseek.r1-v1:0`
- **Meta:**
    - `meta.llama3-3-70b-instruct-v1:0`
    - `meta.llama3-2-90b-instruct-v1:0`
    - `meta.llama3-2-11b-instruct-v1:0`
    - `meta.llama3-2-3b-instruct-v1:0`
    - `meta.llama3-2-1b-instruct-v1:0`
    - `meta.llama3-1-405b-instruct-v1:0`
    - `meta.llama3-1-70b-instruct-v1:0`
    - `meta.llama3-1-70b-instruct-latency-optimized-v1:0`
    - `meta.llama3-1-8b-instruct-v1:0`
    - `meta.llama3-70b-instruct-v1:0`
    - `meta.llama3-8b-instruct-v1:0`

请参考[Amazon Bedrock文档](https://docs.aws.amazon.com/bedrock/latest/userguide/models-supported.html)获取最新可用模型及其ID列表。配置Kilo Code时请使用*模型ID*而非模型名称。

## 在Kilo Code中配置

1.  **打开Kilo Code设置:** 点击Kilo Code面板中的齿轮图标(<Codicon name="gear" />)
2.  **选择提供商:** 在"API Provider"下拉菜单中选择"Bedrock"
3.  **选择认证方式:**
    - **AWS凭证:**
        - 输入"AWS Access Key"和"AWS Secret Key"
        - (可选)如果使用临时凭证，输入"AWS Session Token"
    - **AWS配置文件:**
        - 输入AWS配置文件名称(如"default")
4.  **选择区域:** 选择Bedrock服务可用的AWS区域(如"us-east-1")
5.  **(可选)跨区域推理:** 如果要访问与配置的AWS区域不同的区域中的模型，请勾选"Use cross-region inference"
6.  **选择模型:** 从"Model"下拉菜单中选择所需模型

## 提示与注意事项

- **权限:** 确保IAM用户或角色具有调用Bedrock模型所需的权限，需要`bedrock:InvokeModel`权限
- **定价:** 参考[Amazon Bedrock定价](https://aws.amazon.com/bedrock/pricing/)页面了解模型费用详情
- **跨区域推理:** 使用跨区域推理可能会导致延迟增加
