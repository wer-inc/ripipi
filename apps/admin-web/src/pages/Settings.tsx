import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle 
} from '@/components/ui/dialog';
import { apiClient } from '@/lib/api/unifiedClient';
import { cn } from '@/lib/utils';
import { Plus, Trash2, Edit3, Save, AlertCircle } from 'lucide-react';

interface StoreInfo {
  name: string;
  address: string;
  phone: string;
  businessHours: {
    [key: string]: {
      isOpen: boolean;
      openTime: string;
      closeTime: string;
    };
  };
  closedDays: string[];
}

interface BookingSettings {
  acceptancePeriod: number; // 何日先まで予約を受け付けるか
  cancellationDeadline: number; // 何時間前までキャンセル可能か
  slotDuration: 5 | 15; // スロット粒度（分）
  bufferTime: number; // 予約間の余裕時間（分）
}

interface NotificationSettings {
  lineNotification: boolean;
  emailNotification: boolean;
  reminderEnabled: boolean;
  reminderHours: number;
}

interface StaffMember {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: string;
}

const DAYS_OF_WEEK = [
  { key: 'monday', label: '月曜日' },
  { key: 'tuesday', label: '火曜日' },
  { key: 'wednesday', label: '水曜日' },
  { key: 'thursday', label: '木曜日' },
  { key: 'friday', label: '金曜日' },
  { key: 'saturday', label: '土曜日' },
  { key: 'sunday', label: '日曜日' },
];

