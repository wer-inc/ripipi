import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, Users, TrendingUp, Clock } from 'lucide-react';
import { api } from '../lib/api';
import { formatDate } from '../lib/utils';

export default function Dashboard() {
  const [stats, setStats] = useState({
    todayReservations: 0,
    weekReservations: 0,
    totalCustomers: 0,
    revenueThisMonth: 0
  });
  
  const [todayReservations, setTodayReservations] = useState<any[]>([]);
  
  useEffect(() => {
    loadDashboardData();
  }, []);
  
  async function loadDashboardData() {
    try {
      // 今日の予約を取得
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      const reservations = await api.get('reservations', {
        searchParams: {
          store_id: import.meta.env.VITE_STORE_ID,
          from: today.toISOString(),
          to: tomorrow.toISOString()
        }
      }).json<any[]>();
      
      setTodayReservations(reservations.slice(0, 5)); // 最新5件
      setStats(prev => ({ ...prev, todayReservations: reservations.length }));
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    }
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">ダッシュボード</h2>
      
      {/* 統計カード */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-white p-6 rounded-lg shadow-sm border">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">本日の予約</p>
              <p className="text-2xl font-bold text-gray-900">{stats.todayReservations}</p>
            </div>
            <Calendar className="w-8 h-8 text-emerald-500" />
          </div>
        </div>
        
        <div className="bg-white p-6 rounded-lg shadow-sm border">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">今週の予約</p>
              <p className="text-2xl font-bold text-gray-900">{stats.weekReservations}</p>
            </div>
            <TrendingUp className="w-8 h-8 text-blue-500" />
          </div>
        </div>
        
        <div className="bg-white p-6 rounded-lg shadow-sm border">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">顧客数</p>
              <p className="text-2xl font-bold text-gray-900">{stats.totalCustomers}</p>
            </div>
            <Users className="w-8 h-8 text-purple-500" />
          </div>
        </div>
        
        <div className="bg-white p-6 rounded-lg shadow-sm border">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">今月の売上</p>
              <p className="text-2xl font-bold text-gray-900">
                ¥{stats.revenueThisMonth.toLocaleString()}
              </p>
            </div>
            <TrendingUp className="w-8 h-8 text-green-500" />
          </div>
        </div>
      </div>
      
      {/* 本日の予約一覧 */}
      <div className="bg-white rounded-lg shadow-sm border">
        <div className="p-6 border-b">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">本日の予約</h3>
            <Link
              to="/today"
              className="text-sm text-emerald-600 hover:text-emerald-700"
            >
              すべて見る →
            </Link>
          </div>
        </div>
        
        <div className="divide-y">
          {todayReservations.length > 0 ? (
            todayReservations.map((reservation) => (
              <div key={reservation.reservation_id} className="p-4 hover:bg-gray-50">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">
                      {formatDate(reservation.start_at)}
                    </p>
                    <p className="text-sm text-gray-500">
                      メニュー: {reservation.menu_id}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-gray-400" />
                    <span className="text-sm text-gray-500">
                      {Math.round((new Date(reservation.end_at).getTime() - new Date(reservation.start_at).getTime()) / 60000)}分
                    </span>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="p-8 text-center text-gray-500">
              本日の予約はありません
            </div>
          )}
        </div>
      </div>
    </div>
  );
}