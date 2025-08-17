import { useState, useCallback } from 'react';
import { Calendar, Clock, User, Phone, AlertCircle, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { apiClient } from '../lib/api/unifiedClient';
import { usePaginatedApi } from '../hooks/useApi';
import { formatDate } from '../lib/utils';

interface Booking {
  id: string;
  customerId: string;
  customerInfo?: {
    name: string;
    email: string;
    phone?: string;
  };
  serviceId: string;
  serviceInfo?: {
    name: {
      ja: string;
      en: string;
    };
  };
  resourceId: string;
  resourceInfo?: {
    name: {
      ja: string;
      en: string;
    };
  };
  startTime: string;
  endTime: string;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show';
  totalJpy: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export default function Reservations() {
  const [dateRange, setDateRange] = useState({
    from: new Date().toISOString().split('T')[0],
    to: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  });
  
  const [filters, setFilters] = useState({
    status: [] as string[],
    serviceId: '',
    resourceId: '',
  });

  const {
    items: bookings,
    pagination,
    isLoading,
    error,
    refresh,
    updateParams,
    nextPage,
    prevPage,
  } = usePaginatedApi<Booking>(
    (params) => apiClient.getBookings(params),
    {
      startDate: dateRange.from,
      endDate: dateRange.to,
      limit: 20,
      page: 1,
    }
  );

  const handleDateChange = useCallback((field: 'from' | 'to', value: string) => {
    const newDateRange = { ...dateRange, [field]: value };
    setDateRange(newDateRange);
    updateParams({
      startDate: newDateRange.from,
      endDate: newDateRange.to,
      page: 1,
    });
  }, [dateRange, updateParams]);

  const handleStatusFilter = useCallback((status: string) => {
    const newStatuses = filters.status.includes(status)
      ? filters.status.filter(s => s !== status)
      : [...filters.status, status];
    
    setFilters({ ...filters, status: newStatuses });
    updateParams({ status: newStatuses, page: 1 });
  }, [filters, updateParams]);

  const handleCancelBooking = async (bookingId: string) => {
    if (!confirm('この予約をキャンセルしますか？')) return;
    
    try {
      await apiClient.cancelBooking(bookingId, 'スタッフによるキャンセル');
      refresh();
    } catch (error) {
      console.error('Failed to cancel booking:', error);
      alert('予約のキャンセルに失敗しました');
    }
  };

  const statusColors = {
    'pending': 'bg-yellow-100 text-yellow-800',
    'confirmed': 'bg-blue-100 text-blue-800',
    'cancelled': 'bg-red-100 text-red-800',
    'completed': 'bg-gray-100 text-gray-800',
    'no_show': 'bg-orange-100 text-orange-800'
  };

  const statusLabels = {
    'pending': '確認待ち',
    'confirmed': '確定',
    'cancelled': 'キャンセル',
    'completed': '完了',
    'no_show': '無断キャンセル'
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-900">予約一覧</h2>
        <button
          onClick={refresh}
          disabled={isLoading}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          更新
        </button>
      </div>
      
      {/* Filters */}
      <div className="bg-white p-4 rounded-lg shadow-sm border mb-6">
        <div className="space-y-4">
          {/* Date Range Filter */}
          <div className="flex items-center gap-4">
            <div>
              <label htmlFor="from" className="block text-sm font-medium text-gray-700 mb-1">
                開始日
              </label>
              <input
                type="date"
                id="from"
                value={dateRange.from}
                onChange={e => handleDateChange('from', e.target.value)}
                className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
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
                onChange={e => handleDateChange('to', e.target.value)}
                className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              />
            </div>
          </div>
          
          {/* Status Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              ステータス
            </label>
            <div className="flex flex-wrap gap-2">
              {Object.entries(statusLabels).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => handleStatusFilter(value)}
                  className={`px-3 py-1 text-sm rounded-full border transition-colors ${
                    filters.status.includes(value)
                      ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-red-600" />
            <p className="text-red-800">エラーが発生しました: {error.message}</p>
          </div>
        </div>
      )}

      {/* Bookings Table */}
      <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  日時
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  サービス
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  リソース
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  顧客情報
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  金額
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  ステータス
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-gray-500">
                    読み込み中...
                  </td>
                </tr>
              ) : bookings.length > 0 ? (
                bookings.map((booking) => (
                  <tr key={booking.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-gray-400" />
                        <div>
                          <p className="text-sm font-medium text-gray-900">
                            {formatDate(booking.startTime)}
                          </p>
                          <p className="text-xs text-gray-500 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {Math.round((new Date(booking.endTime).getTime() - new Date(booking.startTime).getTime()) / 60000)}分
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <p className="text-sm text-gray-900">
                        {booking.serviceInfo?.name?.ja || 'サービス名未設定'}
                      </p>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <p className="text-sm text-gray-900">
                        {booking.resourceInfo?.name?.ja || 'リソース未定'}
                      </p>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm">
                        <div className="flex items-center gap-1 text-gray-900">
                          <User className="w-4 h-4" />
                          <span>{booking.customerInfo?.name || 'ゲスト'}</span>
                        </div>
                        {booking.customerInfo?.phone && (
                          <div className="flex items-center gap-1 text-gray-500 text-xs mt-1">
                            <Phone className="w-3 h-3" />
                            <span>{booking.customerInfo.phone}</span>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <p className="text-sm font-medium text-gray-900">
                        ¥{booking.totalJpy.toLocaleString()}
                      </p>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${statusColors[booking.status] || statusColors.pending}`}>
                        {statusLabels[booking.status] || booking.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <div className="flex items-center gap-2">
                        <button className="text-indigo-600 hover:text-indigo-900">
                          詳細
                        </button>
                        {booking.status === 'confirmed' && (
                          <button
                            onClick={() => handleCancelBooking(booking.id)}
                            className="text-red-600 hover:text-red-900"
                          >
                            キャンセル
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-gray-500">
                    予約がありません
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        
        {/* Pagination */}
        {pagination && (
          <div className="bg-gray-50 px-4 py-3 flex items-center justify-between border-t border-gray-200 sm:px-6">
            <div className="flex-1 flex justify-between sm:hidden">
              <button
                onClick={prevPage}
                disabled={!pagination.hasPrev}
                className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                前へ
              </button>
              <button
                onClick={nextPage}
                disabled={!pagination.hasNext}
                className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                次へ
              </button>
            </div>
            <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-gray-700">
                  全 <span className="font-medium">{pagination.total}</span> 件中{' '}
                  <span className="font-medium">
                    {(pagination.page - 1) * pagination.limit + 1}
                  </span>{' '}
                  から{' '}
                  <span className="font-medium">
                    {Math.min(pagination.page * pagination.limit, pagination.total)}
                  </span>{' '}
                  件を表示
                </p>
              </div>
              <div>
                <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
                  <button
                    onClick={prevPage}
                    disabled={!pagination.hasPrev}
                    className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <span className="relative inline-flex items-center px-4 py-2 border border-gray-300 bg-white text-sm font-medium text-gray-700">
                    {pagination.page} / {pagination.totalPages}
                  </span>
                  <button
                    onClick={nextPage}
                    disabled={!pagination.hasNext}
                    className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </nav>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}