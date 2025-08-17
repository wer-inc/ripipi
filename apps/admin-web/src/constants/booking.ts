// 予約ステータスの定義（統一版）
export const BOOKING_STATUS = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  CANCELLED: 'cancelled',
  COMPLETED: 'completed', // 'done'から統一
  NO_SHOW: 'no_show'
} as const;

export type BookingStatus = typeof BOOKING_STATUS[keyof typeof BOOKING_STATUS];

// ステータスの表示名
export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  [BOOKING_STATUS.PENDING]: '確認待ち',
  [BOOKING_STATUS.CONFIRMED]: '確定',
  [BOOKING_STATUS.CANCELLED]: 'キャンセル',
  [BOOKING_STATUS.COMPLETED]: '完了',
  [BOOKING_STATUS.NO_SHOW]: '無断キャンセル'
};

// ステータスの色設定
export const BOOKING_STATUS_COLORS: Record<BookingStatus, string> = {
  [BOOKING_STATUS.PENDING]: 'bg-yellow-100 text-yellow-800',
  [BOOKING_STATUS.CONFIRMED]: 'bg-blue-100 text-blue-800',
  [BOOKING_STATUS.CANCELLED]: 'bg-red-100 text-red-800',
  [BOOKING_STATUS.COMPLETED]: 'bg-gray-100 text-gray-800',
  [BOOKING_STATUS.NO_SHOW]: 'bg-orange-100 text-orange-800'
};

// Badge variant用の色設定
export const BOOKING_STATUS_BADGE_VARIANTS: Record<BookingStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  [BOOKING_STATUS.PENDING]: 'outline',
  [BOOKING_STATUS.CONFIRMED]: 'default',
  [BOOKING_STATUS.CANCELLED]: 'destructive',
  [BOOKING_STATUS.COMPLETED]: 'secondary',
  [BOOKING_STATUS.NO_SHOW]: 'destructive'
};