package model

import (
	"encoding/json"
	"fmt"
)

type Config struct {
	Provider         string `json:"provider"`
	APIBase          string `json:"apiBase"`
	DefaultModel     string `json:"defaultModel"`
	SmallModel       string `json:"smallModel,omitempty"`
	FallbackProvider string `json:"fallbackProvider,omitempty"`
	ApiKeyEnv        string `json:"apiKeyEnv,omitempty"`
}

const defaultKeyEnv = "KILO_CUSTOM_API_KEY"

func validEnv(raw string) bool {
	if raw == "" {
		return true
	}
	if len(raw) > 64 {
		return false
	}
	for i, c := range raw {
		if i == 0 {
			if c < 'A' || c > 'Z' {
				return false
			}
			continue
		}
		if (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' {
			continue
		}
		return false
	}
	return true
}

func keyEnvRef(cfg Config) string {
	name := cfg.ApiKeyEnv
	if name == "" {
		name = defaultKeyEnv
	}
	return fmt.Sprintf("{env:%s}", name)
}

type preset struct {
	providerID string
	models     map[string]map[string]any
}

var presets = map[string]preset{
	"deepseek": {
		providerID: "deepseek",
		models: map[string]map[string]any{
			"deepseek-v4-pro": {
				"name": "DeepSeek V4 Pro", "tool_call": true,
				"limit": map[string]int{"context": 128000, "output": 8192},
			},
			"deepseek-v4-flash": {
				"name": "DeepSeek V4 Flash", "tool_call": true,
				"limit": map[string]int{"context": 128000, "output": 8192},
			},
		},
	},
	"qwen": {
		providerID: "qwen",
		models: map[string]map[string]any{
			"qwen-plus": {
				"name": "Qwen Plus", "tool_call": true,
				"limit": map[string]int{"context": 128000, "output": 8192},
			},
			"qwen-turbo": {
				"name": "Qwen Turbo", "tool_call": true,
				"limit": map[string]int{"context": 128000, "output": 8192},
			},
		},
	},
	"glm": {
		providerID: "glm",
		models: map[string]map[string]any{
			"glm-4-plus": {
				"name": "GLM-4 Plus", "tool_call": true,
				"limit": map[string]int{"context": 128000, "output": 8192},
			},
			"glm-4-flash": {
				"name": "GLM-4 Flash", "tool_call": true,
				"limit": map[string]int{"context": 128000, "output": 8192},
			},
		},
	},
	"minimax": {
		providerID: "minimax",
		models: map[string]map[string]any{
			"MiniMax-Text-01": {
				"name": "MiniMax Text 01", "tool_call": true,
				"limit": map[string]int{"context": 128000, "output": 8192},
			},
			"abab6.5s-chat": {
				"name": "abab6.5s-chat", "tool_call": true,
				"limit": map[string]int{"context": 128000, "output": 8192},
			},
		},
	},
}

func defaultBase(provider string) string {
	switch provider {
	case "deepseek":
		return "https://api.deepseek.com/v1"
	case "qwen":
		return "https://dashscope.aliyuncs.com/compatible-mode/v1"
	case "glm":
		return "https://open.bigmodel.cn/api/paas/v4"
	case "minimax":
		return "https://api.minimax.chat/v1"
	default:
		return ""
	}
}

func Translate(cfg Config) ([]byte, error) {
	preset, ok := presets[cfg.Provider]
	if !ok {
		return nil, fmt.Errorf("unknown_provider: %s", cfg.Provider)
	}
	base := cfg.APIBase
	if base == "" {
		base = defaultBase(cfg.Provider)
	}
	if cfg.DefaultModel == "" {
		return nil, fmt.Errorf("missing_default_model")
	}
	small := cfg.SmallModel
	if small == "" {
		small = cfg.DefaultModel
	}
	enabled := []string{preset.providerID}
	doc := map[string]any{
		"$schema":            "https://app.kilo.ai/config.json",
		"model":              fmt.Sprintf("%s/%s", preset.providerID, cfg.DefaultModel),
		"small_model":        fmt.Sprintf("%s/%s", preset.providerID, small),
		"default_agent":      "ask",
		"enabled_providers":  enabled,
		"disabled_providers": []string{"kilo"},
		"compaction": map[string]any{
			"auto": false, "threshold_percent": 85,
		},
		"permission": map[string]string{"suggest": "deny"},
		"experimental": map[string]bool{"continue_loop_on_deny": false},
		"provider": map[string]any{
			preset.providerID: map[string]any{
				"name": preset.providerID,
				"npm":  "@ai-sdk/openai-compatible",
				"api":  base,
				"options": map[string]string{
					"apiKey":  keyEnvRef(cfg),
					"baseURL": base,
				},
				"models": preset.models,
			},
		},
	}
	if cfg.FallbackProvider != "" {
		doc["fallback_provider"] = cfg.FallbackProvider
	}
	return json.MarshalIndent(doc, "", "  ")
}
