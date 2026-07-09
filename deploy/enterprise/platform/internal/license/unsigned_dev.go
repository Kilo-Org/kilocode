//go:build !production

package license

import (
	"os"
	"strings"
	"time"
)

func AllowUnsigned() bool {
	return strings.TrimSpace(os.Getenv("PLATFORM_LICENSE_ALLOW_UNSIGNED")) == "1"
}

func acceptEmptySignature(expires time.Time) (time.Time, error) {
	if AllowUnsigned() {
		return expires, nil
	}
	return time.Time{}, errBadSignature
}
