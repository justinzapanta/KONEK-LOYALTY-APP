export type Customer = {
  id: string

  firstName: string
  lastName: string

  email: string
  phone: string

  /*
   * Optional because customers
   * can register without an NFC card.
   */
  nfcCardId?: string

  totalPoints: number
  availablePoints: number
  timesEarned: number
  totalRedeemed: number

  createdAt: string
  color: string
}

export type Screen =
  | 'dashboard'
  | 'customers'
  | 'rewards'

export type NFCMode =
  | 'idle'

  /*
   * Background NFC.
   *
   * Known card:
   * open points modal.
   *
   * Unknown card:
   * open registration.
   */
  | 'identify'

  /*
   * Redeem reward using NFC.
   */
  | 'redeem'

  /*
   * Link / replace customer card.
   */
  | 'link'

export type NFCState =
  | 'idle'
  | 'waiting'
  | 'reading'
  | 'detected'
  | 'error'

export const getAvailablePoints = (
  customer: Customer
) => {
  return Math.max(0, customer.availablePoints)
}

// Preview only. The server awards the final points using decimal arithmetic.
export const estimatePurchasePoints = (amount: number, amountPerPoint: number) => {
  if (!Number.isFinite(amount) || !Number.isFinite(amountPerPoint) || amount < 0 || amountPerPoint <= 0) return 0
  const amountCents = Math.round(amount * 100)
  const rateCents = Math.round(amountPerPoint * 100)
  return rateCents > 0 ? Math.round(amountCents * 100 / rateCents) / 100 : 0
}

export const normalizePhone = (
  phone: string
) => {
  let digits =
    phone.replace(/\D/g, '')

  /*
   * 09171234567
   * ->
   * 639171234567
   */
  if (
    digits.length === 11 &&
    digits.startsWith('09')
  ) {
    digits =
      `63${digits.substring(1)}`
  }

  /*
   * 9171234567
   * ->
   * 639171234567
   */
  if (
    digits.length === 10 &&
    digits.startsWith('9')
  ) {
    digits =
      `63${digits}`
  }

  return digits
}

