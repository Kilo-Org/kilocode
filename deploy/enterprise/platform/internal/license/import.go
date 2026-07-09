package license

import (
	"context"
	"database/sql"
	"io"
	"net/http"
	"strings"

	"enterprise-platform/internal/auth"
)

var errKeyOwned = importErr("key_owned_by_other_tenant")

type importErr string

func (e importErr) Error() string { return string(e) }

func (s *Service) ImportHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	claims, ok := auth.ClaimsFrom(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	tenantID := tenantIDFromImportPath(r.URL.Path)
	if tenantID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing_tenant"})
		return
	}
	if !canImport(claims, tenantID) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "forbidden"})
		return
	}
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad_body"})
		return
	}
	id, err := s.importFile(r.Context(), tenantID, raw)
	if err != nil {
		writeJSON(w, importStatus(err), map[string]string{"error": importErrorCode(err)})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": id, "status": "ok"})
}

func tenantIDFromImportPath(path string) string {
	path = strings.TrimPrefix(path, "/api/v1/tenants/")
	path = strings.TrimSuffix(path, "/licenses")
	return strings.Trim(path, "/")
}

func canImport(claims *auth.Claims, tenantID string) bool {
	if importRole(claims.Roles, "sys_admin") {
		return true
	}
	if importRole(claims.Roles, "tenant_admin") && claims.TenantID == tenantID {
		return true
	}
	return false
}

func importRole(roles []string, name string) bool {
	for _, role := range roles {
		if role == name {
			return true
		}
	}
	return false
}

func importStatus(err error) int {
	switch err {
	case errBadOfflineJSON, errMissingKey, errMissingExpires, errBadExpires, errExpired, errBadSignature, errNoPublicKey:
		return http.StatusBadRequest
	case errKeyOwned:
		return http.StatusConflict
	default:
		return http.StatusInternalServerError
	}
}

func importErrorCode(err error) string {
	switch err {
	case errBadOfflineJSON:
		return "bad_offline_json"
	case errMissingKey:
		return "missing_key"
	case errMissingExpires:
		return "missing_expires"
	case errBadExpires:
		return "bad_expires"
	case errExpired:
		return "expired"
	case errBadSignature:
		return "bad_signature"
	case errNoPublicKey:
		return "no_public_key"
	case errKeyOwned:
		return "key_owned_by_other_tenant"
	default:
		return "import_failed"
	}
}

func (s *Service) importFile(ctx context.Context, tenantID string, raw []byte) (string, error) {
	file, err := parseOffline(raw)
	if err != nil {
		return "", err
	}
	expires, err := validateOffline(file, s.publicKey)
	if err != nil {
		return "", err
	}
	var owner string
	err = s.db.QueryRowContext(ctx, `
		SELECT tenant_id::text FROM licenses WHERE license_key = $1
	`, file.Key).Scan(&owner)
	if err == nil && owner != tenantID {
		return "", errKeyOwned
	}
	if err != nil && err != sql.ErrNoRows {
		return "", err
	}
	if owner == tenantID {
		var id string
		err = s.db.QueryRowContext(ctx, `
			UPDATE licenses SET expires_at = $1, status = 'active'
			WHERE tenant_id = $2::uuid AND license_key = $3
			RETURNING id::text
		`, expires, tenantID, file.Key).Scan(&id)
		return id, err
	}
	var id string
	err = s.db.QueryRowContext(ctx, `
		INSERT INTO licenses (tenant_id, license_key, expires_at, status)
		VALUES ($1::uuid, $2, $3, 'active')
		RETURNING id::text
	`, tenantID, file.Key, expires).Scan(&id)
	return id, err
}
