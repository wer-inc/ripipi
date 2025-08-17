import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';

interface UseRealtimeDataOptions {
  initialInterval?: number; // 初期ポーリング間隔（ミリ秒）
  maxInterval?: number; // 最大ポーリング間隔（ミリ秒）
  enableWhenHidden?: boolean; // タブが非アクティブ時もポーリングするか
  enableExponentialBackoff?: boolean; // 指数バックオフを有効にするか
  onError?: (error: Error) => void;
}

interface UseRealtimeDataReturn<T> {
  data: T | null;
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  updateInterval: (interval: number) => void;
}

/**
 * リアルタイムデータ取得用の最適化されたフック
 * - タブ非アクティブ時の自動停止
 * - 指数バックオフによるレート制限対策
 * - エラー時の自動リトライ
 * - 手動リフレッシュ機能
 */
export function useRealtimeData<T>(
  fetcher: () => Promise<T>,
  options: UseRealtimeDataOptions = {}
): UseRealtimeDataReturn<T> {
  const {
    initialInterval = 30000, // デフォルト30秒
    maxInterval = 300000, // 最大5分
    enableWhenHidden = false,
    enableExponentialBackoff = true,
    onError
  } = options;

  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const currentIntervalRef = useRef(initialInterval);
  const retryCountRef = useRef(0);
  const isDocumentHiddenRef = useRef(false);
  const location = useLocation();

  // データ取得関数
  const fetchData = useCallback(async () => {
    // タブが非アクティブでポーリング無効の場合はスキップ
    if (isDocumentHiddenRef.current && !enableWhenHidden) {
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const result = await fetcher();
      setData(result);
      
      // 成功時はリトライカウントとインターバルをリセット
      retryCountRef.current = 0;
      currentIntervalRef.current = initialInterval;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      setError(error);
      
      // エラーコールバックを呼び出し
      onError?.(error);
      
      // 429エラー（レート制限）の場合は指数バックオフ
      if (enableExponentialBackoff && error.message.includes('429')) {
        retryCountRef.current++;
        currentIntervalRef.current = Math.min(
          initialInterval * Math.pow(2, retryCountRef.current),
          maxInterval
        );
      }
    } finally {
      setIsLoading(false);
    }
  }, [fetcher, enableWhenHidden, enableExponentialBackoff, initialInterval, maxInterval, onError]);

  // ポーリングの開始
  const startPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    // 即座に最初のフェッチを実行
    fetchData();

    // インターバルを設定
    intervalRef.current = setInterval(() => {
      if (!isPaused) {
        fetchData();
      }
    }, currentIntervalRef.current);
  }, [fetchData, isPaused]);

  // 手動リフレッシュ
  const refresh = useCallback(async () => {
    await fetchData();
    // リフレッシュ後はポーリングを再開
    startPolling();
  }, [fetchData, startPolling]);

  // ポーリングの一時停止
  const pause = useCallback(() => {
    setIsPaused(true);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // ポーリングの再開
  const resume = useCallback(() => {
    setIsPaused(false);
    startPolling();
  }, [startPolling]);

  // インターバルの更新
  const updateInterval = useCallback((newInterval: number) => {
    currentIntervalRef.current = newInterval;
    if (!isPaused) {
      startPolling();
    }
  }, [isPaused, startPolling]);

  // タブの可視性変化を監視
  useEffect(() => {
    const handleVisibilityChange = () => {
      isDocumentHiddenRef.current = document.hidden;
      
      if (document.hidden && !enableWhenHidden) {
        // タブが非アクティブになったらポーリングを停止
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      } else if (!document.hidden && !isPaused) {
        // タブがアクティブになったら即座にフェッチしてポーリング再開
        fetchData();
        startPolling();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enableWhenHidden, isPaused, fetchData, startPolling]);

  // オンライン/オフライン状態の監視
  useEffect(() => {
    const handleOnline = () => {
      if (!isPaused) {
        // オンラインに復帰したら即座にフェッチ
        fetchData();
        startPolling();
      }
    };

    const handleOffline = () => {
      // オフラインになったらポーリングを停止
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [isPaused, fetchData, startPolling]);

  // ルート変更時の処理
  useEffect(() => {
    // ルートが変わったら即座にフェッチ
    fetchData();
  }, [location.pathname, fetchData]);

  // 初期化とクリーンアップ
  useEffect(() => {
    startPolling();
    
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [startPolling]);

  return {
    data,
    isLoading,
    error,
    refresh,
    pause,
    resume,
    updateInterval
  };
}

/**
 * 当日予約用の特化型フック
 * デフォルトで30秒ポーリング、タブ非アクティブ時は停止
 */
export function useTodayReservations<T>(fetcher: () => Promise<T>) {
  return useRealtimeData(fetcher, {
    initialInterval: 30000, // 30秒
    maxInterval: 120000, // 最大2分
    enableWhenHidden: false, // タブが非アクティブ時は停止
    enableExponentialBackoff: true // レート制限対策を有効化
  });
}