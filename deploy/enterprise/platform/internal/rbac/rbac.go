package rbac

import "fmt"

var adminKinds = map[string]bool{
	"sys_admin":      true,
	"security_admin": true,
	"audit_admin":    true,
}

// CanAssign returns nil if adding kind does not break three-admin mutual exclusion.
func CanAssign(existing []string, kind string) error {
	if !adminKinds[kind] {
		return nil
	}
	for _, item := range existing {
		if adminKinds[item] && item != kind {
			return fmt.Errorf("three_admin_mutex: %s conflicts with %s", kind, item)
		}
	}
	return nil
}
