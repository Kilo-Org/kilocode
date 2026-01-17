# API Providers - AWS Bedrock

**Quick Navigation for AI Agents**

---

## Overview

AWS Bedrock provider. Access Claude, Llama, Mistral, and other models via AWS.

**Source Location**: `src/api/providers/bedrock.ts`

---

## Available Models

### Claude (Anthropic)
| Model | ID |
|-------|-----|
| Claude 3.5 Sonnet | `anthropic.claude-3-5-sonnet-20241022-v2:0` |
| Claude 3 Opus | `anthropic.claude-3-opus-20240229-v1:0` |
| Claude 3 Haiku | `anthropic.claude-3-haiku-20240307-v1:0` |

### Llama (Meta)
| Model | ID |
|-------|-----|
| Llama 3.1 70B | `meta.llama3-1-70b-instruct-v1:0` |
| Llama 3.1 8B | `meta.llama3-1-8b-instruct-v1:0` |

### Mistral
| Model | ID |
|-------|-----|
| Mistral Large | `mistral.mistral-large-2407-v1:0` |

---

## Configuration

| Setting | Type | Description |
|---------|------|-------------|
| region | string | AWS region |
| accessKeyId | string | AWS access key |
| secretAccessKey | string | AWS secret key |
| model | string | Model ID |

---

## Authentication

Supports:
- IAM credentials (access key + secret)
- IAM roles (for EC2/Lambda)
- AWS SSO profiles

---

## Features

- **Cross-Region**: Access models across regions
- **Provisioned Throughput**: Dedicated capacity
- **Model Customization**: Fine-tuned models

---

[← Back to API Providers](../../Feature-Index.md)
