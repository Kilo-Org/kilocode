package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"enterprise-platform/internal/admin"
	"enterprise-platform/internal/audit"
	"enterprise-platform/internal/auth"
	"enterprise-platform/internal/db"
	"enterprise-platform/internal/license"
	"enterprise-platform/internal/model"
	"enterprise-platform/internal/monitor"
	"enterprise-platform/internal/oidc"
	"enterprise-platform/internal/roles"
	"enterprise-platform/internal/tenant"
	"enterprise-platform/internal/usage"
	"enterprise-platform/internal/users"
)

const name = "enterprise-platform"
const phase = "2-ad-a5"

func main() {
	addr := env("PLATFORM_LISTEN", ":8090")
	pg := os.Getenv("PLATFORM_PG_URL")
	if pg == "" {
		log.Fatal("PLATFORM_PG_URL is required")
	}
	secret := os.Getenv("PLATFORM_JWT_SECRET")
	if secret == "" {
		log.Fatal("PLATFORM_JWT_SECRET is required")
	}
	migdir := env("PLATFORM_MIGRATIONS_DIR", "./migrations")
	cfgPath := os.Getenv("PLATFORM_ENGINE_CONFIG_PATH")

	conn, err := db.Open(pg)
	if err != nil {
		log.Fatal(err)
	}
	defer conn.Close()

	if err := db.Migrate(conn, migdir); err != nil {
		log.Fatal("migrate: ", err)
	}

	jwtSecret := []byte(secret)
	jwtKey := env("PLATFORM_JWT_KEY", "enterprise-jwt")
	tenantID := env("PLATFORM_DEFAULT_TENANT_ID", "00000000-0000-0000-0000-000000000001")

	oidcSvc, err := oidc.New(context.Background(), conn, oidc.Config{
		Issuer:          os.Getenv("PLATFORM_OIDC_ISSUER"),
		ClientID:        os.Getenv("PLATFORM_OIDC_CLIENT_ID"),
		ClientSecret:    os.Getenv("PLATFORM_OIDC_CLIENT_SECRET"),
		RedirectURL:     os.Getenv("PLATFORM_OIDC_REDIRECT_URL"),
		BrowserRedirect: env("PLATFORM_OIDC_BROWSER_REDIRECT", "/admin/"),
		VSCodeRedirect:  os.Getenv("PLATFORM_OIDC_VSCODE_URI"),
		TenantID:        tenantID,
		JWTSecret:       jwtSecret,
		JWTKey:          jwtKey,
		JWTTTL:          8 * time.Hour,
		Dev:             env("PLATFORM_AUTH_DEV", "") == "1",
	})
	if err != nil {
		log.Fatal("oidc: ", err)
	}

	pubKey, err := license.LoadPublicKey()
	if err != nil {
		log.Fatal("license public key: ", err)
	}
	lic := license.New(conn, pubKey)
	usr := users.New(conn)
	rol := roles.New(conn)
	mdl := model.New(conn, cfgPath)
	tnt := tenant.New(conn)
	usg := usage.New(conn)
	adt := audit.New(conn)
	mon := monitor.New(
		env("PLATFORM_MONITOR_ENGINE_URL", "http://kilo-engine:4096"),
		env("PLATFORM_MONITOR_BRIDGE_URL", "http://enterprise-bridge:8080"),
		env("PLATFORM_MONITOR_GATEWAY_URL", "http://apisix:9080"),
	)

	mux := http.NewServeMux()
	mux.HandleFunc("/health", health)
	mux.HandleFunc("/api/v1/version", version)
	mux.Handle("/admin/", http.StripPrefix("/admin/", admin.Handler()))
	mux.HandleFunc("/api/v1/license/verify", lic.VerifyHTTP)
	mux.HandleFunc("/api/v1/auth/login", oidcSvc.LoginHTTP)
	mux.HandleFunc("/api/v1/auth/callback", oidcSvc.CallbackHTTP)
	mux.HandleFunc("/api/v1/auth/status", oidcSvc.StatusHTTP)
	mux.HandleFunc("/api/v1/auth/dev-token", oidcSvc.DevTokenHTTP)
	mux.HandleFunc("/api/v1/auth/me", auth.Bearer(jwtSecret, oidcSvc.MeHTTP))
	mux.HandleFunc("/api/v1/users", auth.Bearer(jwtSecret, usr.ListHTTP))
	mux.HandleFunc("/api/v1/users/", routeUsers(usr, jwtSecret))
	mux.HandleFunc("/api/v1/roles", auth.Bearer(jwtSecret, rol.ListHTTP))
	mux.HandleFunc("/api/v1/tenants", auth.Bearer(jwtSecret, tnt.RouteHTTP))
	mux.HandleFunc("/api/v1/tenants/", auth.Bearer(jwtSecret, routeTenants(tnt, lic)))
	mux.HandleFunc("/api/v1/usage/summary", auth.Bearer(jwtSecret, usg.SummaryHTTP))
	mux.HandleFunc("/api/v1/usage/detail", auth.Bearer(jwtSecret, usg.DetailHTTP))
	mux.HandleFunc("/api/v1/usage/", auth.Bearer(jwtSecret, routeUsage(usg)))
	mux.HandleFunc("/api/v1/licenses", auth.Bearer(jwtSecret, routeLicenses(lic)))
	mux.HandleFunc("/api/v1/licenses/", auth.Bearer(jwtSecret, routeLicenses(lic)))
	mux.HandleFunc("/api/v1/model-config", routeModel(mdl, jwtSecret))
	mux.HandleFunc("/api/v1/model-config/apply", auth.Bearer(jwtSecret, mdl.ApplyHTTP))
	mux.HandleFunc("/api/v1/monitor/health", auth.Bearer(jwtSecret, mon.HealthHTTP))
	mux.HandleFunc("/api/v1/audit/logs", auth.Bearer(jwtSecret, adt.ListHTTP))

	log.Printf("%s listening on %s (phase %s, config=%s)", name, addr, phase, cfgPath)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatal(err)
	}
}

