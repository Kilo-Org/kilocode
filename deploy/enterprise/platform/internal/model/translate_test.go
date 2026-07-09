package model

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestTranslateDeepseek(t *testing.T) {
	body, err := Translate(Config{
		Provider:     "deepseek",
		APIBase:      "https://api.deepseek.com/v1",
		DefaultModel: "deepseek-v4-pro",
		SmallModel:   "deepseek-v4-flash",
	})
	if err != nil {
		t.Fatal(err)
	}
	var doc map[string]any
	if err := json.Unmarshal(body, &doc); err != nil {
		t.Fatal(err)
	}
	if doc["model"] != "deepseek/deepseek-v4-pro" {
		t.Fatalf("unexpected model: %v", doc["model"])
	}
}

func TestTranslateFourProviders(t *testing.T) {
	names := []string{"deepseek", "qwen", "glm", "minimax"}
	for _, name := range names {
		preset := presets[name]
		var modelID string
		for id := range preset.models {
			modelID = id
			break
		}
		_, err := Translate(Config{Provider: name, DefaultModel: modelID})
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
	}
}

func TestTranslateApiKeyEnv(t *testing.T) {
	body, err := Translate(Config{
		Provider:     "deepseek",
		DefaultModel: "deepseek-v4-pro",
		ApiKeyEnv:    "DEEPSEEK_API_KEY",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), "{env:DEEPSEEK_API_KEY}") {
		t.Fatalf("expected custom env ref in output: %s", body)
	}
}

func TestValidEnv(t *testing.T) {
	if !validEnv("KILO_CUSTOM_API_KEY") {
		t.Fatal("valid env rejected")
	}
	if validEnv("bad-key") {
		t.Fatal("invalid env accepted")
	}
	if validEnv("123BAD") {
		t.Fatal("digit start accepted")
	}
}
