import { useState, useEffect } from 'react';
import { User, Plus, Search, Phone, Mail, Calendar, Edit, Eye, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { apiClient } from '@/lib/api/client';
import type { Customer, CustomerCreateInput, CustomerUpdateInput } from '@/types/customer';

export default function Customers() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCustomers, setTotalCustomers] = useState(0);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const itemsPerPage = 10;

  useEffect(() => {
    loadCustomers();
  }, [currentPage, searchTerm, statusFilter]);

  async function loadCustomers() {
    try {
      setLoading(true);
      setError(null);
      
      // モックデータを使用（実際のAPIが利用可能になったらapiClient.getCustomersを使用）
      const mockCustomers: Customer[] = [
        {
          id: '1',
          name: '田中 太郎',
          email: 'tanaka@example.com',
          phone: '090-1234-5678',
          lineUserId: 'U1234567890',
          registeredAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
          lastVisitAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
          totalVisits: 12,
          totalSpent: 36000,
          status: 'active',
          preferences: { notifications: true, newsletter: true },
          notes: '常連のお客様。特にアロマコースを好まれる。'
        },
        {
          id: '2',
          name: '佐藤 花子',
          email: 'sato@example.com',
          phone: '080-9876-5432',
          lineUserId: 'U0987654321',
          registeredAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
          lastVisitAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
          totalVisits: 8,
          totalSpent: 24000,
          status: 'active',
          preferences: { notifications: false, newsletter: true },
          notes: 'アレルギーあり。使用オイルに注意。'
        },
        {
          id: '3',
          name: '山田 次郎',
          email: 'yamada@example.com',
          phone: '070-1111-2222',
          registeredAt: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString(),
          lastVisitAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
          totalVisits: 5,
          totalSpent: 15000,
          status: 'inactive',
          preferences: { notifications: true, newsletter: false }
        }
      ];

      // フィルタリング
      let filteredCustomers = mockCustomers;
      
      if (searchTerm) {
        filteredCustomers = filteredCustomers.filter(customer =>
          customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          customer.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          customer.phone?.includes(searchTerm)
        );
      }
      
      if (statusFilter !== 'all') {
        filteredCustomers = filteredCustomers.filter(customer => customer.status === statusFilter);
      }

      // ページネーション
      const total = filteredCustomers.length;
      const startIndex = (currentPage - 1) * itemsPerPage;
      const endIndex = startIndex + itemsPerPage;
      const paginatedCustomers = filteredCustomers.slice(startIndex, endIndex);

      setCustomers(paginatedCustomers);
      setTotalCustomers(total);
      setTotalPages(Math.ceil(total / itemsPerPage));

    } catch (error) {
      console.error('Failed to load customers:', error);
      setError('顧客データの読み込みに失敗しました。');
    } finally {
      setLoading(false);
    }
  }

  function formatDate(dateString: string) {
    const date = new Date(dateString);
    return date.toLocaleDateString('ja-JP');
  }

  function handleViewCustomer(customer: Customer) {
    setSelectedCustomer(customer);
    setShowDetailModal(true);
  }

  function handleEditCustomer(customer: Customer) {
    setSelectedCustomer(customer);
    setShowEditModal(true);
  }

  function handleCreateCustomer() {
    setShowCreateModal(true);
  }

  async function submitCreateCustomer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    
    const customerData: CustomerCreateInput = {
      name: formData.get('name') as string,
      email: formData.get('email') as string || undefined,
      phone: formData.get('phone') as string || undefined,
      lineUserId: formData.get('lineUserId') as string || undefined,
      notes: formData.get('notes') as string || undefined,
    };

    try {
      // 実際のAPI呼び出し（モック環境では表示のみ）
      console.log('Creating customer:', customerData);
      alert('顧客の登録が完了しました。');
      setShowCreateModal(false);
      loadCustomers();
    } catch (error) {
      console.error('Failed to create customer:', error);
      alert('顧客の登録に失敗しました。');
    }
  }

  async function submitEditCustomer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCustomer) return;

    const formData = new FormData(event.currentTarget);
    
    const customerData: CustomerUpdateInput = {
      name: formData.get('name') as string,
      email: formData.get('email') as string || undefined,
      phone: formData.get('phone') as string || undefined,
      lineUserId: formData.get('lineUserId') as string || undefined,
      notes: formData.get('notes') as string || undefined,
      status: formData.get('status') as 'active' | 'inactive',
    };

    try {
      // 実際のAPI呼び出し（モック環境では表示のみ）
      console.log('Updating customer:', selectedCustomer.id, customerData);
      alert('顧客情報が更新されました。');
      setShowEditModal(false);
      loadCustomers();
    } catch (error) {
      console.error('Failed to update customer:', error);
      alert('顧客情報の更新に失敗しました。');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">顧客管理</h2>
        <Button onClick={handleCreateCustomer} className="flex items-center gap-2">
          <Plus className="w-4 h-4" />
          新規顧客登録
        </Button>
      </div>

      {/* 検索・フィルター */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  type="text"
                  placeholder="名前、メール、電話番号で検索..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant={statusFilter === 'all' ? 'default' : 'outline'}
                onClick={() => setStatusFilter('all')}
                size="sm"
              >
                全て
              </Button>
              <Button
                variant={statusFilter === 'active' ? 'default' : 'outline'}
                onClick={() => setStatusFilter('active')}
                size="sm"
              >
                アクティブ
              </Button>
              <Button
                variant={statusFilter === 'inactive' ? 'default' : 'outline'}
                onClick={() => setStatusFilter('inactive')}
                size="sm"
              >
                非アクティブ
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 顧客一覧テーブル */}
      <Card>
        <CardHeader>
          <CardTitle>顧客一覧 ({totalCustomers}件)</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8">
              <p className="text-gray-500">読み込み中...</p>
            </div>
          ) : error ? (
            <div className="text-center py-8">
              <p className="text-red-500">{error}</p>
            </div>
          ) : customers.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500">顧客が見つかりませんでした。</p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>名前</TableHead>
                    <TableHead>連絡先</TableHead>
                    <TableHead>ステータス</TableHead>
                    <TableHead>登録日</TableHead>
                    <TableHead>最終来店日</TableHead>
                    <TableHead>来店回数</TableHead>
                    <TableHead>総利用額</TableHead>
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customers.map((customer) => (
                    <TableRow key={customer.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-emerald-100 rounded-full flex items-center justify-center">
                            <User className="w-4 h-4 text-emerald-600" />
                          </div>
                          <span className="font-medium">{customer.name}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          {customer.email && (
                            <div className="flex items-center gap-1 text-sm text-gray-600">
                              <Mail className="w-3 h-3" />
                              {customer.email}
                            </div>
                          )}
                          {customer.phone && (
                            <div className="flex items-center gap-1 text-sm text-gray-600">
                              <Phone className="w-3 h-3" />
                              {customer.phone}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={customer.status === 'active' ? 'default' : 'secondary'}>
                          {customer.status === 'active' ? 'アクティブ' : '非アクティブ'}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatDate(customer.registeredAt)}</TableCell>
                      <TableCell>
                        {customer.lastVisitAt ? formatDate(customer.lastVisitAt) : '-'}
                      </TableCell>
                      <TableCell>{customer.totalVisits}回</TableCell>
                      <TableCell>¥{customer.totalSpent.toLocaleString()}</TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleViewCustomer(customer)}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleEditCustomer(customer)}
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* ページネーション */}
              <div className="flex items-center justify-between mt-4">
                <p className="text-sm text-gray-500">
                  {totalCustomers}件中 {(currentPage - 1) * itemsPerPage + 1}-{Math.min(currentPage * itemsPerPage, totalCustomers)}件を表示
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                    disabled={currentPage === 1}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <span className="text-sm">
                    {currentPage} / {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                    disabled={currentPage === totalPages}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* 顧客詳細モーダル */}
      <Dialog open={showDetailModal} onOpenChange={setShowDetailModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>顧客詳細</DialogTitle>
            <DialogClose onClose={() => setShowDetailModal(false)} />
          </DialogHeader>
          {selectedCustomer && (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center">
                  <User className="w-8 h-8 text-emerald-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold">{selectedCustomer.name}</h3>
                  <Badge variant={selectedCustomer.status === 'active' ? 'default' : 'secondary'}>
                    {selectedCustomer.status === 'active' ? 'アクティブ' : '非アクティブ'}
                  </Badge>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm font-medium text-gray-500">メールアドレス</Label>
                  <p className="mt-1">{selectedCustomer.email || '-'}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium text-gray-500">電話番号</Label>
                  <p className="mt-1">{selectedCustomer.phone || '-'}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium text-gray-500">LINE ID</Label>
                  <p className="mt-1">{selectedCustomer.lineUserId || '-'}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium text-gray-500">登録日</Label>
                  <p className="mt-1">{formatDate(selectedCustomer.registeredAt)}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium text-gray-500">最終来店日</Label>
                  <p className="mt-1">{selectedCustomer.lastVisitAt ? formatDate(selectedCustomer.lastVisitAt) : '-'}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium text-gray-500">来店回数</Label>
                  <p className="mt-1">{selectedCustomer.totalVisits}回</p>
                </div>
                <div>
                  <Label className="text-sm font-medium text-gray-500">総利用額</Label>
                  <p className="mt-1">¥{selectedCustomer.totalSpent.toLocaleString()}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium text-gray-500">通知設定</Label>
                  <p className="mt-1">
                    {selectedCustomer.preferences?.notifications ? '有効' : '無効'}
                  </p>
                </div>
              </div>
              
              {selectedCustomer.notes && (
                <div>
                  <Label className="text-sm font-medium text-gray-500">備考</Label>
                  <p className="mt-1 text-sm bg-gray-50 p-3 rounded">{selectedCustomer.notes}</p>
                </div>
              )}
              
              <div className="flex gap-2 pt-4">
                <Button onClick={() => handleEditCustomer(selectedCustomer)}>
                  編集
                </Button>
                <Button variant="outline" onClick={() => setShowDetailModal(false)}>
                  閉じる
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 新規顧客登録モーダル */}
      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新規顧客登録</DialogTitle>
            <DialogClose onClose={() => setShowCreateModal(false)} />
          </DialogHeader>
          <form onSubmit={submitCreateCustomer} className="space-y-4">
            <div>
              <Label htmlFor="name">名前 *</Label>
              <Input id="name" name="name" required />
            </div>
            <div>
              <Label htmlFor="email">メールアドレス</Label>
              <Input id="email" name="email" type="email" />
            </div>
            <div>
              <Label htmlFor="phone">電話番号</Label>
              <Input id="phone" name="phone" type="tel" />
            </div>
            <div>
              <Label htmlFor="lineUserId">LINE ID</Label>
              <Input id="lineUserId" name="lineUserId" />
            </div>
            <div>
              <Label htmlFor="notes">備考</Label>
              <textarea
                id="notes"
                name="notes"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={3}
              />
            </div>
            <div className="flex gap-2 pt-4">
              <Button type="submit">登録</Button>
              <Button type="button" variant="outline" onClick={() => setShowCreateModal(false)}>
                キャンセル
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* 顧客編集モーダル */}
      <Dialog open={showEditModal} onOpenChange={setShowEditModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>顧客情報編集</DialogTitle>
            <DialogClose onClose={() => setShowEditModal(false)} />
          </DialogHeader>
          {selectedCustomer && (
            <form onSubmit={submitEditCustomer} className="space-y-4">
              <div>
                <Label htmlFor="edit-name">名前 *</Label>
                <Input id="edit-name" name="name" defaultValue={selectedCustomer.name} required />
              </div>
              <div>
                <Label htmlFor="edit-email">メールアドレス</Label>
                <Input id="edit-email" name="email" type="email" defaultValue={selectedCustomer.email || ''} />
              </div>
              <div>
                <Label htmlFor="edit-phone">電話番号</Label>
                <Input id="edit-phone" name="phone" type="tel" defaultValue={selectedCustomer.phone || ''} />
              </div>
              <div>
                <Label htmlFor="edit-lineUserId">LINE ID</Label>
                <Input id="edit-lineUserId" name="lineUserId" defaultValue={selectedCustomer.lineUserId || ''} />
              </div>
              <div>
                <Label htmlFor="edit-status">ステータス</Label>
                <select
                  id="edit-status"
                  name="status"
                  defaultValue={selectedCustomer.status}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="active">アクティブ</option>
                  <option value="inactive">非アクティブ</option>
                </select>
              </div>
              <div>
                <Label htmlFor="edit-notes">備考</Label>
                <textarea
                  id="edit-notes"
                  name="notes"
                  defaultValue={selectedCustomer.notes || ''}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={3}
                />
              </div>
              <div className="flex gap-2 pt-4">
                <Button type="submit">更新</Button>
                <Button type="button" variant="outline" onClick={() => setShowEditModal(false)}>
                  キャンセル
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}