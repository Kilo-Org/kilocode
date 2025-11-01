import type { ModelInfo } from "../model.js"
import { SiliconCloudApiLine } from "../provider-settings.js"

export const siliconCloudDefaultModelId = "zai-org/GLM-4.6"
export const siliconCloudDefaultApiLine: SiliconCloudApiLine = "china"

export const siliconCloudApiLineConfigs = {
	china: { baseUrl: "https://api.siliconflow.cn/v1" },
	chinaOverseas: { baseUrl: "https://api-st.siliconflow.cn/v1" },
	international: { baseUrl: "https://api.siliconflow.com/v1" },
} satisfies Record<SiliconCloudApiLine, { baseUrl: string }>

const siliconCloudChinaModels: Record<string, ModelInfo> = {
	"Pro/deepseek-ai/DeepSeek-V3.1-Terminus": {
		contextWindow: 163840,
		inputPrice: 0.56,
		outputPrice: 2.25,
		description:
			'DeepSeek-V3.1-Terminus 是由深度求索（DeepSeek）发布的 V3.1 模型的更新版本，定位为混合智能体大语言模型。此次更新在保持模型原有能力的基础上，专注于修复用户反馈的问题并提升稳定性。它显著改善了语言一致性，减少了中英文混用和异常字符的出现。模型集成了"思考模式"（Thinking Mode）和"非思考模式"（Non-thinking Mode），用户可通过聊天模板灵活切换以适应不同任务。作为一个重要的优化，V3.1-Terminus 增强了代码智能体（Code Agent）和搜索智能体（Search Agent）的性能，使其在工具调用和执行多步复杂任务方面更加可靠',
		supportsPromptCache: false,
		supportsReasoningBudget: true,
		maxTokens: 163840,
		preferredIndex: 0,
	},
	"Pro/moonshotai/Kimi-K2-Instruct-0905": {
		contextWindow: 262144,
		inputPrice: 0.56,
		outputPrice: 2.25,
		description:
			"Kimi K2-Instruct-0905 是 Kimi K2 最新、最强大的版本。它是一款顶尖的混合专家（MoE）语言模型，拥有 1 万亿的总参数和 320 亿的激活参数。该模型的主要特性包括：增强的智能体编码智能，在公开基准测试和真实世界的编码智能体任务中表现出显著的性能提升；改进的前端编码体验，在前端编程的美观性和实用性方面均有进步",
		supportsPromptCache: false,
		preferredIndex: 1,
	},
	"zai-org/GLM-4.6": {
		contextWindow: 202752,
		inputPrice: 0.49,
		outputPrice: 1.97,
		description:
			"与 GLM-4.5 相比，GLM-4.6 带来了多项关键改进。其上下文窗口从 128K 扩展到 200K tokens，使模型能够处理更复杂的智能体任务。模型在代码基准测试中取得了更高的分数，并在 Claude Code、Cline、Roo Code 和 Kilo Code 等应用中展现了更强的真实世界性能，包括在生成视觉效果精致的前端页面方面有所改进。GLM-4.6 在推理性能上表现出明显提升，并支持在推理过程中使用工具，从而带来了更强的综合能力。它在工具使用和基于搜索的智能体方面表现更强，并且能更有效地集成到智能体框架中。在写作方面，该模型在风格和可读性上更符合人类偏好，并在角色扮演场景中表现得更自然",
		supportsPromptCache: false,
		supportsReasoningBudget: true,
		maxTokens: 202752,
		preferredIndex: 2,
	},
	"MiniMaxAI/MiniMax-M2": {
		contextWindow: 131072,
		inputPrice: 0.3,
		outputPrice: 1.18,
		description:
			"MiniMax-M2 为智能体重新定义了效率。它是一款紧凑、快速且经济高效的 MoE 模型，拥有 2300 亿总参数和 100 亿激活参数，专为编码和智能体任务的顶级性能而打造，同时保持强大的通用智能。仅需 100 亿激活参数，MiniMax-M2 就能提供当今领先模型所期望的复杂端到端工具使用性能，但其外形尺寸更为精简，使得部署和扩展比以往任何时候都更容易",
		supportsPromptCache: false,
		supportsReasoningBudget: true,
		requiredReasoningBudget: true,
		maxTokens: 131072,
		preferredIndex: 3,
	},
	"deepseek-ai/DeepSeek-V3.1-Terminus": {
		contextWindow: 163840,
		inputPrice: 0.56,
		outputPrice: 2.25,
		description:
			'DeepSeek-V3.1-Terminus 是由深度求索（DeepSeek）发布的 V3.1 模型的更新版本，定位为混合智能体大语言模型。此次更新在保持模型原有能力的基础上，专注于修复用户反馈的问题并提升稳定性。它显著改善了语言一致性，减少了中英文混用和异常字符的出现。模型集成了"思考模式"（Thinking Mode）和"非思考模式"（Non-thinking Mode），用户可通过聊天模板灵活切换以适应不同任务。作为一个重要的优化，V3.1-Terminus 增强了代码智能体（Code Agent）和搜索智能体（Search Agent）的性能，使其在工具调用和执行多步复杂任务方面更加可靠',
		supportsPromptCache: false,
		supportsReasoningBudget: true,
		maxTokens: 163840,
		preferredIndex: 4,
	},
	"moonshotai/Kimi-K2-Instruct-0905": {
		contextWindow: 262144,
		inputPrice: 0.56,
		outputPrice: 2.25,
		description:
			"Kimi K2-Instruct-0905 是 Kimi K2 最新、最强大的版本。它是一款顶尖的混合专家（MoE）语言模型，拥有 1 万亿的总参数和 320 亿的激活参数。该模型的主要特性包括：增强的智能体编码智能，在公开基准测试和真实世界的编码智能体任务中表现出显著的性能提升；改进的前端编码体验，在前端编程的美观性和实用性方面均有进步",
		supportsPromptCache: false,
		preferredIndex: 5,
	},
	"Qwen/Qwen3-VL-235B-A22B-Instruct": {
		contextWindow: 262144,
		inputPrice: 0.35,
		outputPrice: 1.4,
		description:
			"Qwen3-VL-235B-A22B-Instruct 是一个拥有 2350 亿参数的混合专家（MoE）视觉语言模型，其中激活的参数量为 220 亿。它是 Qwen3-VL-235B-A22B 的指令微调版本，专为聊天应用进行了优化。Qwen3-VL 是一系列接受文本和图像输入的多模态模型，经过大量数据训练。它在理解和推理文本与图像方面表现出先进的能力",
		supportsImages: true,
		supportsPromptCache: false,
		preferredIndex: 6,
	},
	"Qwen/Qwen3-VL-235B-A22B-Thinking": {
		contextWindow: 262144,
		inputPrice: 0.35,
		outputPrice: 1.4,
		description:
			"Qwen3-VL 是通义千问系列迄今最强大的视觉语言模型。该系列在文本理解与生成、视觉感知与推理、上下文长度、空间关系和视频动态理解以及 AI Agent 交互方面均实现了全面升级。Qwen3-VL-235B-A22B-Thinking 是该系列的旗舰模型之一，为推理增强的“思考”版本，在数学、因果分析和逻辑推理等多个多模态推理基准测试中取得了业界顶尖（SOTA）的表现。该模型是一个混合专家（MoE）架构，总参数量为 235B，激活参数量为 22B。它原生支持 256K 的上下文长度，并可扩展至 100 万，能够处理整本教科书或数小时的视频内容。此外，该模型具备强大的视觉 Agent 能力，可以操作桌面及移动端图形界面（GUI）、将草图转换为代码，并支持 3D 接地，为复杂的空间推理和具身智能应用奠定了基础",
		supportsImages: true,
		supportsPromptCache: false,
		preferredIndex: 7,
	},
	"zai-org/GLM-4.5": {
		contextWindow: 131072,
		inputPrice: 0.49,
		outputPrice: 1.97,
		description:
			"GLM-4.5 是一款专为智能体应用打造的基础模型，使用了混合专家（Mixture-of-Experts）架构。在工具调用、网页浏览、软件工程、前端编程领域进行了深度优化，支持无缝接入 Claude Code、Roo Code 等代码智能体中使用。GLM-4.5 采用混合推理模式，可以适应复杂推理和日常使用等多种应用场景",
		supportsPromptCache: false,
		supportsReasoningBudget: true,
		maxTokens: 131072,
		preferredIndex: 8,
	},
	"Qwen/Qwen3-Coder-480B-A35B-Instruct": {
		contextWindow: 262144,
		inputPrice: 1.12,
		outputPrice: 2.25,
		description:
			"Qwen3-Coder-480B-A35B-Instruct 是由阿里巴巴发布的、迄今为止最具代理（Agentic）能力的代码模型。它是一个拥有 4800 亿总参数和 350 亿激活参数的混合专家（MoE）模型，在效率和性能之间取得了平衡。该模型原生支持 256K（约 26 万） tokens 的上下文长度，并可通过 YaRN 等外推方法扩展至 100 万 tokens，使其能够处理大规模代码库和复杂的编程任务。Qwen3-Coder 专为代理式编码工作流设计，不仅能生成代码，还能与开发工具和环境自主交互，以解决复杂的编程问题。在多个编码和代理任务的基准测试中，该模型在开源模型中取得了顶尖水平，其性能可与 Claude Sonnet 4 等领先模型相媲美。此外，阿里还开源了配套的命令行工具 Qwen Code，以充分释放其强大的代理编程能力",
		supportsPromptCache: false,
		preferredIndex: 9,
	},
	"Pro/deepseek-ai/DeepSeek-R1": {
		contextWindow: 163840,
		inputPrice: 0.56,
		outputPrice: 2.25,
		description:
			"DeepSeek-R1-0528 是一款强化学习（RL）驱动的推理模型，解决了模型中的重复性和可读性问题。在 RL 之前，DeepSeek-R1 引入了冷启动数据，进一步优化了推理性能。它在数学、代码和推理任务中与 OpenAI-o1 表现相当，并且通过精心设计的训练方法，提升了整体效果",
		supportsPromptCache: false,
		supportsReasoningBudget: true,
		preferredIndex: 10,
	},
	"deepseek-ai/DeepSeek-R1": {
		contextWindow: 163840,
		inputPrice: 0.56,
		outputPrice: 2.25,
		description:
			"DeepSeek-R1-0528 是一款强化学习（RL）驱动的推理模型，解决了模型中的重复性和可读性问题。在 RL 之前，DeepSeek-R1 引入了冷启动数据，进一步优化了推理性能。它在数学、代码和推理任务中与 OpenAI-o1 表现相当，并且通过精心设计的训练方法，提升了整体效果",
		supportsPromptCache: false,
		supportsReasoningBudget: true,
		preferredIndex: 11,
	},
}

