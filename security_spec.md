# Security Specification - INFO-GENIUS VISION

## 1. Data Invariants

Our application implements secure, per-user storage for infographics and private user profile records. The data security architecture adheres to a Zero-Trust approach enforcing the following invariants:

1. **User Profile Invariant**: A user's profile documents can only be written (created or updated) or read by the owner of that profile (i.e. where `userId` equals the authenticated `request.auth.uid`).
2. **Infographics Ownership Invariant**: A user can only access (`get`, `list`) and mutate (`create`, `update`, `delete`) infographics stored inside their own sub-collection `/users/{userId}/infographics/{infographicId}`.
3. **Verified Email Obligation**: All mutations must restrict write access strictly to users with verified emails (`request.auth.token.email_verified == true`), preventing malicious bots or unverified accounts from exhausting system resources.
4. **Size and ID Validation**: IDs must match the format `^[a-zA-Z0-9_\-]+$` and be bounded in size, plus properties must have strict size boundaries to prevent Denial of Wallet storage exhaustion.

---

## 2. The "Dirty Dozen" Payloads

These payloads represent specific vectors designed to violate security policies. Safe firestore rules must mathematically block all of these:

### Attack 1: User Profile - Identity Spoofing (Create path of another user)
* **Goal**: Write a UserProfile record with user ID `victim_123` while signed in as `hacker_456`.
* **Expected Result**: `PERMISSION_DENIED`

### Attack 2: User Profile - Self-Assigned Privileges
* **Goal**: Write a user profile that sets unauthorized role access (e.g. `isAdmin: true` or custom properties) directly from the client.
* **Expected Result**: `PERMISSION_DENIED`

### Attack 3: Infographics - Spoofing Owner Id
* **Goal**: Insert a document into `users/victim_123/infographics/info_111` as `hacker_456`.
* **Expected Result**: `PERMISSION_DENIED`

### Attack 4: Infographics - Stealing Graphics
* **Goal**: Read / Get an infographic document at `/users/victim_123/infographics/info_111` while logged in as `anonymous_user` or `hacker_456`.
* **Expected Result**: `PERMISSION_DENIED`

### Attack 5: Infographics - Unfiltered Index Dump (List scraping)
* **Goal**: Read entire list of infographics under `/users/victim_123/infographics` without restricting queries to the own user id.
* **Expected Result**: `PERMISSION_DENIED`

### Attack 6: Infographics - Over-Sized Prompt Ingestion
* **Goal**: Create an infographic with a 10MB prompt string to overflow Firestore storage memory or billing quotas.
* **Expected Result**: `PERMISSION_DENIED`

### Attack 7: Infographics - Client-Provided Spoofed Timestamps
* **Goal**: Construct an infographic with a past/future `createdAt` date instead of using the mandatory `request.time`.
* **Expected Result**: `PERMISSION_DENIED`

### Attack 8: Infographics - Immutable Field Tampering
* **Goal**: Update the `id` or `createdAt` of an existing infographic, or modify attributes that must stay constant.
* **Expected Result**: `PERMISSION_DENIED`

### Attack 9: Infographics - Unverified Identity Write
* **Goal**: Write to a compilation path when the authenticated user profile has `email_verified == false` (email verification bypassed).
* **Expected Result**: `PERMISSION_DENIED`

### Attack 10: Infographics - Empty Crucial Field
* **Goal**: Insert an infographic document that lacks the critical fields: `id` or base64 `data` values.
* **Expected Result**: `PERMISSION_DENIED`

### Attack 11: Infographics - Junk ID Intrusion
* **Goal**: Write an infographic using a document ID filled with invalid URL characters (`http://..`, `%20`, etc.).
* **Expected Result**: `PERMISSION_DENIED`

### Attack 12: General Path - Catch-all Default Exploit
* **Goal**: Perform an arbitrary collection write to an unregistered path (e.g., `/settings/allow_all`).
* **Expected Result**: `PERMISSION_DENIED`

---

## 3. Test Coverage Strategy

All security rules compiles into standard rules checks:
- Standard paths `/users/{userId}` has rules `allow read, write: if request.auth != null && request.auth.uid == userId;`
- Sub-collection `/users/{userId}/infographics/{infographicId}` has rules matching strict ownership `userId == request.auth.uid`.
- Strict validation checks on inputs (`isValidUserProfile`, `isValidInfographic`).
- Run check parameters using the Firestore security rules.
