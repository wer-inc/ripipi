/**
 * 統一APIクライアント
 * 既存のapi.tsとlib/api/client.tsを統合
 * データマッパーを使用してcamelCase/snake_caseを自動変換
 */

import ky from 'ky';
import { 
  mapReservationFromApi, 
  mapReservationToApi,
  mapCustomerFromApi,
  mapCustomerToApi,
  mapServiceFromApi,
  mapServiceToApi,
  mapPaginatedResponse,
  keysToSnakeCase,
  keysToCamelCase,
  type ReservationClient,
  type CustomerClient,
  type ServiceClient,
  type PaginatedClientResponse
} from './mapper';
import { analytics, AnalyticsEvent } from '../analytics';

// APIエラークラス
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: any
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// リクエストオプション
interface RequestOptions {
  params?: Record<string, any>;
  body?: any;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

// APIクライアントの設定
interface ApiClientConfig {
  baseURL: string;
  timeout?: number;
  retryLimit?: number;
  hooks?: {
    beforeRequest?: (request: Request) => void | Promise<void>;
    afterResponse?: (response: Response) => void | Promise<void>;
    onError?: (error: Error) => void | Promise<void>;
  };
}

class UnifiedApiClient {
  private client: typeof ky;
  private authToken: string | null = null;
  private tenantId: string | null = null;

  constructor(config: ApiClientConfig) {
    // LocalStorageから既存のトークンを読み込み（ブラウザ環境のみ）
    if (typeof window !== 'undefined' && window.localStorage) {
      this.authToken = localStorage.getItem('admin_token');
      this.tenantId = localStorage.getItem('tenant_id');
    }
    console.log('[API Client] Initializing with config:', {
      baseURL: config.baseURL,
      timeout: config.timeout
    });
    this.client = ky.create({
      prefixUrl: config.baseURL,
      timeout: config.timeout || 30000,
      retry: {
        limit: config.retryLimit || 2,
        methods: ['get', 'put', 'patch', 'delete'],
        statusCodes: [408, 413, 429, 500, 502, 503, 504],
      },
      hooks: {
        beforeRequest: [
          (request) => {
            // 認証トークンの追加
            if (this.authToken) {
              request.headers.set('Authorization', `Bearer ${this.authToken}`);
            }
            
            // テナントIDの追加
            if (this.tenantId) {
              request.headers.set('X-Tenant-ID', this.tenantId);
            }

            // カスタムフック
            config.hooks?.beforeRequest?.(request);
          },
        ],
        afterResponse: [
          async (request, options, response) => {
            // 401エラーの処理
            if (response.status === 401) {
              this.handleUnauthorized();
            }

            // レート制限の処理
            if (response.status === 429) {
              const retryAfter = response.headers.get('Retry-After');
              console.warn(`Rate limited. Retry after ${retryAfter} seconds`);
            }

            // カスタムフック
            config.hooks?.afterResponse?.(response);
          },
        ],
        beforeError: [
          async (error) => {
            // エラーのトラッキング
            analytics.trackError(error as Error, {
              url: error.request?.url,
              method: error.request?.method,
            });

            // カスタムフック
            config.hooks?.onError?.(error);
            
            return error;
          },
        ],
      },
    });
  }

  /**
   * 認証情報の設定
   */
  setAuth(token: string, tenantId?: string) {
    this.authToken = token;
    // LocalStorageに保存（useAuthフックと連携）
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem('admin_token', token);
      if (tenantId) {
        this.tenantId = tenantId;
        localStorage.setItem('tenant_id', tenantId);
      }
    }
  }

