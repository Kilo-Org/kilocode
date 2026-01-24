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

## What

Kilo Code recently implemented _experimental_ support for native function calling in 4.106.0.

## Why?

1. Native function calling offers stronger reliability than older XML-style patterns because the model is explicitly trained to decide when to call a function and to return only the structured arguments that match a declared signature. This reduces the classic failure modes of XML prompts, where the model might interleave prose with markup, drop required fields, or hallucinate tag structures. With native calls, the function signature acts as a contract; the model returns arguments for that contract instead of free‑form text, which materially improves call success rates and downstream determinism.

2. Schema validation becomes first‑class with native function calls. Rather than embedding schemas in prompts and hoping the model adheres, we register a JSON‑schema‑like parameter definition alongside the function. The model’s output is constrained to those types and enums, enabling straightforward server‑side validation and clearer error handling and retries. In practice, this eliminates much of the brittle regex and heuristic cleanup common with XML prompts, and allows us to implement robust “validate → correct → retry” loops tied to explicit parameter constraints.

3. Finally, native function calls can improve cache effectiveness and throughput. Because arguments are structured and validated, equivalent calls normalize to the same payload more often than semantically similar but syntactically different XML blobs. That normalization increases cache hit rates across identical tool invocations, reducing latency and cost, and making end‑to‑end behavior more predictable when chaining multiple tools or working across providers. While XML calling can achieve 80-85% input token cache hit rates on modern models like GPT-5, native function calling can increase that to 90%+, while also achieving the stronger reliability described above.

## Downsides

There are a few considerations and challenges.

1. Model Compatability: Not all models are trained for native function calling, especially small models below 4-7B parameters. That being said, the vast majority of models, both open and closed, released since June 2025 _do_ support native function calls.
2. Provider Compatability: There are many OpenAI "compliant" providers on the market, using a variety of tools to support their products (often vLLM, SGLang, TensorRT-LLM). Beyond that are numerous local model tools (LM Studio, Ollama, Osaurus). Despite claiming compatability with the OpenAI API specification, its common to see partial or outright incorrect implementations.

Because of these risks and considerations, this capability is experiment, and off by default for nearly all models and providers.

## Use

To enable and use native function calling, consider and perform the following:

1. Ensure you are using a provider that has been enabled in Kilo Code for this experiment. As of Oct 21, 2025, they include:

- OpenRouter
- Kilo Code
- LM Studio
- OpenAI Compatible
- Z.ai
- Synthetic
- X.ai
- Chutes

By default, native function calling is _disabled_ for most models. Should you wish to try it, open the Advanced settings for a given provider profile that is included in the testing group.

Change the Tool Calling Style to `JSON`, and save the profile.

## Caveats

This feature is currently experimental and mostly intended for users interested in contributing to its development.

There are possible issues including, but not limited to:

- ~~Missing tools~~: As of Oct 21, all tools are supported
- Tools calls not updating the UI until they are complete
- ~~MCP servers not working~~: As of Oct 21, MCPs are supported
- Errors specific to certain inference providers
    - Not all inference providers use servers that are fully compatible with the OpenAI specification. As a result, behavior will vary, even with the same model across providers.

While nearly any provider can be configured via the OpenAI Compatible profile, testers should be aware that this is enabled purely for ease of testing and should be prepared to experience unexpected responses from providers that are not prepared to handle native function calls.
