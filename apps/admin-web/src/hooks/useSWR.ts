/**
 * SWR Hooks for Data Fetching
 * Provides optimized data fetching with caching, revalidation, and error handling
 */

import useSWR, { SWRConfiguration, mutate } from 'swr';
import useSWRMutation from 'swr/mutation';
import { apiClient } from '../lib/api/unifiedClient';
import type { 
  ReservationClient, 
  CustomerClient, 
  ServiceClient,
  PaginatedClientResponse 
} from '../lib/api/mapper';

/**
 * Default SWR configuration
 */
const defaultConfig: SWRConfiguration = {
  revalidateOnFocus: true,
  revalidateOnReconnect: true,
  dedupingInterval: 2000,
  errorRetryCount: 3,
  errorRetryInterval: 5000,
  shouldRetryOnError: (error: any) => {
    // Don't retry on 4xx errors except 429
    if (error?.status >= 400 && error?.status < 500 && error?.status !== 429) {
      return false;
    }
    return true;
  },
  onErrorRetry: (error, key, config, revalidate, { retryCount }) => {
    // Don't retry on 404
    if (error?.status === 404) return;
    
    // Exponential backoff for 429 (rate limit)
    if (error?.status === 429) {
      const retryAfter = error?.headers?.get('Retry-After');
      const delay = retryAfter ? parseInt(retryAfter) * 1000 : 5000 * Math.pow(2, retryCount);
      setTimeout(() => revalidate({ retryCount }), delay);
      return;
    }
    
    // Default exponential backoff
    setTimeout(() => revalidate({ retryCount }), 5000 * Math.pow(2, retryCount));
  }
};

/**
 * Custom fetcher for SWR
 */
const fetcher = async (url: string) => {
  const endpoint = url.startsWith('/') ? url.slice(1) : url;
  const response = await apiClient.get(endpoint);
  return response;
};

/**
 * Hook for fetching today's reservations
 */
export function useTodayReservations(storeId?: string) {
  const today = new Date().toISOString().split('T')[0];
  const key = storeId ? `/reservations?store_id=${storeId}&date=${today}` : null;
  
  const { data, error, isLoading, isValidating, mutate } = useSWR<ReservationClient[]>(
    key,
    fetcher,
    {
      ...defaultConfig,
      refreshInterval: 30000, // Refresh every 30 seconds
    }
  );

  return {
    reservations: data || [],
    isLoading,
    isValidating,
    isError: !!error,
    error,
    mutate,
  };
}

/**
 * Hook for fetching reservations with pagination
 */
export function useReservations(params: {
  storeId?: string;
  from?: string;
  to?: string;
  status?: string;
  page?: number;
  limit?: number;
}) {
  const queryParams = new URLSearchParams();
  
  if (params.storeId) queryParams.append('store_id', params.storeId);
  if (params.from) queryParams.append('from', params.from);
  if (params.to) queryParams.append('to', params.to);
  if (params.status) queryParams.append('status', params.status);
  if (params.page) queryParams.append('page', params.page.toString());
  if (params.limit) queryParams.append('limit', params.limit.toString());
  
  const key = queryParams.toString() ? `/reservations?${queryParams.toString()}` : null;
  
  const { data, error, isLoading, isValidating, mutate } = useSWR<PaginatedClientResponse<ReservationClient>>(
    key,
    fetcher,
    defaultConfig
  );

  return {
    data: data?.data || [],
    totalCount: data?.totalCount || 0,
    hasMore: data?.hasMore || false,
    nextCursor: data?.nextCursor,
    isLoading,
    isValidating,
    isError: !!error,
    error,
    mutate,
  };
}

/**
 * Hook for fetching customers
 */
export function useCustomers(params: {
  storeId?: string;
  search?: string;
  page?: number;
  limit?: number;
}) {
  const queryParams = new URLSearchParams();
  
  if (params.storeId) queryParams.append('store_id', params.storeId);
  if (params.search) queryParams.append('search', params.search);
  if (params.page) queryParams.append('page', params.page.toString());
  if (params.limit) queryParams.append('limit', params.limit.toString());
  
  const key = queryParams.toString() ? `/customers?${queryParams.toString()}` : null;
  
  const { data, error, isLoading, isValidating, mutate } = useSWR<PaginatedClientResponse<CustomerClient>>(
    key,
    fetcher,
    defaultConfig
  );

  return {
    customers: data?.data || [],
    totalCount: data?.totalCount || 0,
    hasMore: data?.hasMore || false,
    nextCursor: data?.nextCursor,
    isLoading,
    isValidating,
    isError: !!error,
    error,
    mutate,
  };
}

/**
 * Hook for fetching services/menus
 */
export function useServices(storeId?: string) {
  const key = storeId ? `/services?store_id=${storeId}` : null;
  
  const { data, error, isLoading, isValidating, mutate } = useSWR<ServiceClient[]>(
    key,
    fetcher,
    {
      ...defaultConfig,
      revalidateIfStale: false, // Services don't change often
      revalidateOnFocus: false,
    }
  );

  return {
    services: data || [],
    isLoading,
    isValidating,
    isError: !!error,
    error,
    mutate,
  };
}

/**
 * Hook for updating reservation status
 */
export function useUpdateReservationStatus() {
  const updateStatus = async (url: string, { arg }: { arg: { id: string; status: string } }) => {
    const response = await apiClient.patch(`reservations/${arg.id}`, {
      status: arg.status
    });
    
    // Invalidate related caches
    mutate((key) => typeof key === 'string' && key.startsWith('/reservations'), undefined, { revalidate: true });
    
    return response;
  };

  return useSWRMutation('/reservations', updateStatus);
}

/**
 * Hook for creating a new service
 */
export function useCreateService() {
  const createService = async (url: string, { arg }: { arg: Partial<ServiceClient> }) => {
    const response = await apiClient.post('services', arg);
    
    // Invalidate services cache
    mutate((key) => typeof key === 'string' && key.startsWith('/services'), undefined, { revalidate: true });
    
    return response;
  };

  return useSWRMutation('/services', createService);
}

/**
 * Hook for updating a service
 */
export function useUpdateService() {
  const updateService = async (url: string, { arg }: { arg: { id: string; data: Partial<ServiceClient> } }) => {
    const response = await apiClient.patch(`services/${arg.id}`, arg.data);
    
    // Invalidate services cache
    mutate((key) => typeof key === 'string' && key.startsWith('/services'), undefined, { revalidate: true });
    
    return response;
  };

  return useSWRMutation('/services', updateService);
}

/**
 * Hook for deleting a service
 */
export function useDeleteService() {
  const deleteService = async (url: string, { arg }: { arg: { id: string } }) => {
    const response = await apiClient.delete(`services/${arg.id}`);
    
    // Invalidate services cache
    mutate((key) => typeof key === 'string' && key.startsWith('/services'), undefined, { revalidate: true });
    
    return response;
  };

  return useSWRMutation('/services', deleteService);
}

/**
 * Prefetch data for faster navigation
 */
export async function prefetchReservations(storeId: string, date: string) {
  const key = `/reservations?store_id=${storeId}&date=${date}`;
  const data = await fetcher(key);
  mutate(key, data, { revalidate: false });
}

/**
 * Clear all SWR cache
 */
export function clearCache() {
  mutate(() => true, undefined, { revalidate: false });
}

/**
 * Revalidate specific cache keys
 */
export function revalidateCache(pattern: string | RegExp) {
  mutate(
    (key) => {
      if (typeof key !== 'string') return false;
      if (typeof pattern === 'string') return key.includes(pattern);
      return pattern.test(key);
    },
    undefined,
    { revalidate: true }
  );
}