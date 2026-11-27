# Security Specification & Payload TDD

## 1. Data Invariants
- All collections default-deny unless explicitly matched.
- PII (`admissionInquiries`, `campusVisits`) is strictly readable, updatable, and deletable ONLY by verified school administrators (`isAdmin()`).
- Public visitors may only `create` inquiries with `status == 'new'` and campus visits with `status == 'scheduled'`, strict key allowlists (`hasAll` + `hasOnly`), bounded field lengths, regex-validated phone/date formats, and server timestamps (`request.time`).
- `createdAt` is immutable on update; terminal statuses (`archived`, `cancelled`) cannot be overwritten via standard updates without deletion/admin override if needed, and only `status` + `updatedAt` may be modified on update.

## 2. Dirty Dozen Payloads (Expected: PERMISSION_DENIED)
1. Unauthenticated `get` / `list` on `/admissionInquiries`.
2. Unauthenticated `get` / `list` on `/campusVisits`.
3. Non-admin authenticated user `get` / `list` on `/admissionInquiries` or `/campusVisits`.
4. Admin token with `email_verified: false` attempting `list` or `update`.
5. `create` on `/admissionInquiries` with extra ghost field (`isVerified: true`).
6. `create` on `/admissionInquiries` with forged `status: 'enrolled'` instead of `'new'`.
7. `create` on `/admissionInquiries` with forged client `createdAt` (`!= request.time`).
8. `create` on `/admissionInquiries` with oversized `parentName` (> 100 chars).
9. `create` on `/admissionInquiries` with invalid `program` value (`'Unknown'`).
10. `create` on `/campusVisits` with malformed `preferredDate` (`'not-a-date'`).
11. `update` on `/admissionInquiries` attempting to tamper with `parentName` or `createdAt`.
12. `create` on `/admins/{uid}` by non-admin user trying to escalate privileges.
