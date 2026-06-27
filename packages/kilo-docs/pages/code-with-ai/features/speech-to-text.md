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

## Record prompts

When you are signed in to the enabled Kilo provider, a microphone button appears in prompt fields:

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

- Enable and sign in to the Kilo provider

**Transcription errors:**

- Confirm the Kilo provider remains enabled and signed in
- Verify FFmpeg is installed and in your PATH
- Check your internet connection
- Try speaking more clearly or adjusting your microphone settings

---

## Know limits

Voice transcription has these requirements:

- Requires an active internet connection
- Requires Kilo Gateway access through your Kilo account
- Transcription accuracy depends on audio quality and speech clarity
