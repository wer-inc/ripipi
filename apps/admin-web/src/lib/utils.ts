import { format } from 'date-fns';
import { ja } from 'date-fns/locale';

export function formatDate(date: Date | string) {
  return format(new Date(date), 'M月d日 HH:mm', { locale: ja });
}

export function formatTime(date: Date | string) {
  return format(new Date(date), 'HH:mm');
}

export function formatStatus(status: string) {
  const statusMap: Record<string, string> = {
    confirmed: '予約確定',
    arrived: '来店済み',
    done: '完了',
    cancelled: 'キャンセル',
    no_show: 'ノーショー'
  };
  return statusMap[status] || status;
}

export function getStatusColor(status: string) {
  const colorMap: Record<string, string> = {
    confirmed: 'text-blue-600 bg-blue-50',
    arrived: 'text-green-600 bg-green-50',
    done: 'text-gray-600 bg-gray-50',
    cancelled: 'text-red-600 bg-red-50',
    no_show: 'text-orange-600 bg-orange-50'
  };
  return colorMap[status] || 'text-gray-600 bg-gray-50';
}