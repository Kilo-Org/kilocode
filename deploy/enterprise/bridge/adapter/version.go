package adapter

import (
	"log"
	"net/http"
)

const (
	headerClientVersion = "X-Enterprise-Api-Version"
	headerNormalized    = "X-Bridge-Normalized-Version"
	defaultVersion      = "v1"
)

// VersionAdapter normalizes client API versions before proxying to Kilo Engine.
// Phase 1: framework + header passthrough. Phase 2: v0.x path/body rewrites.
type VersionAdapter struct{}

func NewVersionAdapter() *VersionAdapter {
	return &VersionAdapter{}
}

func (v *VersionAdapter) ServeHTTP(w http.ResponseWriter, r *http.Request, next http.HandlerFunc) {
	ver := r.Header.Get(headerClientVersion)
	if ver == "" {
		ver = defaultVersion
	}
	switch ver {
	case "v1", "v0":
		r.Header.Set(headerNormalized, ver)
	default:
		log.Printf("bridge: unknown api version %q, defaulting to %s", ver, defaultVersion)
		r.Header.Set(headerNormalized, defaultVersion)
	}
	// Phase 2: map v0 routes — e.g. /v0/chat -> /session/...
	next(w, r)
}
