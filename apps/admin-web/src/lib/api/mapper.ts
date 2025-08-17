/**
 * APIデータマッパー
 * snake_case ⇔ camelCase の相互変換
 * APIレスポンスとクライアント側データ構造の整合性を保つ
 */

/**
 * snake_caseをcamelCaseに変換
 */
export function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * camelCaseをsnake_caseに変換
 */
export function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

/**
 * オブジェクトのキーをsnake_caseからcamelCaseに変換
 */
export function keysToCamelCase<T = any>(obj: any): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(keysToCamelCase) as any;
  }

  if (obj instanceof Date) {
    return obj as any;
  }

  if (typeof obj !== 'object') {
    return obj;
  }

  const converted: any = {};
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const camelKey = toCamelCase(key);
      converted[camelKey] = keysToCamelCase(obj[key]);
    }
  }
  return converted;
}

/**
 * オブジェクトのキーをcamelCaseからsnake_caseに変換
 */
export function keysToSnakeCase<T = any>(obj: any): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(keysToSnakeCase) as any;
  }

  if (obj instanceof Date) {
    return obj.toISOString() as any;
  }

  if (typeof obj !== 'object') {
    return obj;
  }

  const converted: any = {};
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const snakeKey = toSnakeCase(key);
      converted[snakeKey] = keysToSnakeCase(obj[key]);
    }
  }
  return converted;
}

// ============================================
// ドメイン固有のマッパー
// ============================================

/**
 * 予約データのマッピング（API → Client）
 */
