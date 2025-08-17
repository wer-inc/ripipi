/**
 * 分析・計測ラッパー
 * Google Analytics 4、その他の分析ツールとの統合
 */

// イベントタイプの定義
export enum AnalyticsEvent {
  // ページビュー
  PAGE_VIEW = 'page_view',
  
  // 認証関連
  LOGIN_SUCCESS = 'login_success',
  LOGIN_FAILED = 'login_failed',
  LOGOUT = 'logout',
  
  // 予約管理
  RESERVATION_STATUS_CHANGE = 'reservation_status_change',
  RESERVATION_CANCELLED = 'reservation_cancelled',
  RESERVATION_COMPLETED = 'reservation_completed',
  RESERVATION_NO_SHOW = 'reservation_no_show',
  
  // CRUD操作
  CUSTOMER_CREATED = 'customer_created',
  CUSTOMER_UPDATED = 'customer_updated',
  CUSTOMER_DELETED = 'customer_deleted',
  MENU_CREATED = 'menu_created',
  MENU_UPDATED = 'menu_updated',
  MENU_DELETED = 'menu_deleted',
  SETTINGS_UPDATED = 'settings_updated',
  STAFF_CREATED = 'staff_created',
  STAFF_UPDATED = 'staff_updated',
  STAFF_DELETED = 'staff_deleted',
  
  // 検索・フィルター
  SEARCH_PERFORMED = 'search_performed',
  FILTER_APPLIED = 'filter_applied',
  
  // エラー
  API_ERROR = 'api_error',
  VALIDATION_ERROR = 'validation_error',
  
  // パフォーマンス
  PAGE_LOAD_TIME = 'page_load_time',
  API_RESPONSE_TIME = 'api_response_time',
}

// イベントパラメータの型定義
interface BaseEventParams {
  timestamp?: number;
  user_id?: string;
  tenant_id?: string;
  session_id?: string;
}

interface ReservationEventParams extends BaseEventParams {
  reservation_id: string;
  old_status?: string;
  new_status: string;
  service_id?: string;
  resource_id?: string;
}

interface CrudEventParams extends BaseEventParams {
  entity_type: 'customer' | 'menu' | 'settings' | 'staff';
  entity_id: string;
  action: 'create' | 'update' | 'delete';
}

interface SearchEventParams extends BaseEventParams {
  search_query: string;
  search_type: string;
  results_count: number;
}

interface ErrorEventParams extends BaseEventParams {
  error_type: string;
  error_message: string;
  error_code?: string;
  endpoint?: string;
}

interface PerformanceEventParams extends BaseEventParams {
  metric_name: string;
  value: number;
  unit: 'ms' | 'bytes' | 'count';
}

type EventParams = 
  | ReservationEventParams 
  | CrudEventParams 
  | SearchEventParams 
  | ErrorEventParams 
  | PerformanceEventParams
  | BaseEventParams;

// Google Analytics 4の型定義
declare global {
  interface Window {
    gtag?: (
      command: 'event' | 'config' | 'set',
      targetId: string,
      config?: any
    ) => void;
    dataLayer?: any[];
  }
}

class Analytics {
  private static instance: Analytics;
  private isInitialized = false;
  private userId: string | null = null;
  private tenantId: string | null = null;
  private sessionId: string;
  private debug = import.meta.env.DEV;

  private constructor() {
    // セッションIDを生成
    this.sessionId = this.generateSessionId();
    
    // Google Analytics 4の初期化
    this.initializeGA4();
  }

  public static getInstance(): Analytics {
    if (!Analytics.instance) {
      Analytics.instance = new Analytics();
    }
    return Analytics.instance;
  }