  /**
   * 認証情報のクリア
   */
  clearAuth() {
    this.authToken = null;
    this.tenantId = null;
    // LocalStorageからも削除
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.removeItem('admin_token');
      localStorage.removeItem('tenant_id');
    }
  }

  /**
   * 401エラーの処理
   */
  private handleUnauthorized() {
    this.clearAuth();
    // 認証画面へのリダイレクト（React Routerを使用）
    const event = new CustomEvent('auth:unauthorized');
    window.dispatchEvent(event);
  }

  /**
   * エラーレスポンスの処理
   */
  private async handleErrorResponse(error: any): Promise<never> {
    let message = 'An error occurred';
    let status = 500;
    let code: string | undefined;
    let details: any;

    // ky error response shape
    const response = (error as any)?.response;
    if (response) {
      status = response.status || status;
      try {
        const errorData = await response.json();
        message = errorData?.message || errorData?.error || message;
        code = errorData?.code;
        details = errorData?.details;
      } catch {
        message = `HTTP ${status} Error`;
      }
    } else if ((error as any)?.name === 'TimeoutError') {
      status = 408;
      message = 'Request timed out';
    } else if ((error as any)?.message) {
      message = (error as any).message;
    }

    throw new ApiError(message, status, code, details);
  }

  // ============================================
  // 基本的なHTTPメソッド
  // ============================================

  async get<T = any>(endpoint: string, options?: RequestOptions): Promise<T> {
    try {
      const response = await this.client.get(endpoint, {
        searchParams: options?.params ? keysToSnakeCase(options.params) : undefined,
        headers: options?.headers,
        signal: options?.signal,
      });
      const data = await response.json();
      return keysToCamelCase<T>(data);
    } catch (error) {
      return this.handleErrorResponse(error);
    }
  }

  async post<T = any>(endpoint: string, data?: any, options?: RequestOptions): Promise<T> {
    console.log('[API] POST request to:', endpoint, 'with data:', data);
    try {
      const response = await this.client.post(endpoint, {
        json: data ? keysToSnakeCase(data) : undefined,
        searchParams: options?.params ? keysToSnakeCase(options.params) : undefined,
        headers: options?.headers,
        signal: options?.signal,
      });
      const responseData = await response.json();
      console.log('[API] Response received:', responseData);
      return keysToCamelCase<T>(responseData);
    } catch (error) {
      console.error('[API] Request failed:', error);
      return this.handleErrorResponse(error);
    }
  }

  async put<T = any>(endpoint: string, data?: any, options?: RequestOptions): Promise<T> {
    try {
      const response = await this.client.put(endpoint, {
        json: data ? keysToSnakeCase(data) : undefined,
        searchParams: options?.params ? keysToSnakeCase(options.params) : undefined,
        headers: options?.headers,
        signal: options?.signal,
      });
      const responseData = await response.json();
      return keysToCamelCase<T>(responseData);
    } catch (error) {
      return this.handleErrorResponse(error);
    }
  }

  async patch<T = any>(endpoint: string, data?: any, options?: RequestOptions): Promise<T> {
    try {
      const response = await this.client.patch(endpoint, {
        json: data ? keysToSnakeCase(data) : undefined,
        searchParams: options?.params ? keysToSnakeCase(options.params) : undefined,
        headers: options?.headers,
        signal: options?.signal,
      });
      const responseData = await response.json();
      return keysToCamelCase<T>(responseData);
    } catch (error) {
      return this.handleErrorResponse(error);
    }
  }

  async delete<T = any>(endpoint: string, options?: RequestOptions): Promise<T> {
    try {
      const response = await this.client.delete(endpoint, {
        searchParams: options?.params ? keysToSnakeCase(options.params) : undefined,
        headers: options?.headers,
        signal: options?.signal,
      });
      const responseData = await response.json();
      return keysToCamelCase<T>(responseData);
    } catch (error) {
      return this.handleErrorResponse(error);
    }
  }

  // ============================================
  // 予約関連API
  // ============================================

  async getReservations(params?: {
    storeId?: string;
    from?: Date | string;
    to?: Date | string;
    status?: string;
    page?: number;
    limit?: number;
  }): Promise<ReservationClient[]> {
    const response = await this.get('reservations', {
      params: {
        ...params,
        from: params?.from instanceof Date ? params.from.toISOString() : params?.from,
        to: params?.to instanceof Date ? params.to.toISOString() : params?.to,
      },
    });
    
    // APIレスポンスが配列の場合
    if (Array.isArray(response)) {
      return response.map(mapReservationFromApi);
    }
    
    // ページネーションレスポンスの場合
    if (response.data && Array.isArray(response.data)) {
      return response.data.map(mapReservationFromApi);
    }
    
    return [];
  }

  async getReservation(id: string): Promise<ReservationClient> {
    const response = await this.get(`reservations/${id}`);
    return mapReservationFromApi(response);
  }

  async createReservation(data: Partial<ReservationClient>): Promise<ReservationClient> {
    const apiData = mapReservationToApi(data);
    const response = await this.post('reservations', apiData);
    
    analytics.track(AnalyticsEvent.RESERVATION_STATUS_CHANGE, {
      reservation_id: response.reservation_id,
      new_status: 'confirmed',
    } as any);
    
    return mapReservationFromApi(response);
  }

  async updateReservation(id: string, data: Partial<ReservationClient>): Promise<ReservationClient> {
    const apiData = mapReservationToApi(data);
    const response = await this.patch(`reservations/${id}`, apiData);
    
    if (data.status) {
      analytics.track(AnalyticsEvent.RESERVATION_STATUS_CHANGE, {
        reservation_id: id,
        new_status: data.status,
      } as any);
    }
    
    return mapReservationFromApi(response);
  }

  async cancelReservation(id: string, reason?: string): Promise<ReservationClient> {
    const response = await this.post(`reservations/${id}/cancel`, { reason });
    
    analytics.track(AnalyticsEvent.RESERVATION_CANCELLED, {
      reservation_id: id,
      reason,
    } as any);
    
    return mapReservationFromApi(response);
  }

  // ============================================
  // 顧客関連API
  // ============================================

  async getCustomers(params?: {
    search?: string;
    status?: string;
    page?: number;
    limit?: number;
  }): Promise<PaginatedClientResponse<CustomerClient>> {
    const response = await this.get('customers', { params });
    return mapPaginatedResponse(response, mapCustomerFromApi);
  }

  async getCustomer(id: string): Promise<CustomerClient> {
    const response = await this.get(`customers/${id}`);
    return mapCustomerFromApi(response);
  }

  async createCustomer(data: Partial<CustomerClient>): Promise<CustomerClient> {
    const apiData = mapCustomerToApi(data);
    const response = await this.post('customers', apiData);
    
    analytics.track(AnalyticsEvent.CUSTOMER_CREATED, {
      entity_type: 'customer',
      entity_id: response.id,
      action: 'create',
    } as any);
    
    return mapCustomerFromApi(response);
  }

  async updateCustomer(id: string, data: Partial<CustomerClient>): Promise<CustomerClient> {
    const apiData = mapCustomerToApi(data);
    const response = await this.patch(`customers/${id}`, apiData);
    
    analytics.track(AnalyticsEvent.CUSTOMER_UPDATED, {
      entity_type: 'customer',
      entity_id: id,
      action: 'update',
    } as any);
    
    return mapCustomerFromApi(response);
  }

  async deleteCustomer(id: string): Promise<void> {
    await this.delete(`customers/${id}`);
    
    analytics.track(AnalyticsEvent.CUSTOMER_DELETED, {
      entity_type: 'customer',
      entity_id: id,
      action: 'delete',
    } as any);
  }

  // ============================================
  // サービス（メニュー）関連API
  // ============================================

  async getServices(params?: {
    category?: string;
    isActive?: boolean;
    page?: number;
    limit?: number;
  }): Promise<ServiceClient[]> {
    const response = await this.get('services', { params });
    
    if (Array.isArray(response)) {
      return response.map(mapServiceFromApi);
    }
    
    if (response.data && Array.isArray(response.data)) {
      return response.data.map(mapServiceFromApi);
    }
    
    return [];
  }

  async getService(id: string): Promise<ServiceClient> {
    const response = await this.get(`services/${id}`);
    return mapServiceFromApi(response);
  }

  async createService(data: Partial<ServiceClient>): Promise<ServiceClient> {
    const apiData = mapServiceToApi(data);
    const response = await this.post('services', apiData);
    
    analytics.track(AnalyticsEvent.MENU_CREATED, {
      entity_type: 'menu',
      entity_id: response.id,
      action: 'create',
    } as any);
    
    return mapServiceFromApi(response);
  }

  async updateService(id: string, data: Partial<ServiceClient>): Promise<ServiceClient> {
    const apiData = mapServiceToApi(data);
    const response = await this.patch(`services/${id}`, apiData);
    
    analytics.track(AnalyticsEvent.MENU_UPDATED, {
      entity_type: 'menu',
      entity_id: id,
      action: 'update',
    } as any);
    
    return mapServiceFromApi(response);
  }

  async deleteService(id: string): Promise<void> {
    await this.delete(`services/${id}`);
    
    analytics.track(AnalyticsEvent.MENU_DELETED, {
      entity_type: 'menu',
      entity_id: id,
      action: 'delete',
    } as any);
  }

  // ============================================
  // スタッフ関連API
  // ============================================

  async getStaff(params?: {
    isActive?: boolean;
    page?: number;
    limit?: number;
  }): Promise<any[]> {
    const response = await this.get('staff', { params });
    
    if (Array.isArray(response)) {
      return response;
    }
    
    if (response.data && Array.isArray(response.data)) {
      return response.data;
    }
    
    return [];
  }

  async getStaffMember(id: string): Promise<any> {
    return this.get(`staff/${id}`);
  }

  async createStaffMember(data: any): Promise<any> {
    const response = await this.post('staff', data);
    
    analytics.track(AnalyticsEvent.STAFF_CREATED, {
      entity_type: 'staff',
      entity_id: response.id,
      action: 'create',
    } as any);
    
    return response;
  }

  async updateStaffMember(id: string, data: any): Promise<any> {
    const response = await this.patch(`staff/${id}`, data);
    
    analytics.track(AnalyticsEvent.STAFF_UPDATED, {
      entity_type: 'staff',
      entity_id: id,
      action: 'update',
    } as any);
    
    return response;
  }

  async deleteStaffMember(id: string): Promise<void> {
    await this.delete(`staff/${id}`);
    
    analytics.track(AnalyticsEvent.STAFF_DELETED, {
      entity_type: 'staff',
      entity_id: id,
      action: 'delete',
    } as any);
  }

  // ============================================
  // 設定関連API
  // ============================================

  async getSettings(): Promise<any> {
    return this.get('settings');
  }

  async updateSettings(data: any): Promise<any> {
    const response = await this.put('settings', data);
    
    analytics.track(AnalyticsEvent.SETTINGS_UPDATED, {
      entity_type: 'settings',
      action: 'update',
    } as any);
    
    return response;
  }

  async getStoreInfo(): Promise<any> {
    return this.get('settings/store');
  }

  async updateStoreInfo(data: any): Promise<any> {
    const response = await this.put('settings/store', data);
    
    analytics.track(AnalyticsEvent.SETTINGS_UPDATED, {
      entity_type: 'store_info',
      action: 'update',
    } as any);
    
    return response;
  }

  async getBookingSettings(): Promise<any> {
    return this.get('settings/booking');
  }

  async updateBookingSettings(data: any): Promise<any> {
    const response = await this.put('settings/booking', data);
    
    analytics.track(AnalyticsEvent.SETTINGS_UPDATED, {
      entity_type: 'booking_settings',
      action: 'update',
    } as any);
    
    return response;
  }

  async getNotificationSettings(): Promise<any> {
    return this.get('settings/notifications');
  }

  async updateNotificationSettings(data: any): Promise<any> {
    const response = await this.put('settings/notifications', data);
    
    analytics.track(AnalyticsEvent.SETTINGS_UPDATED, {
      entity_type: 'notification_settings',
      action: 'update',
    } as any);
    
    return response;
  }

  // ============================================
  // タイムスロット関連API
  // ============================================

  async generateTimeslots(data: {
    resourceId: string;
    startDate: Date | string;
    endDate: Date | string;
    duration: number;
    businessHours: any[];
    buffer?: number;
    skipExisting?: boolean;
  }): Promise<{ generated: number; updated: number; deleted: number }> {
    const apiData = {
      ...data,
      startDate: data.startDate instanceof Date ? data.startDate.toISOString() : data.startDate,
      endDate: data.endDate instanceof Date ? data.endDate.toISOString() : data.endDate,
    };
    
    return this.post('timeslots/generate', apiData);
  }

  async getTimeslots(params: {
    serviceId?: string;
    resourceId?: string;
    from: Date | string;
    to: Date | string;
    limit?: number;
    cursor?: string;
  }): Promise<any[]> {
    const apiParams = {
      ...params,
      from: params.from instanceof Date ? params.from.toISOString() : params.from,
      to: params.to instanceof Date ? params.to.toISOString() : params.to,
    };
    
    const response = await this.get('timeslots', { params: apiParams });
    
    if (Array.isArray(response)) {
      return response;
    }
    
    if (response.data && Array.isArray(response.data)) {
      return response.data;
    }
    
    return [];
  }

  // ============================================
  // 空き状況確認API
  // ============================================

  async checkAvailability(params: {
    serviceId: string;
    startTime: Date | string;
    endTime: Date | string;
    resourceId?: string;
  }): Promise<{ available: boolean; conflicts: any[] }> {
    const apiParams = {
      ...params,
      startTime: params.startTime instanceof Date ? params.startTime.toISOString() : params.startTime,
      endTime: params.endTime instanceof Date ? params.endTime.toISOString() : params.endTime,
    };
    
    return this.post('availability/check', apiParams);
  }

  // ============================================
  // 認証関連API
  // ============================================

  async login(email: string, password: string): Promise<{ token: string; user: any }> {
    try {
      const raw = await this.post('auth/login', { email, password });
      
      // Normalize various response shapes into { token, user }
      const token =
        (raw as any)?.token ??
        (raw as any)?.accessToken ??
        (raw as any)?.data?.accessToken ??
        (raw as any)?.data?.token;
      const user =
        (raw as any)?.user ??
        (raw as any)?.data?.user ??
        undefined;

      if (token) {
        this.setAuth(token, user?.tenantId);
        analytics.track(AnalyticsEvent.LOGIN_SUCCESS, {
          user_id: user?.id,
          tenant_id: user?.tenantId,
        } as any);
      }
      
      return { token, user } as { token: string; user: any };
    } catch (error) {
      analytics.track(AnalyticsEvent.LOGIN_FAILED, {
        email,
        error: (error as Error).message,
      } as any);
      throw error;
    }
  }

  async logout(): Promise<void> {
    try {
      await this.post('auth/logout');
    } finally {
      this.clearAuth();
      analytics.track(AnalyticsEvent.LOGOUT, {});
    }
  }

  async refreshToken(): Promise<{ token: string }> {
    const response = await this.post('auth/refresh');
    if (response.token) {
      this.authToken = response.token;
    }
    return response;
  }

  async getCurrentUser(): Promise<any> {
    const raw = await this.get('auth/me');
    // Try common shapes: { user }, { data: { user } }, { data }, or user object itself
    const user = (raw as any)?.user ?? (raw as any)?.data?.user ?? ((raw as any)?.data && (raw as any)?.data?.id ? (raw as any)?.data : undefined) ?? ((raw as any)?.id ? raw : undefined);
    return user ?? raw;
  }
}

// シングルトンインスタンスを作成してエクスポート
const apiBase = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, '');
const apiClient = new UnifiedApiClient({
  baseURL: apiBase,
  timeout: 30000,
  retryLimit: 2,
  hooks: {
    onError: (error) => {
      console.error('API Error:', error);
    },
  },
});

export default apiClient;
export { apiClient };