const siliconCloudInternationalModels: Record<string, ModelInfo> = {
	"zai-org/GLM-4.6": {
		...siliconCloudChinaModels["zai-org/GLM-4.6"]!,
		inputPrice: 0.5,
		outputPrice: 1.9,
		description:
			"Compared with GLM-4.5, GLM-4.6 brings several key improvements. Its context window is expanded from 128K to 200K tokens, enabling the model to handle more complex agentic tasks. The model achieves higher scores on code benchmarks and demonstrates better real-world performance in applications such as Claude Code, Cline, Roo Code and Kilo Code, including improvements in generating visually polished front-end pages. GLM-4.6 shows a clear improvement in reasoning performance and supports tool use during inference, leading to stronger overall capability. It also exhibits stronger performance in tool using and search-based agents, and integrates more effectively within agent frameworks. For writing, it better aligns with human preferences in style and readability, and performs more naturally in role-playing scenarios",
	},
	"deepseek-ai/DeepSeek-V3.1-Terminus": {
		...siliconCloudChinaModels["deepseek-ai/DeepSeek-V3.1-Terminus"]!,
		inputPrice: 0.27,
		outputPrice: 1,
		description:
			"DeepSeek-V3.1-Terminus is an updated version of the V3.1 model from DeepSeek, positioned as a hybrid, agent-oriented large language model. This update maintains the model's original capabilities while focusing on addressing user-reported issues and improving stability. It significantly enhances language consistency, reducing instances of mixed Chinese-English text and abnormal characters. The model integrates both a 'Thinking Mode' for complex, multi-step reasoning and a 'Non-thinking Mode' for direct, quick responses, switchable via the chat template. As a key enhancement, V3.1-Terminus features improved performance for its Code Agent and Search Agent, making it more reliable for tool use and executing complex, multi-step tasks",
	},
	"moonshot-ai/Kimi-K2-Instruct-0905": {
		...siliconCloudChinaModels["moonshotai/Kimi-K2-Instruct-0905"]!,
		inputPrice: 0.4,
		outputPrice: 2,
		description:
			"Kimi K2-Instruct-0905 is the latest, most capable version of Kimi K2. It is a state-of-the-art mixture-of-experts (MoE) language model, featuring 32 billion activated parameters and a total of 1 trillion parameters. Key features include enhanced agentic coding intelligence, with the model demonstrating significant improvements on public benchmarks and real-world coding agent tasks; an improved frontend coding experience, offering advancements in both the aesthetics and practicality of frontend programming",
	},
	"Qwen/Qwen3-VL-235B-A22B-Instruct": {
		...siliconCloudChinaModels["Qwen/Qwen3-VL-235B-A22B-Instruct"]!,
		inputPrice: 0.3,
		outputPrice: 1.5,
		description:
			"Qwen3-VL-235B-A22B-Instruct is a 235B parameters Mixture-of-Experts (MoE) vision-language model, with 22B activated parameters. It is an instruction-tuned version of Qwen3-VL-235B-A22B and is aligned for chat applications. Qwen3-VL is a series of multimodal models accepting both text and image inputs, and it is trained with a large amount of data. It demonstrates advanced capabilities in understanding and reasoning over text and images",
	},
	"Qwen/Qwen3-VL-235B-A22B-Thinking": {
		...siliconCloudChinaModels["Qwen/Qwen3-VL-235B-A22B-Thinking"]!,
		inputPrice: 0.45,
		outputPrice: 3.5,
		description:
			'Qwen3-VL is the most powerful vision-language model in the Qwen series to date, delivering comprehensive upgrades across text understanding and generation, visual perception and reasoning, context length, spatial and video dynamics comprehension, and agent interaction capabilities. Qwen3-VL-235B-A22B-Thinking is one of the series\' flagship models, a reasoning-enhanced "Thinking" edition that achieves state-of-the-art (SOTA) results across many multimodal reasoning benchmarks, excelling in STEM, math, causal analysis, and logical, evidence-based answers. It features a Mixture-of-Experts (MoE) architecture with 235B total parameters and 22B active parameters. The model natively supports a 262K context length, expandable to 1 million, allowing it to process entire textbooks or hours-long videos. Furthermore, it possesses strong visual agent capabilities, enabling it to operate PC/mobile GUIs, convert sketches into code, and perform 3D grounding, laying the foundation for complex spatial reasoning and embodied AI applications',
	},
	"zai-org/GLM-4.5": {
		...siliconCloudChinaModels["zai-org/GLM-4.5"]!,
		inputPrice: 0.4,
		outputPrice: 2,
		description:
			"GLM-4.5 is a foundational model specifically designed for AI agent applications, built on a Mixture-of-Experts (MoE) architecture. It has been extensively optimized for tool use, web browsing, software development, and front-end development, enabling seamless integration with coding agents such as Claude Code and Roo Code. GLM-4.5 employs a hybrid reasoning approach, allowing it to adapt effectively to a wide range of application scenarios—from complex reasoning tasks to everyday use cases",
	},
	"Qwen/Qwen3-Coder-480B-A35B-Instruct": {
		...siliconCloudChinaModels["Qwen/Qwen3-Coder-480B-A35B-Instruct"]!,
		inputPrice: 0.25,
		outputPrice: 1,
		description:
			"Qwen3-Coder-480B-A35B-Instruct is the most agentic code model released by Alibaba to date. It is a Mixture-of-Experts (MoE) model with 480 billion total parameters and 35 billion activated parameters, balancing efficiency and performance. The model natively supports a 256K (approximately 262,144) token context length, which can be extended up to 1 million tokens using extrapolation methods like YaRN, enabling it to handle repository-scale codebases and complex programming tasks. Qwen3-Coder is specifically designed for agentic coding workflows, where it not only generates code but also autonomously interacts with developer tools and environments to solve complex problems. It has achieved state-of-the-art results among open models on various coding and agentic benchmarks, with performance comparable to leading models like Claude Sonnet 4. Alongside the model, Alibaba has also open-sourced Qwen Code, a command-line tool designed to fully unleash its powerful agentic coding capabilities",
	},
	"deepseek-ai/DeepSeek-R1": {
		...siliconCloudChinaModels["deepseek-ai/DeepSeek-R1"]!,
		inputPrice: 0.5,
		outputPrice: 2.18,
		description:
			"DeepSeek-R1-0528 is a reasoning model powered by reinforcement learning (RL) that addresses the issues of repetition and readability. Prior to RL, DeepSeek-R1 incorporated cold-start data to further optimize its reasoning performance. It achieves performance comparable to OpenAI-o1 across math, code, and reasoning tasks, and through carefully designed training methods, it has enhanced overall effectiveness",
	},
	"openai/gpt-oss-120b": {
		contextWindow: 131072,
		inputPrice: 0.05,
		outputPrice: 0.45,
		description:
			"gpt-oss-120b is OpenAI's open-weight large language model with ~117B parameters (5.1B active), using a Mixture-of-Experts (MoE) design and MXFP4 quantization to run on a single 80 GB GPU. It delivers o4-mini-level or better performance in reasoning, coding, health, and math benchmarks, with full Chain-of-Thought (CoT), tool use, and Apache 2.0-licensed commercial deployment support.",
		supportsPromptCache: false,
		preferredIndex: 12,
	},
}

export const siliconCloudModelsByApiLine = {
	china: siliconCloudChinaModels,
	chinaOverseas: siliconCloudChinaModels,
	international: siliconCloudInternationalModels,
} as const satisfies Record<SiliconCloudApiLine, Record<string, ModelInfo>>

export const siliconCloudModels = {
	...siliconCloudInternationalModels,
	...siliconCloudChinaModels,
} as const satisfies Record<string, ModelInfo>

export type SiliconCloudModel = keyof typeof siliconCloudModels
