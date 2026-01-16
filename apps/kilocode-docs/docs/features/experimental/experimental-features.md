# Experimental Features

Kilo Code includes experimental features that are still under development. These features may be unstable, change significantly, or be removed in future versions. Use them with caution and be aware that they may not work as expected.

**Warning:** Experimental features may have unexpected behavior, including potential data loss or security vulnerabilities. Enable them at your own risk.

## Enabling Experimental Features

To enable or disable experimental features:

1.  Open the Kilo Code settings (<Codicon name="gear" /> icon in the top right corner).
2.  Go to the "Advanced Settings" section.
3.  Find the "Experimental Features" section.
4.  Check or uncheck the boxes for the features you want to enable or disable.
5.  Click "Done" to save your changes.

## Current Experimental Features

The following experimental features are currently available:

## Native Function Calling

When enabled, native JSON function calling improves reliability via explicit signatures, first‑class schema validation, and better cache hit rates due to normalized structured arguments.

It replaces brittle XML-style prompts that risk mixed prose/markup, missing fields, and regex-heavy cleanup, yielding more deterministic tool use and clearer error handling.

[More details are available](native-function-calling)

## Voice Transcription

When enabled, voice transcription allows you to dictate messages using speech-to-text in the chat interface. Powered by OpenAI's Whisper API and FFmpeg for audio capture.

[More details are available](voice-transcription)

## Concurrent file edits

When enabled, Kilo Code can edit multiple files in a single request. When disabled, Kilo Code must edit one file at a time. Disabling this can help when working with less capable models or when you want more control over file modifications.

### Power Steering

When enabled, Kilo Code will remind the model about the details of its current mode definition more frequently. This will lead to stronger adherence to role definitions and custom instructions, but will use more tokens per message.

## Providing Feedback

If you encounter any issues with experimental features, or if you have suggestions for improvements, please report them on the [Kilo Code Code GitHub Issues page](https://github.com/Kilo-Org/kilocode) or join our [Discord server](https://kilo.ai/discord) where we have channels dedciated to many experimental features.

Your feedback is valuable and helps us improve Kilo Code!
