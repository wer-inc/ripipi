import { useState, useEffect } from 'react';
import { User, Calendar, Activity, TrendingUp } from 'lucide-react';
import { api } from '../lib/api';

export default function Customers() {
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    loadCustomers();
  }, []);

  async function loadCustomers() {
    try {
      // This endpoint would need to be implemented in the API
      // For now, we'll show a placeholder
      setCustomers([
        {
          member_id: '1',
          name: '田中 太郎',
          line_user_id: 'U1234567890',
          total_visits: 12,
          last_visit: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
          total_spent: 36000,
          member_since: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
        },
        {
          member_id: '2',
          name: '佐藤 花子',
          line_user_id: 'U0987654321',
          total_visits: 8,
          last_visit: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
          total_spent: 24000,
          member_since: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
        }
      ]);
    } catch (error) {
      console.error('Failed to load customers:', error);
    } finally {
      setLoading(false);
    }
  }

  const filteredCustomers = customers.filter(customer => 
    customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    customer.line_user_id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  function formatDate(dateString: string) {
    const date = new Date(dateString);
    return date.toLocaleDateString('ja-JP');
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">顧客管理</h2>
      
      {/* Search */}
      <div className="bg-white p-4 rounded-lg shadow-sm border mb-6">
        <input
          type="text"
          placeholder="名前またはLINE IDで検索..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="w-full px-4 py-2 border rounded-lg"
        />
      </div>

      {loading ? (
        <div className="bg-white rounded-lg shadow-sm border p-8 text-center">
          <p className="text-gray-500">読み込み中...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredCustomers.map(customer => (
            <div key={customer.member_id} className="bg-white p-6 rounded-lg shadow-sm border hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center">
                    <User className="w-6 h-6 text-emerald-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{customer.name}</h3>
                    <p className="text-sm text-gray-500">{customer.line_user_id}</p>
                  </div>
                </div>
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500 flex items-center gap-1">
                    <Activity className="w-4 h-4" />
                    来店回数
                  </span>
                  <span className="font-medium">{customer.total_visits}回</span>
                </div>
                
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500 flex items-center gap-1">
                    <Calendar className="w-4 h-4" />
                    最終来店
                  </span>
                  <span className="font-medium">{formatDate(customer.last_visit)}</span>
                </div>
                
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500 flex items-center gap-1">
                    <TrendingUp className="w-4 h-4" />
                    総利用額
                  </span>
                  <span className="font-medium">¥{customer.total_spent.toLocaleString()}</span>
                </div>
              </div>
              
              <div className="mt-4 pt-4 border-t">
                <p className="text-xs text-gray-500">
                  会員登録日: {formatDate(customer.member_since)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}