package audit

import (
	"net/http/httptest"
	"testing"
	"time"
)

func TestParseListQueryDefaults(t *testing.T) {
	req := httptest.NewRequest("GET", "/api/v1/audit/logs", nil)
	q, err := parseListQuery(req)
	if err != nil {
		t.Fatal(err)
	}
	if q.Page != 1 || q.PageSize != 20 || q.Kind != "" {
		t.Fatalf("unexpected defaults: %+v", q)
	}
}

func TestParseListQueryFilters(t *testing.T) {
	raw := "/api/v1/audit/logs?kind=model_config&from=2026-06-01&to=2026-06-02&page=2&pageSize=50"
	req := httptest.NewRequest("GET", raw, nil)
	q, err := parseListQuery(req)
	if err != nil {
		t.Fatal(err)
	}
	if q.Kind != "model_config" || q.Page != 2 || q.PageSize != 50 {
		t.Fatalf("unexpected query: %+v", q)
	}
	if q.From == nil || q.To == nil {
		t.Fatal("expected from/to")
	}
	if q.From.Format("2006-01-02") != "2026-06-01" {
		t.Fatalf("from: %s", q.From)
	}
}

func TestParseTimeBad(t *testing.T) {
	if _, err := parseTime("not-a-date"); err == nil {
		t.Fatal("expected error")
	}
}

func TestParseTimeRFC3339(t *testing.T) {
	tm, err := parseTime("2026-06-01T12:00:00Z")
	if err != nil || tm == nil {
		t.Fatal(err)
	}
	if tm.UTC().Format(time.RFC3339) != "2026-06-01T12:00:00Z" {
		t.Fatal("bad parse")
	}
}

func TestParseListQueryPageCap(t *testing.T) {
	req := httptest.NewRequest("GET", "/api/v1/audit/logs?pageSize=500", nil)
	q, err := parseListQuery(req)
	if err != nil {
		t.Fatal(err)
	}
	if q.PageSize != 100 {
		t.Fatalf("expected cap 100, got %d", q.PageSize)
	}
}
