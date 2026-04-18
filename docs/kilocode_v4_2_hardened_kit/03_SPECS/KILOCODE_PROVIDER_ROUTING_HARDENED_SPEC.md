# KiloCode Provider Routing Hardened Spec

## Purpose
Route the right task to the right model and surface why.

## Route input schema
```yaml
task_type: contract|architecture|audit|execution|fallback_test|local_private|memory_check|training_orchestration
risk_level: low|medium|high
privacy_mode: local_preferred|cloud_ok
required_capabilities: [string]
```

## Route result schema
```yaml
primary_provider: claude|minimax|siliconflow|ollama|lm_studio
fallback_provider: claude|minimax|siliconflow|ollama|lm_studio|null
reason: string
blocked: false
```

## Role rules
- Claude: contract writing, architecture, audits, release verdicts
- MiniMax: execution-heavy worker tasks
- SiliconFlow: overflow and fallback
- Ollama / LM Studio: local/private tasks

## Failure modes
- missing credentials
- provider unhealthy
- wrong-role request
- fallback unavailable

## Evidence requirements
- route trace
- provider health state
- env validation state
- fallback trace where applicable