  /**
   * Google Analytics 4の初期化
   */
  private initializeGA4() {
    const GA_MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID;
    
    if (!GA_MEASUREMENT_ID) {
      if (this.debug) {
        console.log('[Analytics] GA_MEASUREMENT_ID not configured');
      }
      return;
    }

    // GA4スクリプトの動的読み込み
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
    document.head.appendChild(script);

    // dataLayerの初期化
    window.dataLayer = window.dataLayer || [];
    window.gtag = function() {
      window.dataLayer!.push(arguments);
    };
    
    window.gtag('js', new Date());
    window.gtag('config', GA_MEASUREMENT_ID, {
      send_page_view: false, // 手動でページビューを送信
      debug_mode: this.debug
    });

    this.isInitialized = true;
  }

  /**
   * セッションIDの生成
   */
  private generateSessionId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * ユーザー情報の設定
   */
  public setUser(userId: string, tenantId: string) {
    this.userId = userId;
    this.tenantId = tenantId;
    
    if (window.gtag) {
      window.gtag('set', 'user_properties', {
        user_id: userId,
        tenant_id: tenantId
      });
    }
  }

  /**
   * ユーザー情報のクリア
   */
  public clearUser() {
    this.userId = null;
    this.tenantId = null;
  }

  /**
   * イベントの送信
   */
  public track(eventName: AnalyticsEvent, params?: EventParams) {
    // 基本パラメータを追加
    const enrichedParams = {
      ...params,
      timestamp: Date.now(),
      user_id: this.userId,
      tenant_id: this.tenantId,
      session_id: this.sessionId,
    };

    // デバッグモードでコンソールに出力
    if (this.debug) {
      console.log('[Analytics] Event:', eventName, enrichedParams);
    }

    // Google Analytics 4に送信
    if (this.isInitialized && window.gtag) {
      window.gtag('event', eventName, enrichedParams);
    }

    // 他の分析ツールへの送信をここに追加可能
    // this.sendToMixpanel(eventName, enrichedParams);
    // this.sendToAmplitude(eventName, enrichedParams);
  }

  /**
   * ページビューの送信
   */
  public pageView(path: string, title?: string) {
    this.track(AnalyticsEvent.PAGE_VIEW, {
      page_path: path,
      page_title: title || document.title,
    } as any);
  }

  /**
   * エラーの記録
   */
  public trackError(error: Error, context?: Record<string, any>) {
    this.track(AnalyticsEvent.API_ERROR, {
      error_type: error.name,
      error_message: error.message,
      error_stack: error.stack,
      ...context
    } as ErrorEventParams);
  }

  /**
   * パフォーマンスメトリクスの記録
   */
  public trackPerformance(metricName: string, value: number, unit: 'ms' | 'bytes' | 'count' = 'ms') {
    this.track(AnalyticsEvent.PAGE_LOAD_TIME, {
      metric_name: metricName,
      value,
      unit
    } as PerformanceEventParams);
  }

  /**
   * Web Vitalsの記録
   */
  public trackWebVitals(metric: { name: string; value: number; id: string }) {
    this.trackPerformance(`web_vitals_${metric.name.toLowerCase()}`, metric.value, 'ms');
  }
}

// シングルトンインスタンスをエクスポート
export const analytics = Analytics.getInstance();

// 便利なヘルパー関数
export const trackEvent = (eventName: AnalyticsEvent, params?: EventParams) => {
  analytics.track(eventName, params);
};

export const trackPageView = (path: string, title?: string) => {
  analytics.pageView(path, title);
};

export const trackError = (error: Error, context?: Record<string, any>) => {
  analytics.trackError(error, context);
};

// React用のカスタムフック
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

export function usePageTracking() {
  const location = useLocation();

  useEffect(() => {
    trackPageView(location.pathname + location.search);
  }, [location]);
}

// パフォーマンス計測用のデコレータ
export function measurePerformance(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
  const originalMethod = descriptor.value;

  descriptor.value = async function(...args: any[]) {
    const start = performance.now();
    try {
      const result = await originalMethod.apply(this, args);
      const duration = performance.now() - start;
      analytics.trackPerformance(`method_${propertyKey}`, duration);
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      analytics.trackPerformance(`method_${propertyKey}_error`, duration);
      throw error;
    }
  };

  return descriptor;
}