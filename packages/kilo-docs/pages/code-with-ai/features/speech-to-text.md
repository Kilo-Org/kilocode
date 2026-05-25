---
title: Voice Transcription
description: Dictate prompts through your signed-in Kilo account.
---

# Voice Transcription

{% callout type="warning" title="Experimental feature" %}
Speech to Text is experimental. Expect issues and changes as it matures.
{% /callout %}

Use voice input in prompt fields instead of typing. Transcription uses your Kilo account through Kilo Gateway.

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

## Enable input

Voice input is experimental and must be enabled:

1. Open Kilo Code settings
2. Open **Experimental** settings
3. Enable the **Speech to Text** experiment

Kilo stores this toggle in your global Kilo CLI config (`~/.config/kilo/kilo.jsonc`), not VS Code user settings:

```json
{
  "experimental": {
    "speech_to_text": true
  }
}
```

---

## Record prompts

Once enabled, a microphone button appears in prompt fields:

1. Click the microphone button to start recording
2. Speak your message clearly
3. Click again to stop recording
4. Your speech is transcribed into text

The feature includes real-time audio level visualization and voice activity detection to automatically detect when you're speaking.

---

## Review details

- **Audio processing**: Uses FFmpeg for system audio capture
- **Transcription**: Sends audio through Kilo Gateway with the selected transcription model

---

## Fix issues

**Microphone button not appearing:**

- Ensure the Speech to Text experiment is enabled
- Verify FFmpeg is installed and in your PATH
- Enable and sign in to the Kilo provider

**Transcription errors:**

- Confirm the Kilo provider remains enabled and signed in
- Check your internet connection
- Try speaking more clearly or adjusting your microphone settings

---

## Know limits

Speech to Text is experimental and may have limitations:

- Requires an active internet connection
- Requires Kilo Gateway access through your Kilo account
- Transcription accuracy depends on audio quality and speech clarity
