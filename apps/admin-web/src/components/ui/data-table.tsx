import * as React from "react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
  getSortedRowModel,
  SortingState,
  getFilteredRowModel,
  ColumnFiltersState,
  getPaginationRowModel,
  PaginationState,
} from "@tanstack/react-table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from "lucide-react"
import { TableSkeleton } from "./skeleton"

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  isLoading?: boolean
  error?: Error | null
  pagination?: {
    pageSize?: number
    pageIndex?: number
    totalPages?: number
    totalItems?: number
    onPageChange?: (page: number) => void
    onPageSizeChange?: (size: number) => void
  }
  sorting?: {
    onSortChange?: (sortBy: string, sortOrder: 'asc' | 'desc') => void
  }
  filtering?: {
    searchPlaceholder?: string
    onSearchChange?: (value: string) => void
  }
  actions?: {
    onRefresh?: () => void
    customActions?: React.ReactNode
  }
  emptyMessage?: string
  className?: string
}

export function DataTable<TData, TValue>({
  columns,
  data,
  isLoading = false,
  error = null,
  pagination,
  sorting,
  filtering,
  actions,
  emptyMessage = "データがありません",
  className,
}: DataTableProps<TData, TValue>) {
  const [sortingState, setSorting] = React.useState<SortingState>([])
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
  const [globalFilter, setGlobalFilter] = React.useState("")
  
  const paginationState: PaginationState = {
    pageIndex: pagination?.pageIndex ?? 0,
    pageSize: pagination?.pageSize ?? 10,
  }

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    state: {
      sorting: sortingState,
      columnFilters,
      globalFilter,
      pagination: paginationState,
    },
    manualPagination: !!pagination?.onPageChange,
    pageCount: pagination?.totalPages,
  })

  // ソート変更時のコールバック
  React.useEffect(() => {
    if (sorting?.onSortChange && sortingState.length > 0) {
      const { id, desc } = sortingState[0]
      sorting.onSortChange(id, desc ? 'desc' : 'asc')
    }
  }, [sortingState, sorting])

  // 検索変更時のコールバック
  React.useEffect(() => {
    if (filtering?.onSearchChange) {
      filtering.onSearchChange(globalFilter)
    }
  }, [globalFilter, filtering])

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <p className="text-red-800">エラーが発生しました: {error.message}</p>
      </div>
    )
  }

  return (
    <div className={className}>
      {/* ヘッダー部分 */}
      {(filtering || actions) && (
        <div className="flex items-center justify-between mb-4">
          {filtering && (
            <Input
              placeholder={filtering.searchPlaceholder || "検索..."}
              value={globalFilter ?? ""}
              onChange={(event) => setGlobalFilter(event.target.value)}
              className="max-w-sm"
            />
          )}
          {actions && (
            <div className="flex items-center gap-2">
              {actions.customActions}
              {actions.onRefresh && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={actions.onRefresh}
                  disabled={isLoading}
                >
                  更新
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {/* テーブル本体 */}
      <div className="rounded-md border bg-white">
        {isLoading ? (
          <TableSkeleton rows={paginationState.pageSize} />
        ) : data.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            {emptyMessage}
          </div>
        ) : (
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    const canSort = header.column.getCanSort()
                    const isSorted = header.column.getIsSorted()
                    
                    return (
                      <TableHead 
                        key={header.id}
                        className={canSort ? "cursor-pointer select-none" : ""}
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        <div className="flex items-center gap-1">
                          {header.isPlaceholder
                            ? null
                            : flexRender(
                                header.column.columnDef.header,
                                header.getContext()
                              )}
                          {canSort && (
                            <span className="ml-1">
                              {isSorted === "asc" ? (
                                <ArrowUp className="h-4 w-4" />
                              ) : isSorted === "desc" ? (
                                <ArrowDown className="h-4 w-4" />
                              ) : (
                                <ArrowUpDown className="h-4 w-4 text-gray-400" />
                              )}
                            </span>
                          )}
                        </div>
                      </TableHead>
                    )
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* ページネーション */}
      {pagination && (data.length > 0 || paginationState.pageIndex > 0) && (
        <div className="flex items-center justify-between px-2 py-4">
          <div className="text-sm text-gray-700">
            {pagination.totalItems && (
              <span>
                全 {pagination.totalItems} 件中{" "}
                {paginationState.pageIndex * paginationState.pageSize + 1} -{" "}
                {Math.min(
                  (paginationState.pageIndex + 1) * paginationState.pageSize,
                  pagination.totalItems
                )}{" "}
                件を表示
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => pagination.onPageChange?.(0)}
              disabled={paginationState.pageIndex === 0}
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => pagination.onPageChange?.(paginationState.pageIndex - 1)}
              disabled={paginationState.pageIndex === 0}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm">
              ページ {paginationState.pageIndex + 1} / {pagination.totalPages || 1}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => pagination.onPageChange?.(paginationState.pageIndex + 1)}
              disabled={paginationState.pageIndex >= (pagination.totalPages || 1) - 1}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => pagination.onPageChange?.((pagination.totalPages || 1) - 1)}
              disabled={paginationState.pageIndex >= (pagination.totalPages || 1) - 1}
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}