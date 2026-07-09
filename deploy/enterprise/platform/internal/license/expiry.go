package license

import (
	"math"
	"time"
)

const WarnDays = 15

func Notice(expires, now time.Time) (daysLeft int, expiringSoon bool) {
	if !expires.After(now) {
		return 0, false
	}
	remaining := expires.Sub(now)
	daysLeft = int(math.Ceil(remaining.Hours() / 24))
	expiringSoon = remaining <= WarnDays*24*time.Hour
	return daysLeft, expiringSoon
}
