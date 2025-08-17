export interface Customer {
  id: string
  name: string
  email?: string
  phone?: string
  lineUserId?: string
  registeredAt: string
  lastVisitAt?: string
  totalVisits: number
  totalSpent: number
  status: 'active' | 'inactive'
  preferences?: {
    notifications: boolean
    newsletter: boolean
  }
  notes?: string
}

export interface CustomerCreateInput {
  name: string
  email?: string
  phone?: string
  lineUserId?: string
  notes?: string
}

export interface CustomerUpdateInput extends Partial<CustomerCreateInput> {
  status?: 'active' | 'inactive'
  preferences?: {
    notifications: boolean
    newsletter: boolean
  }
}

export interface CustomerFilters {
  search?: string
  status?: 'active' | 'inactive' | 'all'
}

export interface PaginationParams {
  page: number
  limit: number
}

export interface CustomerListResponse {
  data: Customer[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}