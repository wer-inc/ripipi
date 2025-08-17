/**
 * Error State Components
 * Consistent error state displays with problem+json support
 */

import React from 'react';
import { AlertCircle, WifiOff, RefreshCw, XCircle, AlertTriangle, Info } from 'lucide-react';
import { cn } from '../../lib/utils';

interface ErrorDetails {
  field?: string;
  reason: string;
  value?: any;
}

interface ProblemDetail {
  type?: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  code: string;
  message: string;
  details?: ErrorDetails[];
  traceId?: string;
  timestamp?: string;
}

interface ErrorStateProps {
  error?: Error | ProblemDetail | any;
  title?: string;
  description?: string;
  onRetry?: () => void;
  showDetails?: boolean;
  className?: string;
}

/**
 * Base error state component
 */
export function ErrorState({
  error,
  title,
  description,
  onRetry,
  showDetails = false,
  className
}: ErrorStateProps) {
  const problemDetail = isProblemDetail(error) ? error : null;
  const errorTitle = title || problemDetail?.title || 'エラーが発生しました';
  const errorDescription = description || problemDetail?.detail || problemDetail?.message || getErrorMessage(error);
  const statusCode = problemDetail?.status || (error as any)?.status;

  return (
    <div className={cn("flex flex-col items-center justify-center py-12 px-4 text-center", className)}>
      <div className="rounded-full bg-destructive/10 p-3 mb-4">
        {getErrorIcon(statusCode)}
      </div>
      
      <h3 className="text-lg font-semibold mb-2">{errorTitle}</h3>
      
      {errorDescription && (
        <p className="text-sm text-muted-foreground max-w-sm mb-4">
          {errorDescription}
        </p>
      )}
      
      {problemDetail?.code && (
        <div className="text-xs text-muted-foreground mb-2">
          エラーコード: {problemDetail.code}
        </div>
      )}
      
      {showDetails && problemDetail?.details && problemDetail.details.length > 0 && (
        <div className="mt-4 w-full max-w-md">
          <details className="text-left">
            <summary className="cursor-pointer text-sm font-medium mb-2">
              詳細情報
            </summary>
            <div className="rounded-lg bg-muted p-3 space-y-2">
              {problemDetail.details.map((detail, index) => (
                <div key={index} className="text-xs">
                  {detail.field && <span className="font-medium">{detail.field}: </span>}
                  <span className="text-muted-foreground">{detail.reason}</span>
                </div>
              ))}
            </div>
          </details>
        </div>
      )}
      
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-2 text-sm text-primary hover:underline"
        >
          <RefreshCw className="h-4 w-4" />
          再試行
        </button>
      )}
      
      {problemDetail?.traceId && (
        <div className="mt-4 text-xs text-muted-foreground">
          トレースID: {problemDetail.traceId}
        </div>
      )}
    </div>
  );
}

/**
 * Network error state
 */
export function NetworkError({ onRetry }: { onRetry?: () => void }) {
  return (
    <ErrorState
      title="ネットワークエラー"
      description="インターネット接続を確認してください"
      onRetry={onRetry}
    />
  );
}

/**
 * 404 Not Found error
 */
export function NotFoundError({ 
  resource = "ページ",
  onBack 
}: { 
  resource?: string;
  onBack?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="rounded-full bg-muted p-3 mb-4">
        <AlertCircle className="h-10 w-10 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold mb-2">{resource}が見つかりません</h3>
      <p className="text-sm text-muted-foreground max-w-sm mb-4">
        お探しの{resource}は存在しないか、削除された可能性があります
      </p>
      {onBack && (
        <button
          onClick={onBack}
          className="text-sm text-primary hover:underline"
        >
          戻る
        </button>
      )}
    </div>
  );
}

/**
 * Permission denied error
 */
export function PermissionDeniedError() {
  return (
    <ErrorState
      title="アクセス権限がありません"
      description="このページを表示する権限がありません。管理者にお問い合わせください。"
    />
  );
}

/**
 * Rate limit error
 */
export function RateLimitError({ retryAfter }: { retryAfter?: number }) {
  return (
    <ErrorState
      title="リクエスト制限に達しました"
      description={
        retryAfter 
          ? `${retryAfter}秒後に再試行してください`
          : "しばらく待ってから再試行してください"
      }
    />
  );
}

/**
 * Validation error with field details
 */
export function ValidationError({ error }: { error: ProblemDetail }) {
  return (
    <ErrorState
      error={error}
      title="入力内容にエラーがあります"
      showDetails={true}
    />
  );
}

/**
 * Generic server error
 */
export function ServerError({ onRetry }: { onRetry?: () => void }) {
  return (
    <ErrorState
      title="サーバーエラー"
      description="サーバーで問題が発生しました。しばらく待ってから再試行してください。"
      onRetry={onRetry}
    />
  );
}

/**
 * Error boundary fallback
 */
export function ErrorBoundaryFallback({ 
  error,
  resetErrorBoundary 
}: { 
  error: Error;
  resetErrorBoundary?: () => void;
}) {
  return (
    <div className="min-h-[400px] flex items-center justify-center">
      <ErrorState
        error={error}
        title="予期しないエラーが発生しました"
        description="ページの再読み込みをお試しください"
        onRetry={resetErrorBoundary}
        showDetails={process.env.NODE_ENV === 'development'}
      />
    </div>
  );
}

/**
 * Table error row
 */
export function TableErrorRow({ 
  columns,
  error,
  onRetry
}: { 
  columns: number;
  error?: any;
  onRetry?: () => void;
}) {
  return (
    <tr>
      <td colSpan={columns} className="h-24 text-center">
        <ErrorState
          error={error}
          onRetry={onRetry}
          className="py-8"
        />
      </td>
    </tr>
  );
}

/**
 * Inline error message
 */
export function InlineError({ 
  message,
  className 
}: { 
  message: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2 text-sm text-destructive", className)}>
      <XCircle className="h-4 w-4" />
      <span>{message}</span>
    </div>
  );
}

/**
 * Error alert banner
 */
export function ErrorAlert({ 
  title,
  message,
  onClose 
}: { 
  title?: string;
  message: string;
  onClose?: () => void;
}) {
  return (
    <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" />
        <div className="flex-1">
          {title && <h4 className="text-sm font-medium mb-1">{title}</h4>}
          <p className="text-sm text-muted-foreground">{message}</p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <XCircle className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

// Helper functions

function isProblemDetail(error: any): error is ProblemDetail {
  return error && typeof error === 'object' && 'code' in error && 'status' in error;
}

function getErrorMessage(error: any): string {
  if (typeof error === 'string') return error;
  if (error?.message) return error.message;
  if (error?.detail) return error.detail;
  return 'エラーが発生しました';
}

function getErrorIcon(statusCode?: number) {
  if (!statusCode) return <AlertCircle className="h-10 w-10 text-destructive" />;
  
  if (statusCode >= 500) {
    return <AlertTriangle className="h-10 w-10 text-destructive" />;
  } else if (statusCode === 404) {
    return <AlertCircle className="h-10 w-10 text-muted-foreground" />;
  } else if (statusCode === 403 || statusCode === 401) {
    return <XCircle className="h-10 w-10 text-destructive" />;
  } else if (statusCode === 429) {
    return <AlertTriangle className="h-10 w-10 text-warning" />;
  } else {
    return <Info className="h-10 w-10 text-destructive" />;
  }
}