---
title: "Native Function Calling"
description: "Overview of Kilo Code native function calling"
---

# Native Function Calling

## Context

Historically, Kilo Code has relied on XML-style function and tool definitions embedded in the system prompt to inform the model about tools available to accomplish tasks. The model was given instructions and examples about how to use these tools:

```xml
<attempt_completion>
<reason>Put your reason here</reason>
</attempt_completion>

Use this tool to signal to the user you are complete.
```

This technique was originally developed ca. 2023 and used first by Anthropic at scale. It was effective and valuable, because it allowed developers to specify arbitrary tools at runtime, rather than rely on pre-configured options from the model labs.

However, it also suffers from numerous downsides. Its effective replacement is JSON-style native function calls that are sent to the model in a dedicated field and with a strong, easily validated schema.

## Why?

1. Native function calling offers stronger reliability than older XML-style patterns because the model is explicitly trained to decide when to call a function and to return only the structured arguments that match a declared signature. This reduces the classic failure modes of XML prompts, where the model might interleave prose with markup, drop required fields, or hallucinate tag structures. With native calls, the function signature acts as a contract; the model returns arguments for that contract instead of free‑form text, which materially improves call success rates and downstream determinism.

2. Schema validation becomes first‑class with native function calls. Rather than embedding schemas in prompts and hoping the model adheres, we register a JSON‑schema‑like parameter definition alongside the function. The model’s output is constrained to those types and enums, enabling straightforward server‑side validation and clearer error handling and retries. In practice, this eliminates much of the brittle regex and heuristic cleanup common with XML prompts, and allows us to implement robust “validate → correct → retry” loops tied to explicit parameter constraints.

3. Finally, native function calls can improve cache effectiveness and throughput. Because arguments are structured and validated, equivalent calls normalize to the same payload more often than semantically similar but syntactically different XML blobs. That normalization increases cache hit rates across identical tool invocations, reducing latency and cost, and making end‑to‑end behavior more predictable when chaining multiple tools or working across providers. While XML calling can achieve 80-85% input token cache hit rates on modern models like GPT-5, native function calling can increase that to 90%+, while also achieving the stronger reliability described above.

## Downsides

There are a few considerations and challenges.

1. Model Compatibility: Not all models are trained for native function calling, especially small models below 4-7B parameters. That being said, the vast majority of models, both open and closed, released since June 2025 _do_ support native function calls.
2. Provider Compatibility: There are many OpenAI "compliant" providers on the market, using a variety of tools to support their products (often vLLM, SGLang, TensorRT-LLM). Beyond that are numerous local model tools (LM Studio, Ollama, Osaurus). Despite claiming compatibility with the OpenAI API specification, it's common to see partial or outright incorrect implementations.
