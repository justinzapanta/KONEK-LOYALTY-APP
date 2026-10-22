export type Reward = {
  id: string

  name: string
  description: string

  pointsCost: number

  stock?: number

  status:
    | 'active'
    | 'inactive'

  imageUrl: string
}

