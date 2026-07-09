package license

import (
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"strings"
	"time"
)

type offlineFile struct {
	Key       string `json:"key"`
	ExpiresAt string `json:"expiresAt"`
	Signature string `json:"signature"`
	Algorithm string `json:"algorithm"`
}

var (
	errBadOfflineJSON = errors.New("bad_offline_json")
	errMissingKey     = errors.New("missing_key")
	errMissingExpires = errors.New("missing_expires")
	errBadExpires     = errors.New("bad_expires")
	errExpired        = errors.New("expired")
	errBadSignature   = errors.New("bad_signature")
	errNoPublicKey    = errors.New("no_public_key")
)

func parseOffline(raw []byte) (offlineFile, error) {
	var file offlineFile
	if err := json.Unmarshal(raw, &file); err != nil {
		return file, errBadOfflineJSON
	}
	file.Key = strings.TrimSpace(file.Key)
	file.ExpiresAt = strings.TrimSpace(file.ExpiresAt)
	file.Signature = strings.TrimSpace(file.Signature)
	if file.Key == "" {
		return file, errMissingKey
	}
	if file.ExpiresAt == "" {
		return file, errMissingExpires
	}
	return file, nil
}

func parseExpires(raw string) (time.Time, error) {
	t, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		t, err = time.Parse(time.RFC3339Nano, raw)
	}
	if err != nil {
		return time.Time{}, errBadExpires
	}
	return t.UTC(), nil
}

func offlinePayloadBytes(key, expiresAt string) []byte {
	canonical, _ := json.Marshal(map[string]string{
		"expiresAt": expiresAt,
		"key":       key,
	})
	return canonical
}

func verifyRsaSha256(key, expiresAt, signatureB64, publicKeyPem string) bool {
	sigRaw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(signatureB64))
	if err != nil {
		return false
	}
	block, _ := pem.Decode([]byte(strings.TrimSpace(publicKeyPem)))
	if block == nil {
		return false
	}
	pubAny, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return false
	}
	pub, ok := pubAny.(*rsa.PublicKey)
	if !ok {
		return false
	}
	hash := sha256.Sum256(offlinePayloadBytes(key, expiresAt))
	return rsa.VerifyPKCS1v15(pub, crypto.SHA256, hash[:], sigRaw) == nil
}

func validateOffline(file offlineFile, publicKeyPem string) (time.Time, error) {
	expires, err := parseExpires(file.ExpiresAt)
	if err != nil {
		return time.Time{}, err
	}
	if !expires.After(time.Now().UTC()) {
		return time.Time{}, errExpired
	}
	if file.Signature == "" {
		return acceptEmptySignature(expires)
	}
	if strings.TrimSpace(publicKeyPem) == "" {
		return time.Time{}, errNoPublicKey
	}
	if !verifyRsaSha256(file.Key, file.ExpiresAt, file.Signature, publicKeyPem) {
		return time.Time{}, errBadSignature
	}
	return expires, nil
}
