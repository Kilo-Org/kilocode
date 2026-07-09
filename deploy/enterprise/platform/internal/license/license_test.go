package license

import (
	"testing"
	"time"
)

func TestDecideActive(t *testing.T) {
	future := time.Now().UTC().Add(24 * time.Hour)
	resp, readonly := Decide("active", future, time.Now().UTC())
	if !resp.Valid || readonly {
		t.Fatalf("expected active valid writable, got %+v readonly=%v", resp, readonly)
	}
}

func TestDecideExpiredReadonly(t *testing.T) {
	past := time.Now().UTC().Add(-time.Hour)
	resp, readonly := Decide("active", past, time.Now().UTC())
	if !resp.Valid || !readonly {
		t.Fatalf("expected expired readonly, got %+v readonly=%v", resp, readonly)
	}
}

func TestDecideFrozen(t *testing.T) {
	future := time.Now().UTC().Add(24 * time.Hour)
	resp, readonly := Decide("frozen", future, time.Now().UTC())
	if resp.Valid || readonly {
		t.Fatalf("expected frozen invalid, got %+v", resp)
	}
	if resp.Message != "frozen" {
		t.Fatalf("expected frozen message, got %q", resp.Message)
	}
}

func TestDecideReadonlyStatus(t *testing.T) {
	future := time.Now().UTC().Add(24 * time.Hour)
	resp, readonly := Decide("readonly", future, time.Now().UTC())
	if !resp.Valid || !readonly {
		t.Fatalf("expected readonly status, got %+v readonly=%v", resp, readonly)
	}
}

func TestMaskKey(t *testing.T) {
	if maskKey("short") != "****" {
		t.Fatal("short key masked")
	}
	if maskKey("enterprise-poc") != "ente****-poc" {
		t.Fatalf("unexpected mask: %s", maskKey("enterprise-poc"))
	}
}
