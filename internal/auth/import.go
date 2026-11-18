package auth

import "errors"

// ImportCredentialsAndSave persists a replacement without mutating shared metadata.
// After success the caller must publish in using Pool.Add (the existing upsert).
// Old in-flight refreshes may finish, but cannot overwrite the replacement file.
// in must be an unpublished, parsed account owned by the caller.
func (a *Auth) ImportCredentialsAndSave(in *Auth, preserveProxy bool) error {
	if in == nil || in == a {
		return errors.New("invalid replacement account")
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.retired {
		return errors.New("account was already replaced")
	}
	if a.UID != in.UID {
		return errors.New("account UID mismatch")
	}
	if preserveProxy {
		in.ProxyURL = a.ProxyURL
	}
	if in.realm == "" && a.realm != "" {
		in.realm = a.realm
	}
	if in.Domain == "" && a.Domain != "" {
		in.Domain = a.Domain
	}
	if in.Nickname == "" && a.Nickname != "" {
		in.Nickname = a.Nickname
	}
	if in.EnterpriseID == "" && a.EnterpriseID != "" {
		in.EnterpriseID = a.EnterpriseID
	}
	if in.DeviceToken == "" && a.DeviceToken != "" {
		in.DeviceToken = a.DeviceToken
	}
	if in.DeviceProfile == nil && a.DeviceProfile != nil {
		cp := *a.DeviceProfile
		in.DeviceProfile = &cp
	}
	in.FilePath = a.FilePath
	if err := in.SaveAtomic(); err != nil {
		return errors.New("could not persist credentials")
	}
	a.retired = true
	return nil
}

// IsRetired 并发安全返回该 Auth 对象是否已被更新导入的替代对象退役。
func (a *Auth) IsRetired() bool {
	if a == nil {
		return false
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.retired
}
