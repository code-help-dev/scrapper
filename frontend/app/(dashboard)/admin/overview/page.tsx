'use client';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { AdminOverviewRow, UserRole } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Users, Clock, Zap, CheckCircle2, XCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

const ROLE_COLORS: Record<UserRole, string> = {
  admin:    'bg-red-100 text-red-700',
  operator: 'bg-blue-100 text-blue-700',
  viewer:   'bg-gray-100 text-gray-600',
};

function Num({ n, className }: { n: number; className?: string }) {
  return (
    <span className={cn('tabular-nums font-semibold', n === 0 ? 'text-muted-foreground/50' : '', className)}>
      {n}
    </span>
  );
}

export default function AdminOverviewPage() {
  const { data: rows = [], isLoading, dataUpdatedAt, refetch, isFetching } =
    useQuery<AdminOverviewRow[]>({
      queryKey: ['admin', 'overview'],
      queryFn: () => adminApi.getOverview().then((r) => r.data),
      refetchInterval: 30_000,
    });

  const totalPending   = rows.reduce((s, r) => s + r.pending, 0);
  const totalRunning   = rows.reduce((s, r) => s + r.running, 0);
  const totalCompleted = rows.reduce((s, r) => s + r.completed, 0);
  const totalFailed    = rows.reduce((s, r) => s + r.failed, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Admin Overview</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Per-user job metrics — auto-refreshes every 30s
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={cn('h-4 w-4 mr-2', isFetching && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <Card>
          <CardContent className="p-5 flex items-center gap-3">
            <Clock className="h-7 w-7 text-yellow-500 opacity-70" />
            <div>
              <p className="text-xs text-muted-foreground">Total Pending</p>
              <p className="text-2xl font-bold">{totalPending}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-3">
            <Zap className="h-7 w-7 text-blue-500 opacity-70" />
            <div>
              <p className="text-xs text-muted-foreground">Running</p>
              <p className="text-2xl font-bold">{totalRunning}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-3">
            <CheckCircle2 className="h-7 w-7 text-green-500 opacity-70" />
            <div>
              <p className="text-xs text-muted-foreground">Completed</p>
              <p className="text-2xl font-bold">{totalCompleted}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-3">
            <XCircle className="h-7 w-7 text-red-500 opacity-70" />
            <div>
              <p className="text-xs text-muted-foreground">Failed</p>
              <p className="text-2xl font-bold">{totalFailed}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Per-user metrics table */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" />
            Per-User Job Metrics
          </CardTitle>
          {dataUpdatedAt > 0 && (
            <span className="text-xs text-muted-foreground">
              Updated {new Date(dataUpdatedAt).toLocaleTimeString()}
            </span>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">No users found</div>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">User</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Role</th>
                  <th className="text-right px-4 py-3 font-medium text-yellow-600">Pending</th>
                  <th className="text-right px-4 py-3 font-medium text-blue-600">Running</th>
                  <th className="text-right px-4 py-3 font-medium text-green-600">Completed</th>
                  <th className="text-right px-4 py-3 font-medium text-red-600">Failed</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Queue</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.userId} className="border-b hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 font-medium">{row.email}</td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize',
                        ROLE_COLORS[row.role] ?? '',
                      )}>
                        {row.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Num n={row.pending} className="text-yellow-600" />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Num n={row.running} className="text-blue-600" />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Num n={row.completed} className="text-green-600" />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Num n={row.failed} className="text-red-600" />
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground text-xs">
                      {row.queue.waiting}w / {row.queue.active}a
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-muted/20 font-semibold">
                  <td className="px-4 py-3 text-muted-foreground" colSpan={2}>Total</td>
                  <td className="px-4 py-3 text-right text-yellow-600 tabular-nums">{totalPending}</td>
                  <td className="px-4 py-3 text-right text-blue-600 tabular-nums">{totalRunning}</td>
                  <td className="px-4 py-3 text-right text-green-600 tabular-nums">{totalCompleted}</td>
                  <td className="px-4 py-3 text-right text-red-600 tabular-nums">{totalFailed}</td>
                  <td className="px-4 py-3" />
                </tr>
              </tfoot>
            </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
