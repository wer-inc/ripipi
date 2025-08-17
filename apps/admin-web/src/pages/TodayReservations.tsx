import { useState } from 'react';
import { Check, X, Clock, AlertCircle, RefreshCw } from 'lucide-react';
import apiClient from '../lib/api/unifiedClient';
import { formatTime } from '../lib/utils';
import { BOOKING_STATUS, BOOKING_STATUS_LABELS, BOOKING_STATUS_COLORS } from '../constants/booking';
import { useTodayReservations } from '../hooks/useRealtimeData';
import { TableSkeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';

export default function TodayReservations() {
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);
  
  // 最適化されたリアルタイムデータフックを使用
  const fetcher = async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const reservations = await apiClient.getReservations({
      storeId: import.meta.env.VITE_STORE_ID,
      from: today,
      to: tomorrow
    });
    
    // 時間順にソート（Date型になっているので直接比較可能）
    return reservations.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  };

  const { 
    data: reservations = [], 
    isLoading, 
    error,
    refresh 
  } = useTodayReservations(fetcher);
  
  async function updateStatus(reservationId: string, status: string) {
    try {
      setUpdatingStatus(reservationId);
      await apiClient.updateReservation(reservationId, { status });
      
      // 一覧を再読み込み
      refresh();
    } catch (error) {
      console.error('Failed to update status:', error);
      alert('ステータスの更新に失敗しました');
    } finally {
      setUpdatingStatus(null);
    }
  }
  
  const currentTime = new Date();

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">本日の予約一覧</h2>
        <div className="flex items-center gap-4">
          <div className="text-sm text-gray-500">
            {new Date().toLocaleDateString('ja-JP', { 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric',
              weekday: 'long'
            })}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={isLoading}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            更新
          </Button>
        </div>
      </div>
      
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-red-600" />
            <p className="text-red-800">データの取得に失敗しました。</p>
          </div>
        </div>
      )}
      
      {isLoading ? (
        <TableSkeleton rows={5} />
      ) : reservations.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border p-8 text-center">
          <p className="text-gray-500">本日の予約はありません</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  時間
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  顧客
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  メニュー
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  スタッフ
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  ステータス
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  アクション
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {reservations.map((reservation) => {
                const startTime = reservation.startAt;
                const isPast = startTime < currentTime;
                const isUpdating = updatingStatus === reservation.reservationId;
                
                return (
                  <tr key={reservation.reservationId} className={isPast ? 'bg-gray-50' : ''}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <Clock className="w-4 h-4 text-gray-400 mr-2" />
                        <span className="text-sm font-medium text-gray-900">
                          {formatTime(reservation.startAt)} - {formatTime(reservation.endAt)}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <p className="text-sm text-gray-900">{reservation.memberId}</p>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <p className="text-sm text-gray-900">{reservation.menuId}</p>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <p className="text-sm text-gray-500">
                        {reservation.staffId || '-'}
                      </p>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${BOOKING_STATUS_COLORS[reservation.status] || BOOKING_STATUS_COLORS[BOOKING_STATUS.CONFIRMED]}`}>
                        {BOOKING_STATUS_LABELS[reservation.status] || BOOKING_STATUS_LABELS[BOOKING_STATUS.CONFIRMED]}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        {reservation.status === BOOKING_STATUS.CONFIRMED && (
                          <>
                            <button
                              onClick={() => updateStatus(reservation.reservationId, 'arrived')}
                              className="p-1 text-green-600 hover:bg-green-50 rounded disabled:opacity-50"
                              title="来店済みにする"
                              aria-label="来店済みにする"
                              disabled={isUpdating}
                            >
                              <Check className="w-5 h-5" />
                            </button>
                            <button
                              onClick={() => updateStatus(reservation.reservationId, BOOKING_STATUS.CANCELLED)}
                              className="p-1 text-red-600 hover:bg-red-50 rounded disabled:opacity-50"
                              title="キャンセル"
                              aria-label="予約をキャンセル"
                              disabled={isUpdating}
                            >
                              <X className="w-5 h-5" />
                            </button>
                            {isPast && (
                              <button
                                onClick={() => updateStatus(reservation.reservationId, BOOKING_STATUS.NO_SHOW)}
                                className="p-1 text-orange-600 hover:bg-orange-50 rounded disabled:opacity-50"
                                title="ノーショー"
                                aria-label="ノーショーとして記録"
                                disabled={isUpdating}
                              >
                                <AlertCircle className="w-5 h-5" />
                              </button>
                            )}
                          </>
                        )}
                        {reservation.status === 'arrived' && (
                          <button
                            onClick={() => updateStatus(reservation.reservationId, BOOKING_STATUS.COMPLETED)}
                            className="px-3 py-1 text-sm bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50"
                            aria-label="予約を完了にする"
                            disabled={isUpdating}
                          >
                            完了
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}