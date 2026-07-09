//go:build production

package license

import "time"

func acceptEmptySignature(expires time.Time) (time.Time, error) {
	return time.Time{}, errBadSignature
}
