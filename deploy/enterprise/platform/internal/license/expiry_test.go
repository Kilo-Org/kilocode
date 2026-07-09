package license

import (
	"testing"
	"time"
)

func TestNoticeActiveFar(t *testing.T) {
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	expires := now.Add(20 * 24 * time.Hour)
	days, soon := Notice(expires, now)
	if soon || days != 20 {
		t.Fatalf("expected no warning, days=20, got soon=%v days=%d", soon, days)
	}
}

func TestNoticeWithin15Days(t *testing.T) {
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	expires := now.Add(10*24*time.Hour + time.Hour)
	days, soon := Notice(expires, now)
	if !soon || days != 11 {
		t.Fatalf("expected warning, days=11, got soon=%v days=%d", soon, days)
	}
}

func TestNoticeExactly15Days(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	expires := now.Add(15 * 24 * time.Hour)
	_, soon := Notice(expires, now)
	if !soon {
		t.Fatal("expected warning at 15 days boundary")
	}
}

func TestNoticeExpired(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	expires := now.Add(-time.Hour)
	days, soon := Notice(expires, now)
	if soon || days != 0 {
		t.Fatalf("expected no reminder when expired, got soon=%v days=%d", soon, days)
	}
}

func TestNoticePartialDayCeil(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	expires := now.Add(2*24*time.Hour + 2*time.Hour)
	days, soon := Notice(expires, now)
	if !soon || days != 3 {
		t.Fatalf("expected ceil to 3 days, got soon=%v days=%d", soon, days)
	}
}
