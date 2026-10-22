// Completion already awards the points or issues the voucher. Ready vouchers
// remain in their own checkout list, even after this challenge tile disappears.
export function pendingChallenges<T extends { completed: boolean }>(challenges: T[] = []): T[] {
  return challenges.filter(challenge => !challenge.completed)
}

// Only persisted claims loaded before this purchase are eligible. Preview rewards
// are informational: their IDs are temporary until the earning order is saved.
export function availableVouchers<T extends { selection: string }>(vouchers: T[] = []): T[] {
  return vouchers.filter(voucher => /^claim:[0-9a-f-]{36}$/i.test(voucher.selection))
}