export default function Settings() {
  const [activeTab, setActiveTab] = useState('store');
  const [loading, setLoading] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    description: string;
    onConfirm: () => void;
  }>({ open: false, title: '', description: '', onConfirm: () => {} });

  // Store Info State
  const [storeInfo, setStoreInfo] = useState<StoreInfo>({
    name: '',
    address: '',
    phone: '',
    businessHours: DAYS_OF_WEEK.reduce((acc, day) => ({
      ...acc,
      [day.key]: { isOpen: true, openTime: '09:00', closeTime: '18:00' }
    }), {}),
    closedDays: []
  });

  // Booking Settings State
  const [bookingSettings, setBookingSettings] = useState<BookingSettings>({
    acceptancePeriod: 30,
    cancellationDeadline: 24,
    slotDuration: 15,
    bufferTime: 10
  });

  // Notification Settings State
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>({
    lineNotification: false,
    emailNotification: true,
    reminderEnabled: true,
    reminderHours: 24
  });

  // Staff State
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [staffDialog, setStaffDialog] = useState<{
    open: boolean;
    mode: 'add' | 'edit';
    member: Partial<StaffMember>;
  }>({ open: false, mode: 'add', member: {} });

  // Load initial data
  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const [storeResponse, bookingResponse, notificationResponse, staffResponse] = await Promise.all([
        apiClient.getStoreInfo(),
        apiClient.getBookingSettings(),
        apiClient.getNotificationSettings(),
        apiClient.getStaff({ limit: 100 })
      ]);

      if (storeResponse.success) {
        setStoreInfo(storeResponse.data);
      }
      if (bookingResponse.success) {
        setBookingSettings(bookingResponse.data);
      }
      if (notificationResponse.success) {
        setNotificationSettings(notificationResponse.data);
      }
      setStaff(staffResponse.data || []);
    } catch (error) {
      console.error('設定の読み込みに失敗しました:', error);
    } finally {
      setLoading(false);
    }
  };

  const saveStoreInfo = async () => {
    const handleSave = async () => {
      setLoading(true);
      try {
        await apiClient.updateStoreInfo(storeInfo);
        alert('店舗情報を保存しました');
      } catch (error) {
        console.error('店舗情報の保存に失敗しました:', error);
        alert('保存に失敗しました');
      } finally {
        setLoading(false);
      }
    };

    setConfirmDialog({
      open: true,
      title: '店舗情報の保存',
      description: '店舗情報を保存しますか？',
      onConfirm: handleSave
    });
  };

  const saveBookingSettings = async () => {
    const handleSave = async () => {
      setLoading(true);
      try {
        await apiClient.updateBookingSettings(bookingSettings);
        alert('予約設定を保存しました');
      } catch (error) {
        console.error('予約設定の保存に失敗しました:', error);
        alert('保存に失敗しました');
      } finally {
        setLoading(false);
      }
    };

    setConfirmDialog({
      open: true,
      title: '予約設定の保存',
      description: '予約設定を保存しますか？',
      onConfirm: handleSave
    });
  };

  const saveNotificationSettings = async () => {
    const handleSave = async () => {
      setLoading(true);
      try {
        await apiClient.updateNotificationSettings(notificationSettings);
        alert('通知設定を保存しました');
      } catch (error) {
        console.error('通知設定の保存に失敗しました:', error);
        alert('保存に失敗しました');
      } finally {
        setLoading(false);
      }
    };

    setConfirmDialog({
      open: true,
      title: '通知設定の保存',
      description: '通知設定を保存しますか？',
      onConfirm: handleSave
    });
  };

  const handleStaffSave = async () => {
    setLoading(true);
    try {
      if (staffDialog.mode === 'add') {
        const response = await apiClient.createStaffMember(staffDialog.member);
        if (response.success) {
          setStaff([...staff, response.data]);
        }
      } else {
        const response = await apiClient.updateStaffMember(staffDialog.member.id!, staffDialog.member);
        if (response.success) {
          setStaff(staff.map(s => s.id === staffDialog.member.id ? response.data : s));
        }
      }
      setStaffDialog({ open: false, mode: 'add', member: {} });
      alert('スタッフ情報を保存しました');
    } catch (error) {
      console.error('スタッフ情報の保存に失敗しました:', error);
      alert('保存に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const handleStaffDelete = async (id: string) => {
    const handleDelete = async () => {
      setLoading(true);
      try {
        await apiClient.deleteStaffMember(id);
        setStaff(staff.filter(s => s.id !== id));
        alert('スタッフを削除しました');
      } catch (error) {
        console.error('スタッフの削除に失敗しました:', error);
        alert('削除に失敗しました');
      } finally {
        setLoading(false);
      }
    };

    setConfirmDialog({
      open: true,
      title: 'スタッフの削除',
      description: 'このスタッフを削除しますか？この操作は取り消せません。',
      onConfirm: handleDelete
    });
  };

  return (
    <div className="container mx-auto py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">設定</h1>
        <p className="text-gray-600 mt-2">店舗の基本設定を管理します</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="store">店舗情報</TabsTrigger>
          <TabsTrigger value="booking">予約設定</TabsTrigger>
          <TabsTrigger value="notifications">通知設定</TabsTrigger>
          <TabsTrigger value="staff">スタッフ管理</TabsTrigger>
        </TabsList>

        {/* 店舗情報タブ */}
        <TabsContent value="store">
          <Card>
            <CardHeader>
              <CardTitle>店舗基本情報</CardTitle>
              <CardDescription>
                店舗の基本情報と営業時間を設定します
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="storeName">店舗名</Label>
                  <Input
                    id="storeName"
                    value={storeInfo.name}
                    onChange={(e) => setStoreInfo(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="店舗名を入力"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="storePhone">電話番号</Label>
                  <Input
                    id="storePhone"
                    value={storeInfo.phone}
                    onChange={(e) => setStoreInfo(prev => ({ ...prev, phone: e.target.value }))}
                    placeholder="03-1234-5678"
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="storeAddress">住所</Label>
                <Input
                  id="storeAddress"
                  value={storeInfo.address}
                  onChange={(e) => setStoreInfo(prev => ({ ...prev, address: e.target.value }))}
                  placeholder="店舗住所を入力"
                />
              </div>

              <div className="space-y-4">
                <Label>営業時間</Label>
                <div className="space-y-3">
                  {DAYS_OF_WEEK.map((day) => (
                    <div key={day.key} className="flex items-center space-x-4">
                      <div className="w-16 text-sm font-medium">{day.label}</div>
                      <Switch
                        checked={storeInfo.businessHours[day.key]?.isOpen || false}
                        onCheckedChange={(checked) => 
                          setStoreInfo(prev => ({
                            ...prev,
                            businessHours: {
                              ...prev.businessHours,
                              [day.key]: {
                                ...prev.businessHours[day.key],
                                isOpen: checked
                              }
                            }
                          }))
                        }
                      />
                      {storeInfo.businessHours[day.key]?.isOpen && (
                        <>
                          <Input
                            type="time"
                            value={storeInfo.businessHours[day.key]?.openTime || '09:00'}
                            onChange={(e) => 
                              setStoreInfo(prev => ({
                                ...prev,
                                businessHours: {
                                  ...prev.businessHours,
                                  [day.key]: {
                                    ...prev.businessHours[day.key],
                                    openTime: e.target.value
                                  }
                                }
                              }))
                            }
                            className="w-24"
                          />
                          <span className="text-sm">〜</span>
                          <Input
                            type="time"
                            value={storeInfo.businessHours[day.key]?.closeTime || '18:00'}
                            onChange={(e) => 
                              setStoreInfo(prev => ({
                                ...prev,
                                businessHours: {
                                  ...prev.businessHours,
                                  [day.key]: {
                                    ...prev.businessHours[day.key],
                                    closeTime: e.target.value
                                  }
                                }
                              }))
                            }
                            className="w-24"
                          />
                        </>
                      )}
                      {!storeInfo.businessHours[day.key]?.isOpen && (
                        <span className="text-sm text-gray-500">定休日</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end">
                <Button onClick={saveStoreInfo} disabled={loading}>
                  <Save className="h-4 w-4 mr-2" />
                  保存
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 予約設定タブ */}
        <TabsContent value="booking">
          <Card>
            <CardHeader>
              <CardTitle>予約設定</CardTitle>
              <CardDescription>
                予約受付の設定を管理します
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="acceptancePeriod">予約受付期間</Label>
                  <div className="flex items-center space-x-2">
                    <Input
                      id="acceptancePeriod"
                      type="number"
                      value={bookingSettings.acceptancePeriod}
                      onChange={(e) => setBookingSettings(prev => ({ 
                        ...prev, 
                        acceptancePeriod: parseInt(e.target.value) || 0 
                      }))}
                      className="w-24"
                    />
                    <span className="text-sm">日先まで</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="cancellationDeadline">キャンセル期限</Label>
                  <div className="flex items-center space-x-2">
                    <Input
                      id="cancellationDeadline"
                      type="number"
                      value={bookingSettings.cancellationDeadline}
                      onChange={(e) => setBookingSettings(prev => ({ 
                        ...prev, 
                        cancellationDeadline: parseInt(e.target.value) || 0 
                      }))}
                      className="w-24"
                    />
                    <span className="text-sm">時間前まで</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="slotDuration">予約時間の粒度</Label>
                  <Select
                    value={bookingSettings.slotDuration.toString()}
                    onValueChange={(value) => setBookingSettings(prev => ({ 
                      ...prev, 
                      slotDuration: parseInt(value) as 5 | 15
                    }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="5">5分単位</SelectItem>
                      <SelectItem value="15">15分単位</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="bufferTime">予約間の余裕時間</Label>
                  <div className="flex items-center space-x-2">
                    <Input
                      id="bufferTime"
                      type="number"
                      value={bookingSettings.bufferTime}
                      onChange={(e) => setBookingSettings(prev => ({ 
                        ...prev, 
                        bufferTime: parseInt(e.target.value) || 0 
                      }))}
                      className="w-24"
                    />
                    <span className="text-sm">分</span>
                  </div>
                </div>
              </div>

              <div className="flex justify-end">
                <Button onClick={saveBookingSettings} disabled={loading}>
                  <Save className="h-4 w-4 mr-2" />
                  保存
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 通知設定タブ */}
        <TabsContent value="notifications">
          <Card>
            <CardHeader>
              <CardTitle>通知設定</CardTitle>
              <CardDescription>
                予約関連の通知設定を管理します
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>LINE通知</Label>
                    <p className="text-sm text-gray-600">予約時にLINEで通知を送信</p>
                  </div>
                  <Switch
                    checked={notificationSettings.lineNotification}
                    onCheckedChange={(checked) => 
                      setNotificationSettings(prev => ({ ...prev, lineNotification: checked }))
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>メール通知</Label>
                    <p className="text-sm text-gray-600">予約時にメールで通知を送信</p>
                  </div>
                  <Switch
                    checked={notificationSettings.emailNotification}
                    onCheckedChange={(checked) => 
                      setNotificationSettings(prev => ({ ...prev, emailNotification: checked }))
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>リマインダー</Label>
                    <p className="text-sm text-gray-600">予約前にリマインダーを送信</p>
                  </div>
                  <Switch
                    checked={notificationSettings.reminderEnabled}
                    onCheckedChange={(checked) => 
                      setNotificationSettings(prev => ({ ...prev, reminderEnabled: checked }))
                    }
                  />
                </div>

                {notificationSettings.reminderEnabled && (
                  <div className="ml-4 space-y-2">
                    <Label htmlFor="reminderHours">リマインダー送信タイミング</Label>
                    <div className="flex items-center space-x-2">
                      <Input
                        id="reminderHours"
                        type="number"
                        value={notificationSettings.reminderHours}
                        onChange={(e) => setNotificationSettings(prev => ({ 
                          ...prev, 
                          reminderHours: parseInt(e.target.value) || 0 
                        }))}
                        className="w-24"
                      />
                      <span className="text-sm">時間前</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end">
                <Button onClick={saveNotificationSettings} disabled={loading}>
                  <Save className="h-4 w-4 mr-2" />
                  保存
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* スタッフ管理タブ */}
        <TabsContent value="staff">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>スタッフ管理</CardTitle>
                  <CardDescription>
                    スタッフの追加・編集・削除を行います
                  </CardDescription>
                </div>
                <Button
                  onClick={() => setStaffDialog({ open: true, mode: 'add', member: {} })}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  スタッフ追加
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {staff.map((member) => (
                  <div key={member.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center space-x-4">
                      <div>
                        <p className="font-medium">{member.name}</p>
                        <p className="text-sm text-gray-600">{member.email}</p>
                      </div>
                      <Badge variant={member.isActive ? "default" : "secondary"}>
                        {member.isActive ? "有効" : "無効"}
                      </Badge>
                      <Badge variant="outline">{member.role}</Badge>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setStaffDialog({ 
                          open: true, 
                          mode: 'edit', 
                          member: { ...member } 
                        })}
                      >
                        <Edit3 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleStaffDelete(member.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
                {staff.length === 0 && (
                  <div className="text-center py-8 text-gray-500">
                    スタッフが登録されていません
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* 確認ダイアログ */}
      <Dialog open={confirmDialog.open} onOpenChange={(open) => setConfirmDialog(prev => ({ ...prev, open }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-500" />
              {confirmDialog.title}
            </DialogTitle>
            <DialogDescription>
              {confirmDialog.description}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDialog(prev => ({ ...prev, open: false }))}>
              キャンセル
            </Button>
            <Button onClick={() => {
              confirmDialog.onConfirm();
              setConfirmDialog(prev => ({ ...prev, open: false }));
            }}>
              確認
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* スタッフ編集ダイアログ */}
      <Dialog open={staffDialog.open} onOpenChange={(open) => setStaffDialog(prev => ({ ...prev, open }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {staffDialog.mode === 'add' ? 'スタッフ追加' : 'スタッフ編集'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="staffName">名前</Label>
              <Input
                id="staffName"
                value={staffDialog.member.name || ''}
                onChange={(e) => setStaffDialog(prev => ({ 
                  ...prev, 
                  member: { ...prev.member, name: e.target.value } 
                }))}
                placeholder="スタッフ名を入力"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="staffEmail">メールアドレス</Label>
              <Input
                id="staffEmail"
                type="email"
                value={staffDialog.member.email || ''}
                onChange={(e) => setStaffDialog(prev => ({ 
                  ...prev, 
                  member: { ...prev.member, email: e.target.value } 
                }))}
                placeholder="メールアドレスを入力"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="staffRole">役職</Label>
              <Select
                value={staffDialog.member.role || ''}
                onValueChange={(value) => setStaffDialog(prev => ({ 
                  ...prev, 
                  member: { ...prev.member, role: value } 
                }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="役職を選択" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">管理者</SelectItem>
                  <SelectItem value="staff">スタッフ</SelectItem>
                  <SelectItem value="manager">マネージャー</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="staffActive">有効状態</Label>
              <Switch
                id="staffActive"
                checked={staffDialog.member.isActive || false}
                onCheckedChange={(checked) => setStaffDialog(prev => ({ 
                  ...prev, 
                  member: { ...prev.member, isActive: checked } 
                }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStaffDialog(prev => ({ ...prev, open: false }))}>
              キャンセル
            </Button>
            <Button onClick={handleStaffSave} disabled={loading}>
              <Save className="h-4 w-4 mr-2" />
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}