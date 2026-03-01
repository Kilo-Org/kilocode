# Anonymous Sign-In Prompts

**Priority:** P1
**Status:** 🔨 Partial (assigned)
**Issue:** [#6082](https://github.com/Kilo-Org/kilocode/issues/6082)

## Problem

Anonymous (unauthenticated) users must be prompted to sign up when they hit usage limits:

1. When they try to use a paid/non-free model
2. When they exceed 100 messages in anonymous mode

The new extension does not yet show these prompts. Users either get a silent failure or a generic error.

## Remaining Work

- Detect when the current user is anonymous (check auth state from the CLI or extension auth service)
- Show a sign-in prompt in the chat UI when:
  - The user selects a paid model and is anonymous
  - The user sends a message and has exceeded the 100-message anonymous limit
- The prompt should explain the limit, offer a "Sign In" button that triggers the existing auth flow, and a "Dismiss" option
- Match the tone and copy from the legacy extension's equivalent prompts
- The check can be done client-side (extension knows auth state) or by intercepting a 402/403 response from the CLI

## Implementation Notes

- Auth state is available via the extension's `KiloConnectionService` or the profile endpoint
- A modal or inline banner in the chat are both reasonable UI patterns; the legacy extension used an inline banner
