import { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Save, X } from 'lucide-react';
import { api } from '../lib/api';

export default function MenuSettings() {
  const [menus, setMenus] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', durationMin: 0, price: 0 });
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', durationMin: 30, price: 0 });
  
  useEffect(() => {
    loadMenus();
  }, []);
  
  async function loadMenus() {
    try {
      const data = await api.get('menus', {
        searchParams: {
          store_id: import.meta.env.VITE_STORE_ID
        }
      }).json<any[]>();
      setMenus(data);
    } catch (error) {
      console.error('Failed to load menus:', error);
    } finally {
      setLoading(false);
    }
  }
  
  async function handleEdit(menu: any) {
    setEditingId(menu.menu_id);
    setEditForm({
      name: menu.name,
      durationMin: menu.duration_min,
      price: menu.price
    });
  }
  
  async function handleSave() {
    if (!editingId) return;
    
    try {
      await api.patch(`menus/${editingId}`, {
        json: editForm
      });
      setEditingId(null);
      loadMenus();
    } catch (error) {
      console.error('Failed to update menu:', error);
      alert('メニューの更新に失敗しました');
    }
  }
  
  async function handleAdd() {
    try {
      await api.post('menus', {
        json: {
          store_id: import.meta.env.VITE_STORE_ID,
          ...addForm
        }
      });
      setShowAddForm(false);
      setAddForm({ name: '', durationMin: 30, price: 0 });
      loadMenus();
    } catch (error) {
      console.error('Failed to add menu:', error);
      alert('メニューの追加に失敗しました');
    }
  }
  
  async function handleDelete(menuId: string) {
    if (!confirm('このメニューを削除しますか？')) return;
    
    try {
      await api.delete(`menus/${menuId}`);
      loadMenus();
    } catch (error) {
      console.error('Failed to delete menu:', error);
      alert('メニューの削除に失敗しました');
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">メニュー設定</h2>
        <button
          onClick={() => setShowAddForm(true)}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
        >
          <Plus className="w-5 h-5" />
          メニューを追加
        </button>
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
                  メニュー名
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  所要時間
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  料金
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  アクション
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {showAddForm && (
                <tr className="bg-emerald-50">
                  <td className="px-6 py-4">
                    <input
                      type="text"
                      value={addForm.name}
                      onChange={e => setAddForm({ ...addForm, name: e.target.value })}
                      className="w-full px-3 py-1 border rounded"
                      placeholder="メニュー名"
                    />
                  </td>
                  <td className="px-6 py-4">
                    <input
                      type="number"
                      value={addForm.durationMin}
                      onChange={e => setAddForm({ ...addForm, durationMin: parseInt(e.target.value) })}
                      className="w-24 px-3 py-1 border rounded"
                    />
                    <span className="ml-2 text-sm text-gray-500">分</span>
                  </td>
                  <td className="px-6 py-4">
                    <input
                      type="number"
                      value={addForm.price}
                      onChange={e => setAddForm({ ...addForm, price: parseInt(e.target.value) })}
                      className="w-32 px-3 py-1 border rounded"
                    />
                    <span className="ml-2 text-sm text-gray-500">円</span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleAdd}
                        className="p-1 text-green-600 hover:bg-green-50 rounded"
                      >
                        <Save className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() => setShowAddForm(false)}
                        className="p-1 text-gray-600 hover:bg-gray-50 rounded"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                  </td>
                </tr>
              )}
              
              {menus.map(menu => (
                <tr key={menu.menu_id}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {editingId === menu.menu_id ? (
                      <input
                        type="text"
                        value={editForm.name}
                        onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                        className="w-full px-3 py-1 border rounded"
                      />
                    ) : (
                      <p className="text-sm font-medium text-gray-900">{menu.name}</p>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {editingId === menu.menu_id ? (
                      <>
                        <input
                          type="number"
                          value={editForm.durationMin}
                          onChange={e => setEditForm({ ...editForm, durationMin: parseInt(e.target.value) })}
                          className="w-24 px-3 py-1 border rounded"
                        />
                        <span className="ml-2 text-sm text-gray-500">分</span>
                      </>
                    ) : (
                      <p className="text-sm text-gray-500">{menu.duration_min}分</p>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {editingId === menu.menu_id ? (
                      <>
                        <input
                          type="number"
                          value={editForm.price}
                          onChange={e => setEditForm({ ...editForm, price: parseInt(e.target.value) })}
                          className="w-32 px-3 py-1 border rounded"
                        />
                        <span className="ml-2 text-sm text-gray-500">円</span>
                      </>
                    ) : (
                      <p className="text-sm text-gray-900">¥{menu.price.toLocaleString()}</p>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      {editingId === menu.menu_id ? (
                        <>
                          <button
                            onClick={handleSave}
                            className="p-1 text-green-600 hover:bg-green-50 rounded"
                          >
                            <Save className="w-5 h-5" />
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="p-1 text-gray-600 hover:bg-gray-50 rounded"
                          >
                            <X className="w-5 h-5" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => handleEdit(menu)}
                            className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                          >
                            <Edit2 className="w-5 h-5" />
                          </button>
                          <button
                            onClick={() => handleDelete(menu.menu_id)}
                            className="p-1 text-red-600 hover:bg-red-50 rounded"
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}