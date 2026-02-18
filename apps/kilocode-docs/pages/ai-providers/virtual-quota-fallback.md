---
sidebar_label: Virtual Quota Fallback
---

# Using the Virtual Quota Fallback Provider

The Virtual Quota Fallback provider is a powerful meta-provider that allows you to configure and manage multiple API providers, automatically switching between them based on predefined usage limits and availability. This ensures you can maximize your usage of free-tier services and maintain continuous access to AI models by seamlessly falling back to other providers when one reaches its quota or encounters an error.

It's the perfect solution for users who leverage multiple LLM services and want to orchestrate them intelligently—for example, using a free provider up to its limit before automatically switching to a pay-as-you-go service.

## How It Works

The Virtual Quota Fallback provider does not connect to an LLM service directly. Instead, it acts as a manager for your other configured provider profiles.

- **Prioritized List:** You create a prioritized list of your existing provider profiles. The provider at the top of the list is used first.
- **Usage Tracking:** You can set custom limits for each provider based on the number of tokens or requests per minute, hour, or day. Kilo Code tracks the usage for each provider against these limits.
- **Automatic Fallback:** When the currently active provider exceeds one of its defined limits or returns an API error, the system automatically deactivates it temporarily and switches to the next available provider in your list.
- **Notifications:** You will receive an information message in VS Code whenever an automatic switch occurs, keeping you informed of which provider is currently active.

## Prerequisites

Before configuring this provider, you must have at least one other API provider already configured as a separate profile in Kilo Code. This provider is only useful if there are other profiles for it to manage.

## Configuration in Kilo Code

1.  **Open Kilo Code Settings:** Click the gear icon ({% codicon name="gear" /%}) in the Kilo Code panel.
2.  **Select Provider:** Choose "Virtual Quota Fallback" from the "API Provider" dropdown. This will open its dedicated configuration panel.

<!-- <img src="/docs/img/providers/virtualQuotaSelectDropdown.png" alt="virtuaQuotaFallback dropdown selection in Kilo Code settings" width="600" /> -->

3.  **Add a Provider Profile:**

    - In the configuration panel, click the **"Add Profile"** button to create a new entry in the list.
    - Click the dropdown menu on the new entry to select one of your other pre-configured provider profiles (e.g., "OpenAI", "Chutes AI Free Tier").

4.  **Set Usage Limits (Optional):**

    - Once a profile is added, you can specify usage limits. If you leave these fields blank, no limit will be enforced for that specific metric.
    - **Tokens per minute/hour/day:** Limits usage based on the total number of tokens processed (input + output).
    - **Requests per minute/hour/day:** Limits the total number of API calls made.

5.  **Order Your Providers:**

    - The order of the profiles is crucial, as it defines the fallback priority. The provider at the top is used first.
    - Use the **up and down arrows** next to each profile to change its position in the list.

6.  **Add More Providers:** Repeat steps 3-5 to build your complete fallback chain. You can add as many profiles as you have configured.

<!-- <img src="/docs/img/providers/virtualQuotaFullConfig.png" alt="virtuaQuotaFallback configuration in Kilo Code settings" width="600" /> -->

## Usage Monitoring

The configuration screen also serves as a dashboard for monitoring the current usage of each provider in your list.

- You can see the tokens and requests used within the last minute, hour, and day.
- If you need to reset these counters, click the **"Clear Usage Data"** button. This will reset all statistics to zero and immediately re-enable any providers that were temporarily disabled due to exceeding their limits.

## Example Use Case

Imagine you have two profiles configured:

1.  **Chutes AI Free:** A free-tier provider with a limit of 5,000 tokens per hour.
2.  **OpenAI Paid:** Your personal pay-as-you-go OpenAI account.

**Configuration:**

- Place "Chutes AI Free" first in the list.
- Set its "Tokens per hour" limit to `5000`.
- Place "OpenAI Paid" second in the list, with no limits defined.

**Result:**
Kilo Code will send all requests to Chutes AI. Once your usage exceeds 5,000 tokens within an hour, it will automatically switch to your OpenAI account. The system will switch back to Chutes AI in the next hour when its quota window has reset.

## Tips and Notes

- **Priority is Key:** Always double-check the order of your profiles. The intended primary or free-tier providers should be at the top.
- **Error-Based Fallback:** If you don't set any limits for a profile, fallback will only occur if the provider's API returns an error (e.g., a hard rate limit from the service itself, a network issue, or an invalid API key).
- **No Nesting:** You cannot select another "Virtual Quota Fallback" profile within this provider's configuration, as this would create a circular dependency.
