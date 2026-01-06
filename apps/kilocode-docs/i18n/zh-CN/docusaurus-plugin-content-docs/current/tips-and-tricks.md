# 技巧与窍门

一些快速提示，帮助你充分利用 Kilo Code。

- 将 Kilo Code 拖到[侧边栏](https://code.visualstudio.com/api/ux-guidelines/sidebars#secondary-sidebar)，以便同时查看资源管理器、搜索、源代码控制等。
- 当 Kilo Code 位于与文件资源管理器分开的侧边栏时，你可以将文件从资源管理器拖到聊天窗口中（甚至可以一次拖多个文件）。只需在开始拖动文件后按住 shift 键。
- 如果你不使用[MCP](/features/mcp/overview)，请在 <Codicon name="notebook" /> 提示选项卡中关闭它，以显著减少系统提示的大小。
- 为了保持[自定义模式](/agent-behavior/custom-modes)的正轨，请限制它们可以编辑的文件类型。
- 如果你遇到`input length and max tokens exceed context limit`错误，可以通过删除消息、回滚到之前的检查点或切换到具有长上下文窗口的模型（如 Gemini）来恢复。
- 一般来说，对于思考模型的`Max Tokens`设置要深思熟虑。你分配的每个 token 都会占用存储对话历史的空间。考虑仅在 Architect 和 Debug 等模式中使用高`Max Tokens` / `Max Thinking Tokens`设置，并将 Code 模式保持在 16k max tokens 或更少。
- 如果有一个你希望自定义模式完成的任务的真实职位发布，可以尝试要求 Code 模式`根据@[url]的职位发布创建一个自定义模式`。
- 如果你想真正加速，可以检出多个代码库副本并在所有副本上并行运行 Kilo Code（使用 git 解决任何冲突，与人类开发人员相同）。
- 使用 Debug 模式时，要求 Kilo "在 Debug 模式下启动一个新任务，包含解决 X 所需的所有必要上下文"，以便调试过程使用其自己的上下文窗口，而不会污染主任务。
- 点击下方的"编辑此页面"添加你自己的技巧！
- 为了管理大文件并减少上下文/资源使用，请调整`File read auto-truncate threshold`设置。此设置控制一次读取文件的行数。较低的值可以提高处理非常大文件时的性能，但可能需要更多的读取操作。你可以在 Kilo Code 设置的"高级设置"中找到此设置。

| 浏览器标签页                                                                                                                          | 自动批准标签页                                                                                                                        | 显示标签页                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| [![KiloCode Demo 1](https://img.youtube.com/vi/VMPKXt8k050/maxresdefault.jpg)](https://youtube.com/shorts/VMPKXt8k050?feature=shared) | [![KiloCode Demo 2](https://img.youtube.com/vi/NBccFnYDQ-k/maxresdefault.jpg)](https://youtube.com/shorts/NBccFnYDQ-k?feature=shared) | [![KiloCode Demo 3](https://img.youtube.com/vi/qYrT2pbfS7E/maxresdefault.jpg)](https://youtube.com/shorts/qYrT2pbfS7E?feature=shared) |
