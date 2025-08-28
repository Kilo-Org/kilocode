---
"kilo-code": minor
---

Include changes from Roo Code v3.25.23

- feat: add custom base URL support for Requesty provider (thanks @requesty-JohnCosta27!)
- feat: add DeepSeek V3.1 model to Chutes AI provider (#7294 by @dmarkey, PR by @app/roomote)
- Add prompt caching support for Kimi K2 on Groq (thanks @daniel-lxs and @benank!)
- Add documentation links for global custom instructions in UI (thanks @app/roomote!)
- Ensure subtask results are provided to GPT-5 in OpenAI Responses API
- Promote the experimental AssistantMessageParser to the default parser
- Update DeepSeek models context window to 128k (thanks @JuanPerezReal)
- Enable grounding features for Vertex AI (thanks @anguslees)
- Allow orchestrator to pass TODO lists to subtasks
- Improved MDM handling
- Handle nullish token values in ContextCondenseRow to prevent UI crash (thanks @s97712)
- Improved context window error handling for OpenAI and other providers
- Add "installed" filter to Marketplace (thanks @semidark)
- Improve filesystem access checks (thanks @elianiva)
- Add Featherless provider (thanks @DarinVerheijke)
