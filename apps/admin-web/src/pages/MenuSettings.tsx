import React, { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, GripVertical, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { apiClient } from '@/lib/api/unifiedClient';

// メニューの型定義
interface Menu {
  id: string;
  name: string;
  nameEn?: string;
  category: string;
  price: number;
  duration: number; // 分単位
  description?: string;
  isActive: boolean;
  sortOrder?: number;
  createdAt: string;
  updatedAt: string;
}

// カテゴリーの定義
const MENU_CATEGORIES = [
  { value: 'cut', label: 'カット' },
  { value: 'color', label: 'カラー' },
  { value: 'perm', label: 'パーマ' },
  { value: 'treatment', label: 'トリートメント' },
  { value: 'styling', label: 'スタイリング' },
  { value: 'head_spa', label: 'ヘッドスパ' },
  { value: 'other', label: 'その他' },
];

// フォームデータの型
interface MenuFormData {
  name: string;
  nameEn: string;
  category: string;
  price: string;
  duration: string;
  description: string;
  isActive: boolean;
}

export default function MenuSettings() {
  const [menus, setMenus] = useState<Menu[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingMenu, setEditingMenu] = useState<Menu | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [formData, setFormData] = useState<MenuFormData>({
    name: '',
    nameEn: '',
    category: '',
    price: '',
    duration: '',
    description: '',
    isActive: true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  // メニューデータの取得
  const fetchMenus = async () => {
    try {
      setLoading(true);
      const response = await apiClient.getServices();
      setMenus(response.data || []);
    } catch (error) {
      console.error('メニューの取得に失敗しました:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMenus();
  }, []);

  // フォームのバリデーション
  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) {
      newErrors.name = 'メニュー名は必須です';
    }

    if (!formData.category) {
      newErrors.category = 'カテゴリーは必須です';
    }

    const price = parseFloat(formData.price);
    if (!formData.price || isNaN(price) || price < 0) {
      newErrors.price = '正しい価格を入力してください';
    }

    const duration = parseInt(formData.duration);
    if (!formData.duration || isNaN(duration) || duration < 1) {
      newErrors.duration = '正しい所要時間を入力してください（分単位）';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // メニューの保存
  const handleSave = async () => {
    if (!validateForm()) return;

    try {
      const menuData = {
        name: formData.name,
        nameEn: formData.nameEn || formData.name,
        category: formData.category,
        price: parseFloat(formData.price),
        duration: parseInt(formData.duration),
        description: formData.description,
        isActive: formData.isActive,
      };

      if (editingMenu) {
        await apiClient.updateService(editingMenu.id, menuData);
      } else {
        await apiClient.createService(menuData);
      }

      await fetchMenus();
      setIsDialogOpen(false);
      resetForm();
    } catch (error) {
      console.error('メニューの保存に失敗しました:', error);
      alert('メニューの保存に失敗しました');
    }
  };

  // フォームのリセット
  const resetForm = () => {
    setFormData({
      name: '',
      nameEn: '',
      category: '',
      price: '',
      duration: '',
      description: '',
      isActive: true,
    });
    setEditingMenu(null);
    setErrors({});
  };

  // 編集ダイアログを開く
  const openEditDialog = (menu: Menu) => {
    setEditingMenu(menu);
    setFormData({
      name: menu.name,
      nameEn: menu.nameEn || '',
      category: menu.category,
      price: menu.price.toString(),
      duration: menu.duration.toString(),
      description: menu.description || '',
      isActive: menu.isActive,
    });
    setIsDialogOpen(true);
  };

  // 新規追加ダイアログを開く
  const openAddDialog = () => {
    resetForm();
    setIsDialogOpen(true);
  };

  // メニューの削除
  const handleDelete = async (menu: Menu) => {
    if (!confirm(`「${menu.name}」を削除しますか？`)) return;

    try {
      await apiClient.deleteService(menu.id);
      await fetchMenus();
    } catch (error) {
      console.error('メニューの削除に失敗しました:', error);
      alert('メニューの削除に失敗しました');
    }
  };

  // フィルタリング済みメニュー
  const filteredMenus = menus.filter((menu) => {
    const matchesSearch = menu.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         (menu.nameEn && menu.nameEn.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesCategory = selectedCategory === 'all' || menu.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  // カテゴリー別にグループ化
  const groupedMenus = filteredMenus.reduce((groups, menu) => {
    const category = menu.category;
    if (!groups[category]) {
      groups[category] = [];
    }
    groups[category].push(menu);
    return groups;
  }, {} as Record<string, Menu[]>);

  // 時間のフォーマット
  const formatDuration = (minutes: number): string => {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    
    if (hours > 0 && remainingMinutes > 0) {
      return `${hours}時間${remainingMinutes}分`;
    } else if (hours > 0) {
      return `${hours}時間`;
    } else {
      return `${remainingMinutes}分`;
    }
  };

  // カテゴリー名の取得
  const getCategoryLabel = (categoryValue: string): string => {
    const category = MENU_CATEGORIES.find(cat => cat.value === categoryValue);
    return category ? category.label : categoryValue;
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">メニュー管理</h1>
          <p className="text-muted-foreground">
            美容室のサービスメニューを管理します
          </p>
        </div>
        <Button onClick={openAddDialog}>
          <Plus className="mr-2 h-4 w-4" />
          メニュー追加
        </Button>
      </div>

      {/* フィルター */}
      <Card>
        <CardHeader>
          <CardTitle>フィルター</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4">
            <div className="flex-1">
              <Label htmlFor="search">検索</Label>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="search"
                  placeholder="メニュー名で検索..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>
            <div className="w-48">
              <Label htmlFor="category">カテゴリー</Label>
              <select
                id="category"
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="all">すべて</option>
                {MENU_CATEGORIES.map((category) => (
                  <option key={category.value} value={category.value}>
                    {category.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* メニュー一覧 */}
      {loading ? (
        <Card>
          <CardContent className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
              <p>メニューを読み込み中...</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {Object.keys(groupedMenus).length === 0 ? (
            <Card>
              <CardContent className="flex items-center justify-center h-64">
                <div className="text-center">
                  <p className="text-muted-foreground">メニューが見つかりません</p>
                  <Button className="mt-4" onClick={openAddDialog}>
                    <Plus className="mr-2 h-4 w-4" />
                    最初のメニューを追加
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            Object.entries(groupedMenus).map(([category, categoryMenus]) => (
              <Card key={category}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    {getCategoryLabel(category)}
                    <Badge variant="secondary">{categoryMenus.length}</Badge>
                  </CardTitle>
                  <CardDescription>
                    {getCategoryLabel(category)}カテゴリーのメニュー一覧
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12"></TableHead>
                        <TableHead>メニュー名</TableHead>
                        <TableHead>価格</TableHead>
                        <TableHead>所要時間</TableHead>
                        <TableHead>ステータス</TableHead>
                        <TableHead className="text-right">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {categoryMenus.map((menu) => (
                        <TableRow key={menu.id}>
                          <TableCell>
                            <GripVertical className="h-4 w-4 text-muted-foreground cursor-move" />
                          </TableCell>
                          <TableCell>
                            <div>
                              <div className="font-medium">{menu.name}</div>
                              {menu.nameEn && (
                                <div className="text-sm text-muted-foreground">{menu.nameEn}</div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>¥{menu.price.toLocaleString()}</TableCell>
                          <TableCell>{formatDuration(menu.duration)}</TableCell>
                          <TableCell>
                            <Badge variant={menu.isActive ? 'default' : 'secondary'}>
                              {menu.isActive ? '有効' : '無効'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openEditDialog(menu)}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleDelete(menu)}
                                className="text-destructive hover:text-destructive"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      {/* メニュー追加/編集ダイアログ */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[625px]">
          <DialogHeader>
            <DialogTitle>
              {editingMenu ? 'メニュー編集' : 'メニュー追加'}
            </DialogTitle>
            <DialogDescription>
              {editingMenu 
                ? 'メニューの情報を編集してください。'
                : '新しいメニューの情報を入力してください。'
              }
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">メニュー名 *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="例: カット"
                  className={errors.name ? 'border-destructive' : ''}
                />
                {errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="nameEn">英語名</Label>
                <Input
                  id="nameEn"
                  value={formData.nameEn}
                  onChange={(e) => setFormData(prev => ({ ...prev, nameEn: e.target.value }))}
                  placeholder="例: Cut"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="category">カテゴリー *</Label>
              <select
                id="category"
                value={formData.category}
                onChange={(e) => setFormData(prev => ({ ...prev, category: e.target.value }))}
                className={`flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${errors.category ? 'border-destructive' : ''}`}
              >
                <option value="">カテゴリーを選択</option>
                {MENU_CATEGORIES.map((category) => (
                  <option key={category.value} value={category.value}>
                    {category.label}
                  </option>
                ))}
              </select>
              {errors.category && <p className="text-sm text-destructive">{errors.category}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="price">価格 (円) *</Label>
                <Input
                  id="price"
                  type="number"
                  value={formData.price}
                  onChange={(e) => setFormData(prev => ({ ...prev, price: e.target.value }))}
                  placeholder="例: 5000"
                  min="0"
                  className={errors.price ? 'border-destructive' : ''}
                />
                {errors.price && <p className="text-sm text-destructive">{errors.price}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="duration">所要時間 (分) *</Label>
                <Input
                  id="duration"
                  type="number"
                  value={formData.duration}
                  onChange={(e) => setFormData(prev => ({ ...prev, duration: e.target.value }))}
                  placeholder="例: 60"
                  min="1"
                  className={errors.duration ? 'border-destructive' : ''}
                />
                {errors.duration && <p className="text-sm text-destructive">{errors.duration}</p>}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">説明</Label>
              <textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                placeholder="メニューの詳細説明を入力してください"
                rows={3}
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>

            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="isActive"
                checked={formData.isActive}
                onChange={(e) => setFormData(prev => ({ ...prev, isActive: e.target.checked }))}
                className="h-4 w-4 rounded border border-input bg-background ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
              <Label htmlFor="isActive">有効にする</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              キャンセル
            </Button>
            <Button onClick={handleSave}>
              {editingMenu ? '更新' : '追加'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}