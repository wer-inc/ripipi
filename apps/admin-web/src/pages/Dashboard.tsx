import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, Users, TrendingUp, Clock, ArrowRight, Activity, DollarSign } from 'lucide-react';
import { api } from '../lib/api';
import { formatDate } from '../lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatCardSkeleton, ListSkeleton } from '@/components/ui/skeleton';

export default function Dashboard() {
  const [stats, setStats] = useState({
    todayReservations: 0,
    weekReservations: 0,
    totalCustomers: 0,
    revenueThisMonth: 0
  });
  
  const [todayReservations, setTodayReservations] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  useEffect(() => {
    loadDashboardData();
  }, []);
  
  async function loadDashboardData() {
    try {
      setIsLoading(true);
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
    } finally {
      setIsLoading(false);
    }
  }

  const statsCards = [
    {
      title: "本日の予約",
      value: stats.todayReservations,
      description: "今日の予約件数",
      icon: Calendar,
      color: "text-blue-600",
      bgColor: "bg-blue-50"
    },
    {
      title: "今週の予約",
      value: stats.weekReservations,
      description: "今週の総予約数",
      icon: Activity,
      color: "text-green-600",
      bgColor: "bg-green-50"
    },
    {
      title: "顧客数",
      value: stats.totalCustomers,
      description: "登録顧客数",
      icon: Users,
      color: "text-purple-600",
      bgColor: "bg-purple-50"
    },
    {
      title: "今月の売上",
      value: `¥${stats.revenueThisMonth.toLocaleString()}`,
      description: "今月の総売上",
      icon: DollarSign,
      color: "text-orange-600",
      bgColor: "bg-orange-50"
    }
  ];

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">ダッシュボード</h2>
        <p className="text-muted-foreground">
          店舗の予約状況と統計情報
        </p>
      </div>
      
      {/* 統計カード */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {isLoading ? (
          // スケルトン表示
          Array.from({ length: 4 }).map((_, i) => (
            <StatCardSkeleton key={i} />
          ))
        ) : (
          statsCards.map((stat, index) => {
            const Icon = stat.icon;
            return (
              <Card key={index}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    {stat.title}
                  </CardTitle>
                  <div className={`${stat.bgColor} p-2 rounded-lg`}>
                    <Icon className={`h-4 w-4 ${stat.color}`} />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stat.value}</div>
                  <p className="text-xs text-muted-foreground">
                    {stat.description}
                  </p>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
      
      {/* 本日の予約一覧 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>本日の予約</CardTitle>
              <CardDescription>
                今日の予約スケジュール
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/today">
                すべて見る
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <ListSkeleton items={5} />
          ) : todayReservations.length > 0 ? (
            <div className="space-y-4">
              {todayReservations.map((reservation) => (
                <div
                  key={reservation.reservation_id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent transition-colors"
                >
                  <div className="space-y-1">
                    <p className="font-medium">
                      {formatDate(reservation.start_at)}
                    </p>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <span>メニュー: {reservation.menu_id}</span>
                      <Badge variant="outline">
                        {reservation.status || 'confirmed'}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    <span>
                      {Math.round((new Date(reservation.end_at).getTime() - new Date(reservation.start_at).getTime()) / 60000)}分
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <Calendar className="mx-auto h-12 w-12 text-muted-foreground" />
              <p className="mt-4 text-sm text-muted-foreground">
                本日の予約はありません
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* クイックアクション */}
      <Card>
        <CardHeader>
          <CardTitle>クイックアクション</CardTitle>
          <CardDescription>
            よく使う機能へのショートカット
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <Button variant="outline" className="justify-start" asChild>
            <Link to="/reservations">
              <Calendar className="mr-2 h-4 w-4" />
              予約管理
            </Link>
          </Button>
          <Button variant="outline" className="justify-start" asChild>
            <Link to="/customers">
              <Users className="mr-2 h-4 w-4" />
              顧客管理
            </Link>
          </Button>
          <Button variant="outline" className="justify-start" asChild>
            <Link to="/menus">
              <Activity className="mr-2 h-4 w-4" />
              メニュー設定
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}