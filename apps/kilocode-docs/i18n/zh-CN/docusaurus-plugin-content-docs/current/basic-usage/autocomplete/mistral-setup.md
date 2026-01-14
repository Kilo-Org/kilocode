---
title: 设置 Mistral 免费自动补全
sidebar_position: 1
---

# 设置 Mistral 免费自动补全

本指南将引导您在 Kilo Code 中设置 Mistral 的 Codestral 模型以获得免费的自动补全功能。Mistral 提供免费套餐，非常适合开始使用 AI 驱动的代码补全。

## 视频教程

<video controls width="100%">
  <source src="/docs/videos/configure_free_codestral.mp4" type="video/mp4" />
  您的浏览器不支持视频标签。
</video>

## 步骤 1：打开 Kilo Code 设置

在 VS Code 中，打开 Kilo Code 面板，点击右上角的**设置**图标（齿轮）。

![打开 Kilo Code 设置](./mistral-setup/01-open-kilo-code-settings.png)

## 步骤 2：添加新的配置文件

导航到**设置 → 提供商**，点击**添加配置文件**为 Mistral 创建新的配置文件。

![添加配置文件](./mistral-setup/02-add-configuration-profile.png)

## 步骤 3：命名您的配置文件

在"新建配置文件"对话框中，输入名称如"Mistral profile"（名称可以是您喜欢的任何内容），然后点击**创建配置文件**。

:::note
配置文件名称只是供您参考的标签——它不会影响功能。选择任何有助于您识别此配置的名称。
:::

![创建 Mistral 配置文件](./mistral-setup/03-name-your-profile.png)

## 步骤 4：选择 Mistral 作为提供商

在 **API 提供商**下拉菜单中，搜索并选择 **Mistral**。

:::note
创建自动补全配置文件时，您无需选择特定模型——Kilo Code 将自动使用为代码补全优化的适当 Codestral 模型。
:::

![选择 Mistral 提供商](./mistral-setup/04-select-mistral-provider.png)

## 步骤 5：获取您的 API 密钥

您会看到需要有效 API 密钥的警告。点击**获取 Mistral / Codestral API 密钥**打开 Mistral 控制台。

![获取 API 密钥按钮](./mistral-setup/05-get-api-key.png)

## 步骤 6：在 Mistral AI Studio 中导航到 Codestral

在 Mistral AI Studio 侧边栏中，点击代码部分下的 **Codestral**。

![选择 Codestral](./mistral-setup/06-navigate-to-codestral.png)

## 步骤 7：生成 API 密钥

点击**生成 API 密钥**按钮创建您的新 Codestral API 密钥。

![确认生成](./mistral-setup/07-confirm-key-generation.png)

## 步骤 8：复制您的 API 密钥

生成后，点击 API 密钥旁边的**复制**按钮将其复制到剪贴板。

![复制 API 密钥](./mistral-setup/08-copy-api-key.png)

## 步骤 9：在 Kilo Code 中粘贴 API 密钥

返回 Kilo Code 设置，将您的 API 密钥粘贴到 **Mistral API 密钥**字段中。

![粘贴 API 密钥](./mistral-setup/09-paste-api-key.png)

## 步骤 10：保存您的设置

点击**保存**应用您的 Mistral 配置。现在您可以使用免费的自动补全了！

![保存设置](./mistral-setup/10-save-settings.png)

## 后续步骤

- 了解更多关于[自动补全功能](./index.md)
- 探索自动补全的[触发选项](./index.md#triggering-options)
- 查看[最佳实践](./index.md#best-practices)以获得最佳效果
