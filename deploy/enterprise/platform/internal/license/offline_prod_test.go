//go:build production

package license

import "testing"

func TestValidateOfflineUnsignedRejectedProd(t *testing.T) {
	file := offlineFile{
		Key:       "demo",
		ExpiresAt: "2099-01-01T00:00:00.000Z",
	}
	_, err := validateOffline(file, "")
	if err != errBadSignature {
		t.Fatalf("expected bad_signature, got %v", err)
	}
}
