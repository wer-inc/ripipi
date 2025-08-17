import { useState, useEffect, useCallback } from 'react';
// Note: unified client throws ApiError; we treat any Error uniformly here

interface UseApiState<T> {
  data: T | null;
  error: Error | null;
  isLoading: boolean;
  isError: boolean;
}

interface UseApiOptions {
  immediate?: boolean;
  onSuccess?: (data: any) => void;
  onError?: (error: Error) => void;
}

export function useApi<T>(
  apiFunction: (...args: any[]) => Promise<T>,
  options: UseApiOptions = {}
) {
  const { immediate = true, onSuccess, onError } = options;
  const [state, setState] = useState<UseApiState<T>>({
    data: null,
    error: null,
    isLoading: immediate,
    isError: false,
  });

  const execute = useCallback(async (...args: any[]) => {
    setState(prev => ({ ...prev, isLoading: true, error: null, isError: false }));

    try {
      const result = await apiFunction(...args);
      setState({
        data: result,
        error: null,
        isLoading: false,
        isError: false,
      });
      
      if (onSuccess) {
        onSuccess(result);
      }
      
      return result;
    } catch (error) {
      const apiError = error instanceof Error ? error : new Error('An error occurred');
      setState({
        data: null,
        error: apiError,
        isLoading: false,
        isError: true,
      });
      
      if (onError) {
        onError(apiError);
      }
      
      throw error;
    }
  }, [apiFunction, onSuccess, onError]);

  const reset = useCallback(() => {
    setState({
      data: null,
      error: null,
      isLoading: false,
      isError: false,
    });
  }, []);

  return {
    ...state,
    execute,
    reset,
  };
}

// Hook for paginated data
export function usePaginatedApi<T>(
  apiFunction: (params: any) => Promise<{ data: T[]; pagination: any }>,
  initialParams: any = {}
) {
  const [params, setParams] = useState(initialParams);
  const [items, setItems] = useState<T[]>([]);
  const [pagination, setPagination] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async (newParams?: any) => {
    const fetchParams = newParams || params;
    setIsLoading(true);
    setError(null);

    try {
      const response = await apiFunction(fetchParams);
      setItems(response.data);
      setPagination(response.pagination);
      if (newParams) {
        setParams(newParams);
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch data'));
    } finally {
      setIsLoading(false);
    }
  }, [apiFunction, params]);

  useEffect(() => {
    fetchData();
  }, []);

  const refresh = useCallback(() => {
    fetchData();
  }, [fetchData]);

  const updateParams = useCallback((newParams: any) => {
    fetchData({ ...params, ...newParams });
  }, [fetchData, params]);

  const nextPage = useCallback(() => {
    if (pagination?.hasNext) {
      updateParams({ page: (pagination.page || 1) + 1 });
    }
  }, [pagination, updateParams]);

  const prevPage = useCallback(() => {
    if (pagination?.hasPrev) {
      updateParams({ page: (pagination.page || 1) - 1 });
    }
  }, [pagination, updateParams]);

  return {
    items,
    pagination,
    isLoading,
    error,
    refresh,
    updateParams,
    nextPage,
    prevPage,
  };
}

// Hook for real-time data updates (can be extended with WebSocket support)
export function useRealtimeData<T>(
  fetchFunction: () => Promise<T>,
  interval: number = 30000 // Default 30 seconds
) {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const result = await fetchFunction();
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch data'));
    } finally {
      setIsLoading(false);
    }
  }, [fetchFunction]);

  useEffect(() => {
    fetchData();
    
    const intervalId = setInterval(fetchData, interval);
    
    return () => clearInterval(intervalId);
  }, [fetchData, interval]);

  return { data, isLoading, error, refresh: fetchData };
}