/**
 * Empty State Components
 * Consistent empty state displays across the application
 */

import React from 'react';
import { LucideIcon, Inbox, Search, Calendar, Users, Package, AlertCircle } from 'lucide-react';
import { cn } from '../../lib/utils';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

/**
 * Base empty state component
 */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className
}: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-12 px-4 text-center", className)}>
      <div className="rounded-full bg-muted p-3 mb-4">
        <Icon className="h-10 w-10 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground max-w-sm mb-4">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/**
 * Empty search results
 */
export function EmptySearchResults({ 
  searchTerm,
  onClear 
}: { 
  searchTerm?: string;
  onClear?: () => void;
}) {
  return (
    <EmptyState
      icon={Search}
      title="検索結果が見つかりません"
      description={searchTerm ? `"${searchTerm}"に一致する結果はありませんでした` : "検索条件を変更してお試しください"}
      action={
        onClear && (
          <button
            onClick={onClear}
            className="text-sm text-primary hover:underline"
          >
            検索条件をクリア
          </button>
        )
      }
    />
  );
}

/**
 * Empty reservations
 */
export function EmptyReservations({ 
  date,
  showAction = false 
}: { 
  date?: string;
  showAction?: boolean;
}) {
  return (
    <EmptyState
      icon={Calendar}
      title="予約がありません"
      description={date ? `${date}の予約はまだありません` : "まだ予約が登録されていません"}
      action={
        showAction && (
          <button className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2">
            新規予約を作成
          </button>
        )
      }
    />
  );
}

/**
 * Empty customers
 */
export function EmptyCustomers() {
  return (
    <EmptyState
      icon={Users}
      title="顧客が登録されていません"
      description="顧客情報はまだ登録されていません。予約が作成されると自動的に追加されます。"
    />
  );
}

/**
 * Empty services/menus
 */
export function EmptyServices({ onAdd }: { onAdd?: () => void }) {
  return (
    <EmptyState
      icon={Package}
      title="サービスが登録されていません"
      description="提供するサービスやメニューを登録してください"
      action={
        onAdd && (
          <button
            onClick={onAdd}
            className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
          >
            サービスを追加
          </button>
        )
      }
    />
  );
}

/**
 * No data available (generic)
 */
export function NoData({ message = "データがありません" }: { message?: string }) {
  return (
    <EmptyState
      icon={Inbox}
      title={message}
      description="表示できるデータがありません"
    />
  );
}

/**
 * Table empty state
 */
export function TableEmptyState({ 
  columns,
  message = "データがありません" 
}: { 
  columns: number;
  message?: string;
}) {
  return (
    <tr>
      <td colSpan={columns} className="h-24 text-center">
        <div className="flex flex-col items-center justify-center py-8">
          <Inbox className="h-8 w-8 text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">{message}</p>
        </div>
      </td>
    </tr>
  );
}

/**
 * Card empty state
 */
export function CardEmptyState({ 
  title = "データがありません",
  description 
}: { 
  title?: string;
  description?: string;
}) {
  return (
    <div className="rounded-lg border border-dashed bg-card p-8">
      <EmptyState
        title={title}
        description={description}
      />
    </div>
  );
}

/**
 * List empty state
 */
export function ListEmptyState({ 
  title = "アイテムがありません",
  description,
  action
}: { 
  title?: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="py-8">
      <EmptyState
        title={title}
        description={description}
        action={action}
      />
    </div>
  );
}