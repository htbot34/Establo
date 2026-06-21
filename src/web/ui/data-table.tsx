import { useState, type ReactNode } from 'react';
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type RowData,
  type SortingState,
  useReactTable,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '../lib/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    align?: 'left' | 'right' | 'center';
    /** Extra classes applied to both the header and body cells of this column. */
    cellClassName?: string;
  }
}

export interface DataTableProps<TData> {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  initialSorting?: SortingState;
  emptyState?: ReactNode;
  /** Constrain height so the sticky header engages on long lists. */
  maxHeightClassName?: string;
}

export function DataTable<TData>({
  columns,
  data,
  initialSorting,
  emptyState,
  maxHeightClassName = 'max-h-[70vh]',
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting ?? []);

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const rows = table.getRowModel().rows;

  return (
    <Table wrapperClassName={maxHeightClassName}>
      <TableHeader>
        {table.getHeaderGroups().map((hg) => (
          <TableRow key={hg.id} className="hover:bg-transparent">
            {hg.headers.map((header) => {
              const meta = header.column.columnDef.meta;
              const sortable = header.column.getCanSort();
              const sorted = header.column.getIsSorted();
              return (
                <TableHead
                  key={header.id}
                  className={cn(
                    'sticky top-0 z-10 border-b border-border bg-card',
                    meta?.align === 'right' && 'text-right',
                    meta?.align === 'center' && 'text-center',
                    meta?.cellClassName,
                  )}
                >
                  {header.isPlaceholder ? null : sortable ? (
                    <button
                      type="button"
                      onClick={header.column.getToggleSortingHandler()}
                      className={cn(
                        'inline-flex items-center gap-1 select-none uppercase tracking-wide transition-colors hover:text-foreground',
                        meta?.align === 'right' && 'flex-row-reverse',
                      )}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {sorted === 'asc' ? (
                        <ArrowUp className="size-3" aria-hidden="true" />
                      ) : sorted === 'desc' ? (
                        <ArrowDown className="size-3" aria-hidden="true" />
                      ) : (
                        <ChevronsUpDown className="size-3 opacity-50" aria-hidden="true" />
                      )}
                    </button>
                  ) : (
                    flexRender(header.column.columnDef.header, header.getContext())
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={columns.length} className="p-0">
              {emptyState}
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row) => (
            <TableRow key={row.id}>
              {row.getVisibleCells().map((cell) => {
                const meta = cell.column.columnDef.meta;
                return (
                  <TableCell
                    key={cell.id}
                    className={cn(
                      meta?.align === 'right' && 'text-right',
                      meta?.align === 'center' && 'text-center',
                      meta?.cellClassName,
                    )}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                );
              })}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
