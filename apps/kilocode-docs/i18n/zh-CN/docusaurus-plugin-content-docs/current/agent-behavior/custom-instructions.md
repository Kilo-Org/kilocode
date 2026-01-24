# 自定义指令

自定义指令允许你个性化 Kilo Code 的行为，提供特定的指导来塑造响应、编码风格和决策过程。

## 什么是自定义指令？

自定义指令定义了扩展的特定行为、偏好和约束，超出了 Kilo 的基本角色定义。示例包括编码风格、文档标准、测试要求和工作流指南。

:::info 自定义指令 vs 规则
自定义指令是 IDE 范围的，适用于所有工作区，无论你在处理哪个项目，都会保持你的偏好。与指令不同，[自定义规则](/agent-behavior/custom-rules) 是项目特定的，允许你设置基于工作区的规则集。
:::

## 设置自定义指令

**如何设置：**

<img src="/docs/img/custom-instructions/custom-instructions.png" alt="Kilo Code 提示标签显示全局自定义指令界面" width="600" />
1.  **打开提示标签：** 点击 Kilo Code 顶部菜单栏中的 <Codicon name="notebook" /> 图标
2.  **找到部分：** 找到 "所有模式的自定义指令" 部分
3.  **输入指令：** 在文本区域输入你的指令
4.  **保存更改：** 点击 "完成" 保存你的更改

#### 模式特定指令

模式特定指令可以使用提示标签设置

    <img src="/docs/img/custom-instructions/custom-instructions-3.png" alt="Kilo Code 提示标签显示模式特定自定义指令界面" width="600" />
    * **打开标签：** 点击 Kilo Code 顶部菜单栏中的 <Codicon name="notebook" /> 图标
    * **选择模式：** 在模式标题下，点击你想要自定义的模式按钮
    * **输入指令：** 在 "模式特定自定义指令（可选）" 下的文本区域输入你的指令
    * **保存更改：** 点击 "完成" 保存你的更改

        :::info 全局模式规则
        如果模式本身是全局的（非工作区特定），你为其设置的任何自定义指令也将全局适用于所有工作区的该模式。
        :::

## 相关功能

- [自定义模式](/agent-behavior/custom-modes)
- [自定义规则](/agent-behavior/custom-rules)
- [设置管理](/basic-usage/settings-management)
- [自动批准设置](/features/auto-approving-actions)
