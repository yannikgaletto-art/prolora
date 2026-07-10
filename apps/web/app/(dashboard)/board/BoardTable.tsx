'use client';

import { useState } from 'react';
import { fetchApi, errorMessage } from '@/app/lib/api';
import { Badge } from '@/app/components/Badge';
import { Select } from '@/app/components/Select';
import { Toast, type ToastMessage } from '@/app/components/Toast';
import type { BoardItemRow } from '@/lib/db';

// Mirrors BOARD_ITEM_STATUSES from lib/board/board-service.ts, not imported:
// that module pulls in getServiceDb() -> next/headers, which cannot enter a
// Client Component bundle.
const BOARD_ITEM_STATUSES = ['open', 'planned', 'in_progress', 'shipped', 'declined'] as const;

function humanize(value: string): string {
  return value.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

const STATUS_OPTIONS = BOARD_ITEM_STATUSES.map((status) => ({
  value: status,
  label: humanize(status),
}));

export interface BoardTableProps {
  items: BoardItemRow[];
  workspaceSlug: string;
}

// Inline status editing (F5-1): each row's Select PATCHes
// /v1/boards/:slug/items/:id/status directly — optimistic update, rolled
// back on failure.
export function BoardTable({ items, workspaceSlug }: BoardTableProps) {
  const [rows, setRows] = useState(items);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  async function handleStatusChange(id: string, nextStatus: string) {
    const previous = rows;
    setRows((current) =>
      current.map((item) =>
        item.id === id ? { ...item, status: nextStatus as BoardItemRow['status'] } : item
      )
    );
    setPendingId(id);
    try {
      await fetchApi(`/v1/boards/${workspaceSlug}/items/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      setToast({ variant: 'success', message: 'Status updated.' });
    } catch (error) {
      setRows(previous);
      setToast({ variant: 'error', message: errorMessage(error) });
    } finally {
      setPendingId(null);
    }
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-xs font-medium uppercase tracking-wide text-gray-500">
              <th className="px-5 py-3">Title</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3">Votes</th>
              <th className="px-5 py-3">Category</th>
              <th className="px-5 py-3">Update status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((item) => (
              <tr key={item.id}>
                <td className="max-w-xs px-5 py-3">
                  <p className="truncate font-medium text-gray-900">{item.title}</p>
                  {item.linked_feedback_ids && item.linked_feedback_ids.length > 0 && (
                    <Badge tone="teal" className="mt-1">
                      {item.linked_feedback_ids.length} linked feedback
                    </Badge>
                  )}
                </td>
                <td className="px-5 py-3">
                  <Badge status={item.status} />
                </td>
                <td className="px-5 py-3 text-gray-700">{item.vote_count}</td>
                <td className="px-5 py-3 text-gray-500">{item.category ?? '—'}</td>
                <td className="px-5 py-3">
                  <Select
                    aria-label={`Change status for ${item.title}`}
                    options={STATUS_OPTIONS}
                    value={item.status}
                    disabled={pendingId === item.id}
                    onChange={(event) => handleStatusChange(item.id, event.target.value)}
                    className="max-w-[10rem]"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {toast && (
        <Toast variant={toast.variant} message={toast.message} action={toast.action} onDismiss={() => setToast(null)} />
      )}
    </>
  );
}
