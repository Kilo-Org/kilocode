package monitor

import (
	"encoding/json"
	"net/http"
	"os"
	"time"
)

type Service struct {
	engine  string
	bridge  string
	gateway string
}

type item struct {
	Name   string `json:"name"`
	URL    string `json:"url"`
	Status string `json:"status"`
	Code   int    `json:"code,omitempty"`
}

func New(engine, bridge, gateway string) *Service {
	return &Service{engine: engine, bridge: bridge, gateway: gateway}
}

func (s *Service) HealthHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	items := []item{
		s.probe("platform", "http://127.0.0.1:8090/health"),
		s.probe("engine", s.engine+"/global/health"),
		s.probe("bridge", s.bridge+"/health"),
		s.probe("gateway", s.gateway+"/"),
	}
	writeJSON(w, map[string]any{"items": items, "at": time.Now().UTC().Format(time.RFC3339)})
}

func (s *Service) probe(name, url string) item {
	if url == "" {
		return item{Name: name, Status: "skipped"}
	}
	client := &http.Client{Timeout: 3 * time.Second}
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return item{Name: name, URL: url, Status: "error"}
	}
	if name == "engine" {
		user := os.Getenv("PLATFORM_MONITOR_ENGINE_USER")
		pass := os.Getenv("PLATFORM_MONITOR_ENGINE_PASS")
		if user != "" {
			req.SetBasicAuth(user, pass)
		}
	}
	resp, err := client.Do(req)
	if err != nil {
		return item{Name: name, URL: url, Status: "down"}
	}
	_ = resp.Body.Close()
	status := "up"
	if resp.StatusCode >= 500 {
		status = "degraded"
	}
	return item{Name: name, URL: url, Status: status, Code: resp.StatusCode}
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
