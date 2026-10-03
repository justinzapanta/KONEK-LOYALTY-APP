export type Customer = {
  id: string
  firstName: string
  lastName: string
  email?: string
  phone?: string
  nfcCardId: string
  totalPoints: number
  timesEarned: number
  totalRedeemed: number
  createdAt: string
  color: string
}

export type Screen = 'dashboard' | 'customers' | 'profile'
export type NFCMode = 'idle' | 'create' | 'reward'
export type NFCState = 'waiting' | 'reading' | 'error'
export type NewCustomer = Omit<Customer, 'id' | 'nfcCardId' | 'totalPoints' | 'timesEarned' | 'totalRedeemed' | 'createdAt' | 'color'>

export const POINTS_PER_AMOUNT = 100

export const getAvailablePoints = (customer: Customer) => Math.max(0, customer.totalPoints - customer.totalRedeemed)

export const initialCustomers: Customer[] = [
  { id: '1', firstName: 'Maya', lastName: 'Thompson', nfcCardId: '04A1...', totalPoints: 2840, timesEarned: 18, totalRedeemed: 1200, createdAt: 'Aug 24, 2026', color: '#F28C70' },
  { id: '2', firstName: 'Ethan', lastName: 'Martinez', nfcCardId: '04B2...', totalPoints: 1560, timesEarned: 11, totalRedeemed: 600, createdAt: 'Aug 19, 2026', color: '#B9E8EB' },
  { id: '3', firstName: 'Sofia', lastName: 'Williams', nfcCardId: '04C3...', totalPoints: 980, timesEarned: 7, totalRedeemed: 400, createdAt: 'Aug 12, 2026', color: '#F7D98B' },
  { id: '4', firstName: 'Noah', lastName: 'Anderson', nfcCardId: '04D4...', totalPoints: 740, timesEarned: 5, totalRedeemed: 200, createdAt: 'Jul 30, 2026', color: '#C8B5ED' },
]
