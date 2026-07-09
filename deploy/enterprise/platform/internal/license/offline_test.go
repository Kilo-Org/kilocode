package license

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"testing"
	"time"
)

func testKeys(t *testing.T) (*rsa.PrivateKey, string) {
	t.Helper()
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKIXPublicKey(&priv.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	pub := string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der}))
	return priv, pub
}

func signOffline(t *testing.T, priv *rsa.PrivateKey, key, expiresAt string) string {
	t.Helper()
	hash := sha256.Sum256(offlinePayloadBytes(key, expiresAt))
	sig, err := rsa.SignPKCS1v15(rand.Reader, priv, crypto.SHA256, hash[:])
	if err != nil {
		t.Fatal(err)
	}
	return base64.StdEncoding.EncodeToString(sig)
}

func TestVerifyRsaSha256(t *testing.T) {
	priv, pub := testKeys(t)
	key := "offline-test"
	expires := "2099-01-01T00:00:00.000Z"
	sig := signOffline(t, priv, key, expires)
	if !verifyRsaSha256(key, expires, sig, pub) {
		t.Fatal("expected valid signature")
	}
	if verifyRsaSha256(key, "2099-01-02T00:00:00.000Z", sig, pub) {
		t.Fatal("expected invalid for tampered expires")
	}
}

func TestValidateOfflineSigned(t *testing.T) {
	priv, pub := testKeys(t)
	expires := time.Now().UTC().Add(24 * time.Hour).Format(time.RFC3339Nano)
	file := offlineFile{
		Key:       "signed-key",
		ExpiresAt: expires,
		Signature: signOffline(t, priv, "signed-key", expires),
	}
	_, err := validateOffline(file, pub)
	if err != nil {
		t.Fatal(err)
	}
}

func TestValidateOfflineRequiresKeyWhenSigned(t *testing.T) {
	priv, _ := testKeys(t)
	expires := "2099-01-01T00:00:00.000Z"
	file := offlineFile{
		Key:       "k",
		ExpiresAt: expires,
		Signature: signOffline(t, priv, "k", expires),
	}
	_, err := validateOffline(file, "")
	if err != errNoPublicKey {
		t.Fatalf("expected no_public_key, got %v", err)
	}
}

func TestParseOffline(t *testing.T) {
	_, err := parseOffline([]byte(`{"expiresAt":"2099-01-01T00:00:00.000Z"}`))
	if err != errMissingKey {
		t.Fatalf("expected missing_key, got %v", err)
	}
}
