package maintenance

import (
	"context"
	"fmt"
	"github.com/linguo2625469/workbuddy2api-panel/internal/pool"
	"github.com/linguo2625469/workbuddy2api-panel/internal/upstream"
	"time"
)

func UpstreamAction(p *pool.Pool, up *upstream.Client) Action {
	return func(ctx context.Context, kind, uid string) (string, error) {
		if e := ctx.Err(); e != nil {
			return "", e
		}
		a := p.AuthByUID(uid)
		if a == nil {
			return "", fmt.Errorf("account not found")
		}
		switch kind {
		case "token":
			if e := up.RefreshToken(a); e != nil {
				return "", e
			}
			return "Token已刷新", a.SaveAtomic()
		case "checkin":
			if !a.IsGlobal() && !a.IsEnterprise() {
				if e := up.DailyCheckin(a); e != nil && !upstream.IsAlreadyCheckin(e) {
					return "", e
				}
				p.NoteCheckinDone(uid)
			}
			rem, total, e := up.UserResource(a)
			if e != nil {
				return "", e
			}
			p.SetCredits(uid, rem, total)
			p.ReenableIfCredits(uid, rem, total)
			return "余额已回读", nil
		case "activity":
			if a.IsEnterprise() {
				return "企业账号不适用", nil
			}
			id := fmt.Sprintf("local-%d", time.Now().UnixNano())
			if e := up.ReportChatActivity(a, id, id); e != nil {
				return "", e
			}
			return "活跃已上报", nil
		case "travel":
			if a.IsGlobal() || a.IsEnterprise() {
				return "该账号不适用旅行", nil
			}
			buddy, e := up.BuddyInfo(a)
			if e != nil {
				return "", e
			}
			if buddy == nil {
				if e = up.BuddyAgreement(a); e != nil {
					return "", e
				}
				return "已提交领养", up.BuddyFirst(a)
			}
			st, e := up.TravelStatus(a)
			if e != nil {
				return "", e
			}
			switch st.State {
			case "arrived":
				_, e = up.TravelClaim(a, st.RecordID)
				return "已领取旅行奖励", e
			case "idle":
				if st.DailyLimitReached {
					return "今日旅行次数已用完", nil
				}
				return "已派出旅行", up.TravelDepart(a, 1)
			case "traveling":
				return "旅行中，无需重复派出", nil
			default:
				return "", fmt.Errorf("unknown travel state %q", st.State)
			}
		}
		return "", fmt.Errorf("unknown maintenance action")
	}
}