export interface ReservationApiResponse {
  reservation_id: string;
  store_id: string;
  member_id: string;
  menu_id: string;
  staff_id?: string;
  start_at: string;
  end_at: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ReservationClient {
  reservationId: string;
  storeId: string;
  memberId: string;
  menuId: string;
  staffId?: string;
  startAt: Date;
  endAt: Date;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export function mapReservationFromApi(data: ReservationApiResponse): ReservationClient {
  return {
    reservationId: data.reservation_id,
    storeId: data.store_id,
    memberId: data.member_id,
    menuId: data.menu_id,
    staffId: data.staff_id,
    startAt: new Date(data.start_at),
    endAt: new Date(data.end_at),
    status: data.status,
    createdAt: new Date(data.created_at),
    updatedAt: new Date(data.updated_at),
  };
}

export function mapReservationToApi(data: Partial<ReservationClient>): Partial<ReservationApiResponse> {
  const mapped: any = {};
  
  if (data.reservationId !== undefined) mapped.reservation_id = data.reservationId;
  if (data.storeId !== undefined) mapped.store_id = data.storeId;
  if (data.memberId !== undefined) mapped.member_id = data.memberId;
  if (data.menuId !== undefined) mapped.menu_id = data.menuId;
  if (data.staffId !== undefined) mapped.staff_id = data.staffId;
  if (data.startAt !== undefined) mapped.start_at = data.startAt.toISOString();
  if (data.endAt !== undefined) mapped.end_at = data.endAt.toISOString();
  if (data.status !== undefined) mapped.status = data.status;
  
  return mapped;
}

/**
 * 顧客データのマッピング（API → Client）
 */
export interface CustomerApiResponse {
  id: string;
  tenant_id: string;
  external_id?: string;
  name: string;
  name_kana?: string;
  email?: string;
  phone?: string;
  line_user_id?: string;
  birth_date?: string;
  gender?: string;
  address?: string;
  notes?: string;
  tags?: string[];
  status: string;
  first_visit_at?: string;
  last_visit_at?: string;
  visit_count: number;
  total_spending: number;
  created_at: string;
  updated_at: string;
}

export interface CustomerClient {
  id: string;
  tenantId: string;
  externalId?: string;
  name: string;
  nameKana?: string;
  email?: string;
  phone?: string;
  lineUserId?: string;
  birthDate?: Date;
  gender?: string;
  address?: string;
  notes?: string;
  tags?: string[];
  status: string;
  firstVisitAt?: Date;
  lastVisitAt?: Date;
  visitCount: number;
  totalSpending: number;
  createdAt: Date;
  updatedAt: Date;
}

export function mapCustomerFromApi(data: CustomerApiResponse): CustomerClient {
  return {
    id: data.id,
    tenantId: data.tenant_id,
    externalId: data.external_id,
    name: data.name,
    nameKana: data.name_kana,
    email: data.email,
    phone: data.phone,
    lineUserId: data.line_user_id,
    birthDate: data.birth_date ? new Date(data.birth_date) : undefined,
    gender: data.gender,
    address: data.address,
    notes: data.notes,
    tags: data.tags,
    status: data.status,
    firstVisitAt: data.first_visit_at ? new Date(data.first_visit_at) : undefined,
    lastVisitAt: data.last_visit_at ? new Date(data.last_visit_at) : undefined,
    visitCount: data.visit_count,
    totalSpending: data.total_spending,
    createdAt: new Date(data.created_at),
    updatedAt: new Date(data.updated_at),
  };
}

export function mapCustomerToApi(data: Partial<CustomerClient>): Partial<CustomerApiResponse> {
  const mapped: any = {};
  
  if (data.id !== undefined) mapped.id = data.id;
  if (data.tenantId !== undefined) mapped.tenant_id = data.tenantId;
  if (data.externalId !== undefined) mapped.external_id = data.externalId;
  if (data.name !== undefined) mapped.name = data.name;
  if (data.nameKana !== undefined) mapped.name_kana = data.nameKana;
  if (data.email !== undefined) mapped.email = data.email;
  if (data.phone !== undefined) mapped.phone = data.phone;
  if (data.lineUserId !== undefined) mapped.line_user_id = data.lineUserId;
  if (data.birthDate !== undefined) mapped.birth_date = data.birthDate.toISOString().split('T')[0];
  if (data.gender !== undefined) mapped.gender = data.gender;
  if (data.address !== undefined) mapped.address = data.address;
  if (data.notes !== undefined) mapped.notes = data.notes;
  if (data.tags !== undefined) mapped.tags = data.tags;
  if (data.status !== undefined) mapped.status = data.status;
  
  return mapped;
}

/**
 * サービス（メニュー）データのマッピング
 */
export interface ServiceApiResponse {
  id: string;
  tenant_id: string;
  name: {
    ja: string;
    en?: string;
  };
  description?: {
    ja: string;
    en?: string;
  };
  category: string;
  duration_min: number;
  buffer_before_min: number;
  buffer_after_min: number;
  price_jpy: number;
  price_info?: any;
  requires_confirmation: boolean;
  is_active: boolean;
  display_order: number;
  metadata?: any;
  created_at: string;
  updated_at: string;
}

export interface ServiceClient {
  id: string;
  tenantId: string;
  name: {
    ja: string;
    en?: string;
  };
  description?: {
    ja: string;
    en?: string;
  };
  category: string;
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  priceJpy: number;
  priceInfo?: any;
  requiresConfirmation: boolean;
  isActive: boolean;
  displayOrder: number;
  metadata?: any;
  createdAt: Date;
  updatedAt: Date;
}

export function mapServiceFromApi(data: ServiceApiResponse): ServiceClient {
  return {
    id: data.id,
    tenantId: data.tenant_id,
    name: data.name,
    description: data.description,
    category: data.category,
    durationMin: data.duration_min,
    bufferBeforeMin: data.buffer_before_min,
    bufferAfterMin: data.buffer_after_min,
    priceJpy: data.price_jpy,
    priceInfo: data.price_info,
    requiresConfirmation: data.requires_confirmation,
    isActive: data.is_active,
    displayOrder: data.display_order,
    metadata: data.metadata,
    createdAt: new Date(data.created_at),
    updatedAt: new Date(data.updated_at),
  };
}

export function mapServiceToApi(data: Partial<ServiceClient>): Partial<ServiceApiResponse> {
  const mapped: any = {};
  
  if (data.id !== undefined) mapped.id = data.id;
  if (data.tenantId !== undefined) mapped.tenant_id = data.tenantId;
  if (data.name !== undefined) mapped.name = data.name;
  if (data.description !== undefined) mapped.description = data.description;
  if (data.category !== undefined) mapped.category = data.category;
  if (data.durationMin !== undefined) mapped.duration_min = data.durationMin;
  if (data.bufferBeforeMin !== undefined) mapped.buffer_before_min = data.bufferBeforeMin;
  if (data.bufferAfterMin !== undefined) mapped.buffer_after_min = data.bufferAfterMin;
  if (data.priceJpy !== undefined) mapped.price_jpy = data.priceJpy;
  if (data.priceInfo !== undefined) mapped.price_info = data.priceInfo;
  if (data.requiresConfirmation !== undefined) mapped.requires_confirmation = data.requiresConfirmation;
  if (data.isActive !== undefined) mapped.is_active = data.isActive;
  if (data.displayOrder !== undefined) mapped.display_order = data.displayOrder;
  if (data.metadata !== undefined) mapped.metadata = data.metadata;
  
  return mapped;
}

/**
 * ページネーションレスポンスのマッピング
 */
export interface PaginatedApiResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    per_page: number;
    total_pages: number;
    has_prev: boolean;
    has_next: boolean;
  };
}

export interface PaginatedClientResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    perPage: number;
    totalPages: number;
    hasPrev: boolean;
    hasNext: boolean;
  };
}

export function mapPaginatedResponse<TApi, TClient>(
  response: PaginatedApiResponse<TApi>,
  dataMapper: (item: TApi) => TClient
): PaginatedClientResponse<TClient> {
  return {
    data: response.data.map(dataMapper),
    meta: {
      total: response.meta.total,
      page: response.meta.page,
      perPage: response.meta.per_page,
      totalPages: response.meta.total_pages,
      hasPrev: response.meta.has_prev,
      hasNext: response.meta.has_next,
    },
  };
}