func routeUsage(usg *usage.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/usage/events":
			usg.EventsHTTP(w, r)
		case "/api/v1/usage/analytics/report":
			usg.ReportHTTP(w, r)
		case "/api/v1/usage/analytics/export":
			usg.ExportHTTP(w, r)
		case "/api/v1/usage/assessment/config":
			usg.AssessmentConfigHTTP(w, r)
		case "/api/v1/usage/assessment/report":
			usg.AssessmentReportHTTP(w, r)
		case "/api/v1/usage/assessment/export":
			usg.AssessmentExportHTTP(w, r)
		default:
			http.NotFound(w, r)
		}
	}
}

func routeModel(mdl *model.Service, secret []byte) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/model-config" {
			http.NotFound(w, r)
			return
		}
		switch r.Method {
		case http.MethodGet:
			auth.Bearer(secret, mdl.GetHTTP)(w, r)
		case http.MethodPut:
			auth.Bearer(secret, mdl.PutHTTP)(w, r)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	}
}

func routeLicenses(lic *license.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/licenses/status" {
			if r.Method == http.MethodGet {
				lic.StatusHTTP(w, r)
				return
			}
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if r.URL.Path == "/api/v1/licenses" {
			lic.ListHTTP(w, r)
			return
		}
		http.NotFound(w, r)
	}
}

func routeTenants(tnt *tenant.Service, lic *license.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/licenses") {
			if r.Method == http.MethodPost {
				lic.ImportHTTP(w, r)
				return
			}
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		tnt.RouteHTTP(w, r)
	}
}

func routeUsers(usr *users.Service, secret []byte) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/roles") {
			switch r.Method {
			case http.MethodPost:
				auth.Bearer(secret, usr.AssignRoleHTTP)(w, r)
			case http.MethodDelete:
				auth.Bearer(secret, usr.UnassignRoleHTTP)(w, r)
			default:
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			}
			return
		}
		id := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/v1/users/"), "/")
		if id != "" && r.Method == http.MethodGet {
			auth.Bearer(secret, usr.GetHTTP)(w, r)
			return
		}
		http.NotFound(w, r)
	}
}

func health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]string{
		"status":  "ok",
		"service": name,
	})
}

func version(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]string{
		"service": name,
		"phase":   phase,
	})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
