import { useState, useEffect } from 'react';
import { Calendar, Clock, User, Phone, AlertCircle } from 'lucide-react';
import { api } from '../lib/api';
import { formatDate } from '../lib/utils';

export default function Reservations() {
  const [reservations, setReservations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState({
    from: new Date().toISOString().split('T')[0],
    to: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  });

  useEffect(() => {
    loadReservations();
  }, [dateRange]);

  async function loadReservations() {
    try {
      const fromDate = new Date(dateRange.from);
      fromDate.setHours(0, 0, 0, 0);
      const toDate = new Date(dateRange.to);
      toDate.setDate(toDate.getDate() + 1);
      toDate.setHours(0, 0, 0, 0);
      
      const data = await api.get('reservations', {
        searchParams: {
          store_id: import.meta.env.VITE_STORE_ID,
          from: fromDate.toISOString(),
          to: toDate.toISOString()
        }
      }).json<any[]>();
      
      setReservations(data);
    } catch (error) {
      console.error('Failed to load reservations:', error);
    } finally {
      setLoading(false);
    }
  }

  const statusColors = {
    'pending': 'bg-yellow-100 text-yellow-800',
    'confirmed': 'bg-blue-100 text-blue-800',
    'in_progress': 'bg-green-100 text-green-800',
    'completed': 'bg-gray-100 text-gray-800',
    'cancelled': 'bg-red-100 text-red-800'
  };

  const statusLabels = {
    'pending': '確認待ち',
    'confirmed': '確定',
    'in_progress': '来店中',
    'completed': '完了',
    'cancelled': 'キャンセル'
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">予約一覧</h2>
      
      {/* Date Range Filter */}
      <div className="bg-white p-4 rounded-lg shadow-sm border mb-6">
        <div className="flex items-center gap-4">
          <div>
            <label htmlFor="from" className="block text-sm font-medium text-gray-700 mb-1">
              開始日
            </label>
            <input
              type="date"
              id="from"
              value={dateRange.from}
              onChange={e => setDateRange({ ...dateRange, from: e.target.value })}
              className="px-3 py-2 border rounded-lg"
            />
          </div>
          <div>
            <label htmlFor="to" className="block text-sm font-medium text-gray-700 mb-1">
              終了日
            </label>
            <input
              type="date"
              id="to"
              value={dateRange.to}
              onChange={e => setDateRange({ ...dateRange, to: e.target.value })}
              className="px-3 py-2 border rounded-lg"
            />
          </div>
          <button
            onClick={loadReservations}
            className="mt-6 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
          >
            検索
          </button>
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-lg shadow-sm border p-8 text-center">
          <p className="text-gray-500">読み込み中...</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  日時
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  メニュー
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  スタッフ
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  顧客情報
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  ステータス
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {reservations.length > 0 ? (
                reservations.map((reservation) => (
                  <tr key={reservation.reservation_id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-gray-400" />
                        <div>
                          <p className="text-sm font-medium text-gray-900">
                            {formatDate(reservation.start_at)}
                          </p>
                          <p className="text-xs text-gray-500">
                            {Math.round((new Date(reservation.end_at).getTime() - new Date(reservation.start_at).getTime()) / 60000)}分
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <p className="text-sm text-gray-900">{reservation.menu_id}</p>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <p className="text-sm text-gray-900">
                        {reservation.staff_id || 'スタッフ未定'}
                      </p>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-1 text-sm text-gray-500">
                        <User className="w-4 h-4" />
                        <span>{reservation.member_id || 'ゲスト'}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${statusColors[reservation.status] || statusColors.pending}`}>
                        {statusLabels[reservation.status] || reservation.status}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                    予約がありません
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}