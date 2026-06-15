package adapter

import (
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
)

// Proxy forwards requests to the Kilo Engine upstream with SSE-friendly flushing.
type Proxy struct {
	inner *httputil.ReverseProxy
}

func NewProxy(target *url.URL) *Proxy {
	p := httputil.NewSingleHostReverseProxy(target)
	p.FlushInterval = -1
	return &Proxy{inner: p}
}

func (p *Proxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	log.Printf("bridge: %s %s normalized=%s", r.Method, r.URL.Path, r.Header.Get(headerNormalized))
	p.inner.ServeHTTP(w, r)
}
