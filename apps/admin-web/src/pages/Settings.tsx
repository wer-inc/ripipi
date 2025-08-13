import { useState } from 'react';
import { Store, Bell, Shield, Database, Save } from 'lucide-react';

export default function Settings() {
  const [settings, setSettings] = useState({
    storeName: 'Ripipi Salon',
    notificationTime: 24,
    autoConfirm: true,
    maxAdvanceBooking: 30,
    cancelDeadline: 2
  });

  const [saved, setSaved] = useState(false);

  function handleSave() {
    // In a real app, this would save to the backend
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">設定</h2>

      <div className="space-y-6">
        {/* Store Settings */}
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <div className="flex items-center gap-2 mb-4">
            <Store className="w-5 h-5 text-gray-600" />
            <h3 className="text-lg font-semibold text-gray-900">店舗設定</h3>
          </div>
          
          <div className="space-y-4">
            <div>
              <label htmlFor="storeName" className="block text-sm font-medium text-gray-700 mb-1">
                店舗名
              </label>
              <input
                type="text"
                id="storeName"
                value={settings.storeName}
                onChange={e => setSettings({ ...settings, storeName: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
          </div>
        </div>

        {/* Notification Settings */}
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <div className="flex items-center gap-2 mb-4">
            <Bell className="w-5 h-5 text-gray-600" />
            <h3 className="text-lg font-semibold text-gray-900">通知設定</h3>
          </div>
          
          <div className="space-y-4">
            <div>
              <label htmlFor="notificationTime" className="block text-sm font-medium text-gray-700 mb-1">
                予約リマインダー通知（時間前）
              </label>
              <select
                id="notificationTime"
                value={settings.notificationTime}
                onChange={e => setSettings({ ...settings, notificationTime: parseInt(e.target.value) })}
                className="w-full px-3 py-2 border rounded-lg"
              >
                <option value={2}>2時間前</option>
                <option value={12}>12時間前</option>
                <option value={24}>24時間前</option>
                <option value={48}>48時間前</option>
              </select>
            </div>
          </div>
        </div>

        {/* Booking Rules */}
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <div className="flex items-center gap-2 mb-4">
            <Shield className="w-5 h-5 text-gray-600" />
            <h3 className="text-lg font-semibold text-gray-900">予約ルール</h3>
          </div>
          
          <div className="space-y-4">
            <div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.autoConfirm}
                  onChange={e => setSettings({ ...settings, autoConfirm: e.target.checked })}
                  className="rounded border-gray-300"
                />
                <span className="text-sm font-medium text-gray-700">
                  予約を自動的に確定する
                </span>
              </label>
            </div>
            
            <div>
              <label htmlFor="maxAdvanceBooking" className="block text-sm font-medium text-gray-700 mb-1">
                最大予約可能日数（日後まで）
              </label>
              <input
                type="number"
                id="maxAdvanceBooking"
                value={settings.maxAdvanceBooking}
                onChange={e => setSettings({ ...settings, maxAdvanceBooking: parseInt(e.target.value) })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            
            <div>
              <label htmlFor="cancelDeadline" className="block text-sm font-medium text-gray-700 mb-1">
                キャンセル締切（時間前）
              </label>
              <input
                type="number"
                id="cancelDeadline"
                value={settings.cancelDeadline}
                onChange={e => setSettings({ ...settings, cancelDeadline: parseInt(e.target.value) })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
          </div>
        </div>

        {/* System Info */}
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <div className="flex items-center gap-2 mb-4">
            <Database className="w-5 h-5 text-gray-600" />
            <h3 className="text-lg font-semibold text-gray-900">システム情報</h3>
          </div>
          
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">LIFF ID</span>
              <span className="font-mono text-gray-900">{import.meta.env.VITE_LIFF_ID || '未設定'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Store ID</span>
              <span className="font-mono text-gray-900">{import.meta.env.VITE_STORE_ID || '未設定'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">API URL</span>
              <span className="font-mono text-gray-900">{import.meta.env.VITE_API_URL || 'http://localhost:8787'}</span>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
          >
            <Save className="w-5 h-5" />
            設定を保存
          </button>
        </div>

        {saved && (
          <div className="fixed bottom-4 right-4 bg-green-500 text-white px-4 py-2 rounded-lg shadow-lg">
            設定を保存しました
          </div>
        )}
      </div>
    </div>
  );
}