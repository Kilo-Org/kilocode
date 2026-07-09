package license

import (
	"context"
	"database/sql"
	"net/http"
	"time"

	"enterprise-platform/internal/auth"
)

type statusResp struct {
	Activated    bool   `json:"activated"`
	ExpiresAt    string `json:"expiresAt,omitempty"`
	DaysLeft     int    `json:"daysLeft"`
	ExpiringSoon bool   `json:"expiringSoon"`
}

func (s *Service) StatusHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	claims, ok := auth.ClaimsFrom(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	resp, err := s.tenantStatus(r.Context(), claims.TenantID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "db_error"})
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *Service) tenantStatus(ctx context.Context, tenantID string) (statusResp, error) {
	var count int
	err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM licenses WHERE tenant_id = $1::uuid
	`, tenantID).Scan(&count)
	if err != nil {
		return statusResp{}, err
	}
	resp := statusResp{Activated: count > 0}
	if count == 0 {
		return resp, nil
	}
	var expires sql.NullTime
	err = s.db.QueryRowContext(ctx, `
		SELECT MIN(expires_at) FROM licenses
		WHERE tenant_id = $1::uuid
		  AND expires_at > NOW()
		  AND status IN ('active', 'readonly')
	`, tenantID).Scan(&expires)
	if err != nil {
		return statusResp{}, err
	}
	if !expires.Valid {
		return resp, nil
	}
	now := time.Now().UTC()
	days, soon := Notice(expires.Time, now)
	resp.ExpiresAt = expires.Time.UTC().Format(time.RFC3339)
	resp.DaysLeft = days
	resp.ExpiringSoon = soon
	return resp, nil
}
