---
title: Voice Transcription
description: Dictate prompts through your signed-in Kilo account.
---

# Voice Transcription

Use voice input in prompt fields instead of typing. When the Kilo provider is enabled and you are signed in, the microphone appears automatically and transcription uses your account through Kilo Gateway.

---

## Get ready

Voice input needs FFmpeg plus access to the Kilo provider.

### Install FFmpeg

FFmpeg is required for audio capture and processing. Install it for your platform:

**macOS:**

```bash
brew install ffmpeg
```

**Linux (Ubuntu/Debian):**

```bash
sudo apt update
sudo apt install ffmpeg
```

**Windows:**
Download from [ffmpeg.org/download.html](https://ffmpeg.org/download.html) and add to your system PATH.

### Sign in

Enable and sign in to the Kilo provider to use voice input in prompt fields. Requests use your Kilo account through Kilo Gateway, so no separate OpenAI provider profile or API key is needed.

---

## Choose a model

You can optionally choose a transcription model in **Settings** > **Models** > **Speech to Text Model**. Kilo stores this choice as `experimental.speech_to_text_model` in your global Kilo CLI config (`~/.config/kilo/kilo.jsonc`).

---

## Use your own transcription service

By default the model list and the audio itself go through Kilo Gateway. To use another service, set a base URL in **Settings** > **Models** > **Speech to Text Base URL**. Any OpenAI-compatible transcription API works, including OpenAI, Groq, and a self-hosted Whisper server.

```json
{
  "experimental": {
    "speech_to_text_base_url": "https://api.openai.com/v1",
    "speech_to_text_api_key": "sk-...",
    "speech_to_text_model": "whisper-1"
  }
}
```

With a base URL set:

- The model list is read from `{base_url}/models`, and the model field accepts any ID that service exposes
- Audio is uploaded straight to `{base_url}/audio/transcriptions` as a multipart request, so it never passes through Kilo Gateway
- The API key is sent as a bearer token, and voice input works without signing in to Kilo

Leave the base URL empty to go back to Kilo Gateway.

{% callout type="warning" %}
The API key is stored as plain text in your Kilo config file. For a local server that needs no credentials, leave the key empty.
{% /callout %}

---

## Record prompts

When you are signed in to the enabled Kilo provider, a microphone button appears in prompt fields:

1. Click the microphone button to start recording
2. Speak your message clearly
3. Click again to stop recording
4. Your speech is transcribed into text

You can also use **Cmd/Ctrl+K** while a Kilo prompt or review comment field is focused. Tap it to start or stop recording, or hold it while speaking and release to transcribe and submit the focused field. Press it during transcription to cancel.

The feature includes real-time audio level visualization and voice activity detection to automatically detect when you're speaking.

---

## Review details

- **Audio processing**: Uses FFmpeg for system audio capture
- **Transcription**: Sends audio through Kilo Gateway with the selected transcription model, or straight to your own base URL when one is set

---

## Fix issues

**Microphone button not appearing:**

- Enable and sign in to the Kilo provider, or set a custom transcription base URL

**Transcription errors:**

- Confirm the Kilo provider remains enabled and signed in, or that your custom base URL and API key are correct
- For a custom base URL, confirm the service exposes `/models` and `/audio/transcriptions`
- Verify FFmpeg is installed and in your PATH
- Check your internet connection
- Try speaking more clearly or adjusting your microphone settings

---

## Know limits

Voice transcription has these requirements:

- Requires an active internet connection, unless your custom base URL points at a local service
- Requires Kilo Gateway access through your Kilo account, or a custom OpenAI-compatible base URL
- Transcription accuracy depends on audio quality and speech clarity
