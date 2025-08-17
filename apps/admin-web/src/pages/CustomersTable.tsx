import { useState, useEffect } from 'react';
import { DataTable } from '@/components/ui/data-table';
import apiClient from '@/lib/api/unifiedClient';
import { ColumnDef } from '@tanstack/react-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MoreHorizontal, Phone, Mail, Calendar } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// 顧客データの型定義
interface Customer {
  id: string;
  name: string;
  nameKana?: string;
  email?: string;
  phone?: string;
  status: string;
  visitCount: number;
  totalSpending: number;
  lastVisitAt?: Date;
  createdAt: Date;
}

// カラム定義
const columns: ColumnDef<Customer>[] = [
  {
    accessorKey: "name",
    header: "顧客名",
    cell: ({ row }) => {
      const customer = row.original;
      return (
        <div>
          <div className="font-medium">{customer.name}</div>
          {customer.nameKana && (
            <div className="text-sm text-gray-500">{customer.nameKana}</div>
          )}
        </div>
      );
    },
  },
  {
    accessorKey: "contact",
    header: "連絡先",
    cell: ({ row }) => {
      const customer = row.original;
      return (
        <div className="space-y-1">
          {customer.email && (
            <div className="flex items-center gap-1 text-sm">
              <Mail className="h-3 w-3 text-gray-400" />
              <span>{customer.email}</span>
            </div>
          )}
          {customer.phone && (
            <div className="flex items-center gap-1 text-sm">
              <Phone className="h-3 w-3 text-gray-400" />
              <span>{customer.phone}</span>
            </div>
          )}
        </div>
      );
    },
    enableSorting: false,
  },
  {
    accessorKey: "status",
    header: "ステータス",
    cell: ({ row }) => {
      const status = row.getValue("status") as string;
      const variant = status === 'active' ? 'default' : 
                      status === 'inactive' ? 'secondary' : 
                      'outline';
      return (
        <Badge variant={variant}>
          {status === 'active' ? 'アクティブ' : 
           status === 'inactive' ? '非アクティブ' : 
           status}
        </Badge>
      );
    },
  },
  {
    accessorKey: "visitCount",
    header: "来店回数",
    cell: ({ row }) => {
      const count = row.getValue("visitCount") as number;
      return <span>{count}回</span>;
    },
  },
  {
    accessorKey: "totalSpending",
    header: "累計利用額",
    cell: ({ row }) => {
      const amount = row.getValue("totalSpending") as number;
      return <span>¥{amount.toLocaleString()}</span>;
    },
  },
  {
    accessorKey: "lastVisitAt",
    header: "最終来店日",
    cell: ({ row }) => {
      const date = row.getValue("lastVisitAt") as Date | undefined;
      if (!date) return <span className="text-gray-400">-</span>;
      
      return (
        <div className="flex items-center gap-1">
          <Calendar className="h-3 w-3 text-gray-400" />
          <span>{new Date(date).toLocaleDateString('ja-JP')}</span>
        </div>
      );
    },
  },
  {
    id: "actions",
    cell: ({ row }) => {
      const customer = row.original;

      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-8 w-8 p-0">
              <span className="sr-only">メニューを開く</span>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>アクション</DropdownMenuLabel>
            <DropdownMenuItem
              onClick={() => navigator.clipboard.writeText(customer.id)}
            >
              IDをコピー
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>詳細を表示</DropdownMenuItem>
            <DropdownMenuItem>編集</DropdownMenuItem>
            <DropdownMenuItem className="text-red-600">削除</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    },
  },
];

export default function CustomersTable() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const pageSize = 10;

  const fetchCustomers = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      const response = await apiClient.getCustomers({
        page: currentPage + 1,
        limit: pageSize,
        search: searchQuery,
      });
      
      setCustomers(response.data || []);
      setTotalPages(response.meta?.totalPages || 1);
      setTotalItems(response.meta?.total || 0);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch customers'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCustomers();
  }, [currentPage, searchQuery]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">顧客管理</h2>
        <Button onClick={() => console.log('新規顧客作成')}>
          新規顧客
        </Button>
      </div>
      
      <DataTable
        columns={columns}
        data={customers}
        isLoading={isLoading}
        error={error}
        pagination={{
          pageSize,
          pageIndex: currentPage,
          totalPages,
          totalItems,
          onPageChange: setCurrentPage,
        }}
        filtering={{
          searchPlaceholder: "顧客名、メール、電話番号で検索...",
          onSearchChange: setSearchQuery,
        }}
        actions={{
          onRefresh: fetchCustomers,
        }}
        emptyMessage="顧客データがありません"
      />
    </div>
  );
}