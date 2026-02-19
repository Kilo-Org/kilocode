---
title: "Model Access Controls"
description: "Control which AI models your team can access"
---

# Model Access Controls

**Model Access** lets organization admins control which AI models and providers are available to team members.
Admins can **enable or disable** specific models, filter by attributes, and enforce organizational data policies.

## Managing Model Access

1. Navigate to the **Model Access** tab of the Enterprise Dashboard.
2. Toggle the checkbox beside any model or provider to enable or disable access.
3. Click "Save Changes" to apply

{% image width="800" alt="Model-Access-Select" src="https://github.com/user-attachments/assets/af71353d-facc-4d4b-a0cd-c7f2cea73e97" /%}

## Filtering Models

You can filter available models by:

| Filter                        | Description                                                                 |
| ----------------------------- | --------------------------------------------------------------------------- |
| **Data Policy**               | Choose models that meet specific data retention or compliance requirements. |
| **Provider Location**         | Restrict models hosted in certain geographic regions.                       |
| **Series**                    | Filter by model family (e.g. GPT-4, Claude 3, Gemini 1.5).                  |
| **Provider**                  | Limit access to specific providers like OpenAI, Anthropic, or Google.       |
| **Input / Output Modalities** | Filter by capabilities (text, code, image, audio, etc.).                    |
| **Pricing**                   | Compare cost per token or usage tier.                                       |

Select multiple filters for increased granularity.

---

## Example Use Cases

- **Security-first teams**: Disable models that store prompts or operate outside your data region.
- **Cost control**: Limit access to higher-priced models.
- **Specialization**: Enable models that are optimized for specific tasks.

---

## Notes

- Only **Admins** and **Owners** can modify model access.
- Updates propagate to all team members within seconds.
- Individual users cannot override organization-level restrictions.
