//go:build !production

package license

import (
	"os"
	"testing"
)

func TestValidateOfflineUnsignedDev(t *testing.T) {
	t.Setenv("PLATFORM_LICENSE_ALLOW_UNSIGNED", "1")
	file := offlineFile{
		Key:       "demo",
		ExpiresAt: "2099-01-01T00:00:00.000Z",
	}
	_, err := validateOffline(file, "")
	if err != nil {
		t.Fatal(err)
	}
	os.Unsetenv("PLATFORM_LICENSE_ALLOW_UNSIGNED")
}

func TestValidateOfflineUnsignedDevOff(t *testing.T) {
	t.Setenv("PLATFORM_LICENSE_ALLOW_UNSIGNED", "0")
	file := offlineFile{
		Key:       "demo",
		ExpiresAt: "2099-01-01T00:00:00.000Z",
	}
	_, err := validateOffline(file, "")
	if err != errBadSignature {
		t.Fatalf("expected bad_signature, got %v", err)
	}
}
