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
	in.FilePath = a.FilePath
	if err := in.SaveAtomic(); err != nil {
		return errors.New("could not persist credentials")
	}
	a.retired = true
	return nil
}
