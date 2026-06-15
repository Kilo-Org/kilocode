package adapter_test

import (
	"net/http"
	"net/http/httputil"
	"net/url"
	"net/http/httptest"
	"testing"

	"enterprise-bridge/adapter"
)

func TestVersionAdapterDefault(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("X-Bridge-Normalized-Version"); got != "v1" {
			t.Fatalf("normalized version = %q, want v1", got)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer target.Close()

	u, _ := url.Parse(target.URL)
	proxy := httputil.NewSingleHostReverseProxy(u)
	chain := adapter.NewChain(proxy, adapter.NewVersionAdapter())

	req := httptest.NewRequest(http.MethodGet, "/global/health", nil)
	rec := httptest.NewRecorder()
	chain.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
}
