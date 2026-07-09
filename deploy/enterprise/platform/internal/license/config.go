package license

import (
	"os"
	"strings"
)

func LoadPublicKey() (string, error) {
	if raw := strings.TrimSpace(os.Getenv("PLATFORM_LICENSE_PUBLIC_KEY")); raw != "" {
		return raw, nil
	}
	path := strings.TrimSpace(os.Getenv("PLATFORM_LICENSE_PUBLIC_KEY_PATH"))
	if path == "" {
		return "", nil
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}
