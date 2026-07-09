package auth

import (
	"testing"
	"time"
)

func TestSignParse(t *testing.T) {
	secret := []byte("test-secret-key-32-bytes-min!!")
	raw, err := Sign(secret, "enterprise-jwt", "user-1", "tenant-1", []string{"developer"}, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	claims, err := Parse(secret, raw)
	if err != nil {
		t.Fatal(err)
	}
	if claims.Subject != "user-1" || claims.TenantID != "tenant-1" || claims.Key != "enterprise-jwt" {
		t.Fatalf("unexpected claims: %+v", claims)
	}
	if len(claims.Roles) != 1 || claims.Roles[0] != "developer" {
		t.Fatalf("unexpected roles: %v", claims.Roles)
	}
}
