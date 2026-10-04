"use client";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { useState } from "react";
export function DataTable<T>({
  data,
  columns,
  initialSort,
  onRow,
  empty,
}: {
  data: T[];
  columns: ColumnDef<T>[];
  initialSort: SortingState;
  onRow?: (row: T) => void;
  empty: string;
}) {
  "use no memo";
  const [sorting, setSorting] = useState<SortingState>(initialSort);
  // TanStack Table intentionally exposes mutable accessors; keep this component uncompiled.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 100 } },
    defaultColumn: { sortUndefined: "last" },
  });
  return (
    <>
      <div className="table-scroll">
        <table>
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => (
                  <th
                    key={header.id}
                    aria-sort={
                      header.column.getIsSorted() === "asc"
                        ? "ascending"
                        : header.column.getIsSorted() === "desc"
                          ? "descending"
                          : "none"
                    }
                  >
                    <button
                      disabled={!header.column.getCanSort()}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                      <span className="sort-arrow">
                        {header.column.getIsSorted() === "desc"
                          ? "↓"
                          : header.column.getIsSorted() === "asc"
                            ? "↑"
                            : ""}
                      </span>
                    </button>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                onClick={() => onRow?.(row.original)}
                tabIndex={onRow ? 0 : undefined}
                onKeyDown={(event) => {
                  if (
                    event.target === event.currentTarget &&
                    (event.key === "Enter" || event.key === " ")
                  ) {
                    event.preventDefault();
                    onRow?.(row.original);
                  }
                }}
                className={onRow ? "clickable" : ""}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!data.length && (
          <div className="table-empty">
            <span className="empty-cross">＋</span>
            <p>{empty}</p>
          </div>
        )}
      </div>
      {data.length > 100 && (
        <div className="table-pagination" aria-label="Results pages">
          <span>
            {table.getState().pagination.pageIndex * 100 + 1}–
            {Math.min(
              (table.getState().pagination.pageIndex + 1) * 100,
              data.length,
            )}{" "}
            of {data.length.toLocaleString()} results
          </span>
          <button
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Previous page
          </button>
          <button
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next page
          </button>
        </div>
      )}
    </>
  );
}
