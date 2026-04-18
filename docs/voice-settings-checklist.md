# Voice/Speech Settings Checklist

After installing updates or fresh installs, verify these settings are enabled for text-to-speech to work.

## ⚠️ VS Code Native Setting (Required FIRST)

Before anything else, VS Code has a **built-in native speech setting** that must be enabled:

| Setting                          | Required Value | How to Find                                                        |
| -------------------------------- | -------------- | ------------------------------------------------------------------ |
| `speech.speechSynthesis.enabled` | `true`         | VS Code Settings → search `speech.speechSynthesis` → check the box |

This is a **VS Code setting**, not a Kilo Code setting. If this is off, no extension can use text-to-speech.

## Required Settings (Kilo Code)

| Setting                          | Required Value | Description                               |
| -------------------------------- | -------------- | ----------------------------------------- |
| `kilo-code.new.speech.enabled`   | `true`         | Master toggle for Kilo Code voice feature |
| `kilo-code.new.speech.autoSpeak` | `true`         | Auto-speak assistant replies              |

## Optional (but recommended)

| Setting                                | Default   | Description                       |
| -------------------------------------- | --------- | --------------------------------- |
| `kilo-code.new.speech.provider`        | `browser` | Use OS voices (free, no API key)  |
| `kilo-code.new.speech.volume`          | `80`      | Output volume (0-100)             |
| `kilo-code.new.speech.interruptOnType` | `true`    | Stop speech when you start typing |

## How to Verify All Settings

### Step 1: VS Code Native Speech (MUST be first)

1. Open VS Code Settings (`Ctrl+Shift+P` → "Preferences: Open Settings")
2. Search: `speech.speechSynthesis`
3. Ensure **Speech Synthesis** → **Enabled** is checked

### Step 2: Kilo Code Speech Settings

1. Open VS Code Settings
2. Search: `kilo-code.new.speech`
3. Verify:
   - [ ] **Enabled** is checked
   - [ ] **Auto Speak** is checked
   - [ ] **Provider** is set to `browser` (for free OS voices — no API key needed)

## Using External Providers (optional)

If using a provider other than `browser`, additional settings are required:

| Provider     | Required Settings                                                                                                             |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Azure        | `kilo-code.new.speech.azure.apiKey` + `kilo-code.new.speech.azure.region`                                                     |
| Google       | `kilo-code.new.speech.google.apiKey`                                                                                          |
| OpenAI       | `kilo-code.new.speech.openai.apiKey`                                                                                          |
| ElevenLabs   | `kilo-code.new.speech.elevenlabs.apiKey`                                                                                      |
| Amazon Polly | `kilo-code.new.speech.polly.accessKeyId` + `kilo-code.new.speech.polly.secretAccessKey` + `kilo-code.new.speech.polly.region` |

## Troubleshooting

If voice still doesn't work after enabling all settings above:

1. **Reload window**: Run "Developer: Reload Window" from Command Palette (settings may not take effect until reload)
2. **Enable debug mode**: Set `kilo-code.new.speech.debugMode` to `true`, then open webview developer tools ("Developer: Open Webview Developer Tools") and check the Console for speech-related logs
3. **Check audio output**: Ensure your system has a default audio output device and it's not muted
4. **Try browser provider**: If using Azure/Google/OpenAI provider, switch to `browser` provider to test with OS voices
5. **Check for conflicting extensions**: Other extensions that override `speech.*` settings may conflict
