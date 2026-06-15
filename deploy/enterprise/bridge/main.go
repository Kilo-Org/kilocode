// Phase 1: reverse proxy + version adapter framework (Layer 2).
package main

import (
	"log"
	"net/http"
	"net/url"
	"os"

	"enterprise-bridge/adapter"
)

func main() {
	listen := env("BRIDGE_LISTEN", ":8080")
	upstream := env("KILO_UPSTREAM", "http://kilo-engine:4096")
	target, err := url.Parse(upstream)
	if err != nil {
		log.Fatal(err)
	}

	proxy := adapter.NewProxy(target)
	chain := adapter.NewChain(proxy, adapter.NewVersionAdapter())

	http.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	http.Handle("/", chain)

	log.Printf("enterprise-bridge listening on %s -> %s", listen, upstream)
	log.Fatal(http.ListenAndServe(listen, nil))
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
