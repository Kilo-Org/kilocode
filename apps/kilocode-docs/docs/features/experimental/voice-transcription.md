# Voice Transcription

Kilo Code now includes experimental support for voice input in the chat interface. This feature allows you to dictate your messages using speech-to-text (STT) technology powered by OpenAI's Whisper API.

## Prerequisites

Voice transcription requires two components to be set up:

### 1. FFmpeg Installation

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

### 2. OpenAI API Key

Voice transcription uses OpenAI's Whisper API for speech recognition. You need an OpenAI API configuration in Kilo Code:

1. Configure an OpenAI provider profile in Kilo Code settings
2. Add your OpenAI API key to the profile
3. Either **OpenAI** or **OpenAI Native** provider types will work

## Enabling Voice Transcription

Voice transcription is an experimental feature that must be enabled:

1. Open Kilo Code settings
2. Navigate to **Experimental Features**
3. Enable the **Speech to Text** experiment

## Using Voice Input

Once configured and enabled, a microphone button will appear in the chat input area:

1. Click the microphone button to start recording
2. Speak your message clearly
3. Click again to stop recording
4. Your speech will be automatically transcribed into text

The feature includes real-time audio level visualization and voice activity detection to automatically detect when you're speaking.

## Technical Details

- **Audio Processing**: Uses FFmpeg for system audio capture
- **Voice Recognition**: OpenAI Whisper API for transcription

## Troubleshooting

**Microphone button not appearing:**

- Ensure the Speech to Text experiment is enabled
- Verify FFmpeg is installed and in your PATH
- Check that you have an OpenAI provider configured with a valid API key

**Transcription errors:**

- Verify your OpenAI API key is valid and has available credits
- Check your internet connection
- Try speaking more clearly or adjusting your microphone settings

## Limitations

This feature is currently experimental and may have limitations:

- Requires active internet connection
- Uses OpenAI API credits based on audio duration
- Transcription accuracy depends on audio quality and speech clarity
