import { useState, useEffect } from 'react';
import { Check, X, Clock, AlertCircle } from 'lucide-react';
import { api } from '../lib/api';
import { formatTime, formatStatus, getStatusColor } from '../lib/utils';

export default function TodayReservations() {
  const [reservations, setReservations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    loadTodayReservations();
    // 30秒ごとに自動更新
    const interval = setInterval(loadTodayReservations, 30000);
    return () => clearInterval(interval);
  }, []);
  
  async function loadTodayReservations() {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      const data = await api.get('reservations', {
        searchParams: {
          store_id: import.meta.env.VITE_STORE_ID,
          from: today.toISOString(),
          to: tomorrow.toISOString()
        }
      }).json<any[]>();
      
      // 時間順にソート
      data.sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
      setReservations(data);
    } catch (error) {
      console.error('Failed to load reservations:', error);
    } finally {
      setLoading(false);
    }
  }
  
  async function updateStatus(reservationId: string, status: string) {
    try {
      await api.patch(`reservations/${reservationId}`, {
        json: { status }
      });
      
      // 一覧を再読み込み
      loadTodayReservations();
    } catch (error) {
      console.error('Failed to update status:', error);
      alert('ステータスの更新に失敗しました');
    }
  }
  
  const currentTime = new Date();

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">本日の予約一覧</h2>
        <div className="text-sm text-gray-500">
          {new Date().toLocaleDateString('ja-JP', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric',
            weekday: 'long'
          })}
        </div>
      </div>
      
      {loading ? (
        <div className="bg-white rounded-lg shadow-sm border p-8 text-center">
          <p className="text-gray-500">読み込み中...</p>
        </div>
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
                const startTime = new Date(reservation.start_at);
                const isPast = startTime < currentTime;
                
                return (
                  <tr key={reservation.reservation_id} className={isPast ? 'bg-gray-50' : ''}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <Clock className="w-4 h-4 text-gray-400 mr-2" />
                        <span className="text-sm font-medium text-gray-900">
                          {formatTime(reservation.start_at)} - {formatTime(reservation.end_at)}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <p className="text-sm text-gray-900">{reservation.member_id}</p>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <p className="text-sm text-gray-900">{reservation.menu_id}</p>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <p className="text-sm text-gray-500">
                        {reservation.staff_id || '-'}
                      </p>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(reservation.status)}`}>
                        {formatStatus(reservation.status)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        {reservation.status === 'confirmed' && (
                          <>
                            <button
                              onClick={() => updateStatus(reservation.reservation_id, 'arrived')}
                              className="p-1 text-green-600 hover:bg-green-50 rounded"
                              title="来店済みにする"
                            >
                              <Check className="w-5 h-5" />
                            </button>
                            <button
                              onClick={() => updateStatus(reservation.reservation_id, 'cancelled')}
                              className="p-1 text-red-600 hover:bg-red-50 rounded"
                              title="キャンセル"
                            >
                              <X className="w-5 h-5" />
                            </button>
                            {isPast && (
                              <button
                                onClick={() => updateStatus(reservation.reservation_id, 'no_show')}
                                className="p-1 text-orange-600 hover:bg-orange-50 rounded"
                                title="ノーショー"
                              >
                                <AlertCircle className="w-5 h-5" />
                              </button>
                            )}
                          </>
                        )}
                        {reservation.status === 'arrived' && (
                          <button
                            onClick={() => updateStatus(reservation.reservation_id, 'done')}
                            className="px-3 py-1 text-sm bg-emerald-600 text-white rounded hover:bg-emerald-700"
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