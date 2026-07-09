package rbac

import "testing"

func TestCanAssignThreeAdminMutex(t *testing.T) {
	err := CanAssign([]string{"sys_admin"}, "audit_admin")
	if err == nil {
		t.Fatal("expected mutex error")
	}
}

func TestCanAssignSameAdmin(t *testing.T) {
	if err := CanAssign([]string{"sys_admin"}, "sys_admin"); err != nil {
		t.Fatal(err)
	}
}

func TestCanAssignNormal(t *testing.T) {
	if err := CanAssign([]string{"sys_admin"}, "developer"); err != nil {
		t.Fatal(err)
	}
}
