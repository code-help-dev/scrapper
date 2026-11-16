'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { jobsApi } from '@/lib/api';
import { ExtractionJob, JobStatus, PaginatedResponse, BulkActionResult } from '@/types';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import {
  RotateCcw,
  XCircle,
  Pause,
  Play,
  Search,
  Trash2,
  Flag,
  Download,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { SmartPagination } from '@/components/ui/smart-pagination';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const STATUS_VARIANT: Record<
  JobStatus,
  'default' | 'success' | 'destructive' | 'warning' | 'info' | 'secondary'
> = {
  queued: 'secondary',
  processing: 'info',
  completed: 'success',
  failed: 'destructive',
  retry: 'warning',
  paused: 'default',
};

function JobProgress({ job }: { job: ExtractionJob }) {
  const total = job.totalProducts || 0;
  if (total <= 0) {
    return (
      <span className="text-xs text-muted-foreground">
        {job.processedCount > 0 ? '1 product' : '—'}
      </span>
    );
  }
  const done = job.processedCount + job.failedCount;
  const pct = Math.min(100, Math.round((done / total) * 100));
  const barColor =
    job.failedCount > 0
      ? 'bg-yellow-500'
      : pct === 100
        ? 'bg-green-500'
        : 'bg-blue-500';

  return (
    <div className="space-y-1 w-44">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">
          {job.processedCount}/{total}
        </span>
        <span className="text-muted-foreground">{pct}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {job.failedCount > 0 && (
        <span className="text-[10px] text-destructive">{job.failedCount} failed</span>
      )}
    </div>
  );
}

type PendingAction =
  | { kind: 'delete'; mode: 'ids'; ids: string[]; label: string }
  | { kind: 'delete'; mode: 'status'; status: 'completed' | 'failed' | 'flagged'; label: string }
  | { kind: 'retry'; mode: 'ids'; ids: string[]; label: string }
  | { kind: 'retry'; mode: 'all'; label: string }
  | { kind: 'retry'; mode: 'onlyFlagged'; label: string; maxConfidence?: number };

function summarizeResult(kind: 'delete' | 'retry', res: BulkActionResult) {
  const done = kind === 'delete' ? res.deleted ?? 0 : res.retried ?? 0;
  const verb = kind === 'delete' ? 'deleted' : 'retried';
  if (res.failed.length === 0) {
    return `${done} of ${res.requested} job(s) ${verb}`;
  }
  return `${done} of ${res.requested} job(s) ${verb} — ${res.failed.length} failed`;
}

export default function JobsPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [confidenceThreshold, setConfidenceThreshold] = useState<string>('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [exportingFormat, setExportingFormat] = useState<'csv' | 'xlsx' | null>(null);

  const maxConfidence = confidenceThreshold !== '' ? Number(confidenceThreshold) : undefined;

  const { data, isLoading } = useQuery<PaginatedResponse<ExtractionJob>>({
    queryKey: ['jobs', page, statusFilter, search, flaggedOnly, maxConfidence],
    queryFn: () =>
      jobsApi
        .list({
          page,
          limit: 20,
          status: statusFilter === 'all' ? undefined : statusFilter,
          search: search || undefined,
          flagged: flaggedOnly || undefined,
          maxConfidence: flaggedOnly ? maxConfidence : undefined,
        })
        .then((r) => r.data),
    refetchInterval: 5_000,
  });

  const { data: impactData, isLoading: impactLoading } = useQuery<number>({
    queryKey: ['jobs-impact', pendingAction],
    queryFn: async () => {
      if (!pendingAction) return 0;
      if (pendingAction.mode === 'ids') return pendingAction.ids.length;
      if (pendingAction.kind === 'delete' && pendingAction.mode === 'status') {
        const params =
          pendingAction.status === 'flagged'
            ? { flagged: true, limit: 1 }
            : { status: pendingAction.status, limit: 1 };
        const res = await jobsApi.list(params);
        return (res.data as PaginatedResponse<ExtractionJob>).meta.total;
      }
      if (pendingAction.kind === 'retry' && pendingAction.mode === 'all') {
        const res = await jobsApi.list({ status: 'failed', limit: 1 });
        return (res.data as PaginatedResponse<ExtractionJob>).meta.total;
      }
      if (pendingAction.kind === 'retry' && pendingAction.mode === 'onlyFlagged') {
        const res = await jobsApi.list({
          flagged: true,
          maxConfidence: pendingAction.maxConfidence,
          limit: 1,
        });
        return (res.data as PaginatedResponse<ExtractionJob>).meta.total;
      }
      return 0;
    },
    enabled: !!pendingAction,
  });

  const clearSelection = () => setSelectedIds(new Set());

  const retryMutation = useMutation({
    mutationFn: (id: string) => jobsApi.retry(id),
    onSuccess: () => {
      toast.success('Job re-queued');
      qc.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.message ?? 'Retry failed'),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => jobsApi.cancel(id),
    onSuccess: () => {
      toast.success('Job cancelled');
      qc.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.message ?? 'Cancel failed'),
  });

  const pauseMutation = useMutation({
    mutationFn: (id: string) => jobsApi.pause(id),
    onSuccess: () => {
      toast.success('Job paused');
      qc.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.message ?? 'Pause failed'),
  });

  const resumeMutation = useMutation({
    mutationFn: (id: string) => jobsApi.resume(id),
    onSuccess: () => {
      toast.success('Job resumed');
      qc.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.message ?? 'Resume failed'),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (payload: Parameters<typeof jobsApi.bulkDelete>[0]) => jobsApi.bulkDelete(payload),
    onSuccess: (res) => {
      const result = res.data as BulkActionResult;
      if (result.failed.length > 0) toast.warning(summarizeResult('delete', result));
      else toast.success(summarizeResult('delete', result));
      qc.invalidateQueries({ queryKey: ['jobs'] });
      clearSelection();
    },
    onError: (e: any) => toast.error(e.response?.data?.message ?? 'Bulk delete failed'),
    onSettled: () => setPendingAction(null),
  });

  const bulkRetryMutation = useMutation({
    mutationFn: (payload: Parameters<typeof jobsApi.bulkRetry>[0]) => jobsApi.bulkRetry(payload),
    onSuccess: (res) => {
      const result = res.data as BulkActionResult;
      if (result.failed.length > 0) toast.warning(summarizeResult('retry', result));
      else toast.success(summarizeResult('retry', result));
      qc.invalidateQueries({ queryKey: ['jobs'] });
      clearSelection();
    },
    onError: (e: any) => toast.error(e.response?.data?.message ?? 'Bulk retry failed'),
    onSettled: () => setPendingAction(null),
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput.trim());
    setPage(1);
  };

  const handleRowClick = (id: string) => {
    router.push(`/jobs/${id}`);
  };

  const toggleRow = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const rows = data?.data ?? [];
  const allOnPageSelected = rows.length > 0 && rows.every((j) => selectedIds.has(j._id));
  const toggleSelectAll = (checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      rows.forEach((j) => (checked ? next.add(j._id) : next.delete(j._id)));
      return next;
    });
  };

  const runConfirmedAction = () => {
    if (!pendingAction) return;
    if (pendingAction.kind === 'delete') {
      if (pendingAction.mode === 'ids') {
        bulkDeleteMutation.mutate({ jobIds: pendingAction.ids, confirm: true });
      } else {
        bulkDeleteMutation.mutate({ status: pendingAction.status, confirm: true });
      }
    } else {
      if (pendingAction.mode === 'ids') {
        bulkRetryMutation.mutate({ jobIds: pendingAction.ids });
      } else if (pendingAction.mode === 'all') {
        bulkRetryMutation.mutate({ all: true });
      } else {
        bulkRetryMutation.mutate({ onlyFlagged: true, maxConfidence: pendingAction.maxConfidence });
      }
    }
  };

  const actionRunning = bulkDeleteMutation.isPending || bulkRetryMutation.isPending;

  const handleExport = async (format: 'csv' | 'xlsx') => {
    setExportingFormat(format);
    try {
      await jobsApi.exportFlagged(format);
      toast.success('Flagged jobs exported');
    } catch (e: any) {
      toast.error(e.response?.data?.message ?? 'Export failed');
    } finally {
      setExportingFormat(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Job Monitor</h1>
          <p className="text-muted-foreground text-sm">
            {data ? `${data.meta.total.toLocaleString()} total jobs` : 'Auto-refreshes every 5s'}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
          <form onSubmit={handleSearch} className="flex gap-1 flex-1 sm:flex-none">
            <div className="relative flex-1 sm:flex-none">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search by URL…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-8 h-8 w-full sm:w-52 text-sm"
              />
            </div>
            <Button type="submit" size="sm" variant="outline" className="h-8 shrink-0">
              Search
            </Button>
            {search && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 shrink-0"
                onClick={() => {
                  setSearch('');
                  setSearchInput('');
                  setPage(1);
                }}
              >
                Clear
              </Button>
            )}
          </form>

          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
            <SelectTrigger className="w-full sm:w-36 h-8">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="queued">Queued</SelectItem>
              <SelectItem value="processing">Processing</SelectItem>
              <SelectItem value="paused">Paused</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>

          <Button
            size="sm"
            variant={flaggedOnly ? 'default' : 'outline'}
            className="h-8"
            onClick={() => { setFlaggedOnly((v) => !v); setPage(1); }}
          >
            <Flag className="h-3.5 w-3.5 mr-1.5" /> Flagged
          </Button>

          <div className="flex items-center gap-1" title="Only include flagged products at or below this confidence score">
            <Input
              type="number"
              min={0}
              max={100}
              placeholder="Confidence ≤"
              value={confidenceThreshold}
              onChange={(e) => { setConfidenceThreshold(e.target.value); setPage(1); }}
              className="h-8 w-28 text-sm"
            />
            <span className="text-xs text-muted-foreground">%</span>
          </div>

          <Button
            size="sm"
            variant={statusFilter === 'failed' ? 'destructive' : 'outline'}
            className="h-8"
            onClick={() => { setStatusFilter((v) => (v === 'failed' ? 'all' : 'failed')); setPage(1); }}
          >
            <AlertTriangle className="h-3.5 w-3.5 mr-1.5" /> Failed
          </Button>

          <Button
            size="sm"
            variant="outline"
            className="h-8"
            disabled={exportingFormat !== null}
            onClick={() => handleExport('csv')}
          >
            {exportingFormat === 'csv' ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5 mr-1.5" />
            )}
            Export Flagged (CSV)
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            disabled={exportingFormat !== null}
            onClick={() => handleExport('xlsx')}
          >
            {exportingFormat === 'xlsx' ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5 mr-1.5" />
            )}
            Excel
          </Button>
        </div>
      </div>

      {/* Bulk quick actions — operate on ALL matching jobs, not just this page */}
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-muted-foreground mr-1">Bulk:</span>
        <Button
          size="sm" variant="outline" className="h-7 text-xs"
          onClick={() => setPendingAction({ kind: 'retry', mode: 'all', label: 'Retry all failed jobs' })}
        >
          <RotateCcw className="h-3 w-3 mr-1" /> Retry all failed
        </Button>
        <Button
          size="sm" variant="outline" className="h-7 text-xs"
          onClick={() =>
            setPendingAction({
              kind: 'retry',
              mode: 'onlyFlagged',
              maxConfidence,
              label:
                maxConfidence != null
                  ? `Retry flagged jobs with confidence ≤ ${maxConfidence}%`
                  : 'Retry all flagged jobs',
            })
          }
        >
          <Flag className="h-3 w-3 mr-1" />
          {maxConfidence != null ? `Retry flagged ≤ ${maxConfidence}%` : 'Retry all flagged'}
        </Button>
        <Button
          size="sm" variant="outline" className="h-7 text-xs text-destructive"
          onClick={() => setPendingAction({ kind: 'delete', mode: 'status', status: 'completed', label: 'Delete all completed jobs' })}
        >
          <Trash2 className="h-3 w-3 mr-1" /> Delete completed
        </Button>
        <Button
          size="sm" variant="outline" className="h-7 text-xs text-destructive"
          onClick={() => setPendingAction({ kind: 'delete', mode: 'status', status: 'failed', label: 'Delete all failed jobs' })}
        >
          <Trash2 className="h-3 w-3 mr-1" /> Delete failed
        </Button>
        <Button
          size="sm" variant="outline" className="h-7 text-xs text-destructive"
          onClick={() => setPendingAction({ kind: 'delete', mode: 'status', status: 'flagged', label: 'Delete all flagged jobs' })}
        >
          <Trash2 className="h-3 w-3 mr-1" /> Delete flagged
        </Button>
      </div>

      {/* Selection action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <span className="font-medium">{selectedIds.size} job(s) selected</span>
          <div className="flex gap-2">
            <Button
              size="sm" variant="outline" className="h-7"
              onClick={() => setPendingAction({ kind: 'retry', mode: 'ids', ids: Array.from(selectedIds), label: `Retry ${selectedIds.size} selected job(s)` })}
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Retry selected
            </Button>
            <Button
              size="sm" variant="outline" className="h-7 text-destructive"
              onClick={() => setPendingAction({ kind: 'delete', mode: 'ids', ids: Array.from(selectedIds), label: `Delete ${selectedIds.size} selected job(s)` })}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete selected
            </Button>
            <Button size="sm" variant="ghost" className="h-7" onClick={clearSelection}>
              Clear
            </Button>
          </div>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-3 w-10">
                    <Checkbox
                      checked={allOnPageSelected}
                      onCheckedChange={(c) => toggleSelectAll(c === true)}
                      aria-label="Select all jobs on this page"
                    />
                  </th>
                  <th className="text-left p-3 font-medium">Source URL</th>
                  <th className="text-left p-3 font-medium">Type</th>
                  <th className="text-left p-3 font-medium">Status</th>
                  <th className="text-left p-3 font-medium w-48">Progress</th>
                  <th className="text-left p-3 font-medium">Submitted</th>
                  <th className="text-left p-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-muted-foreground">
                      Loading…
                    </td>
                  </tr>
                )}
                {!isLoading && rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-muted-foreground">
                      {search ? `No jobs matching "${search}"` : 'No jobs found'}
                    </td>
                  </tr>
                )}
                {rows.map((job) => (
                  <tr
                    key={job._id}
                    className="border-b hover:bg-muted/30 cursor-pointer"
                    onClick={() => handleRowClick(job._id)}
                  >
                    <td className="p-3" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedIds.has(job._id)}
                        onCheckedChange={(c) => toggleRow(job._id, c === true)}
                        aria-label={`Select job ${job._id}`}
                      />
                    </td>
                    <td className="p-3 max-w-xs">
                      <div className="flex items-center gap-1.5">
                        <a
                          href={job.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline truncate block text-xs"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {job.sourceUrl}
                        </a>
                        {job.hasFlaggedProduct && (
                          <Badge variant="warning" className="gap-1 text-[10px] px-1.5 py-0 shrink-0">
                            <Flag className="h-2.5 w-2.5" />
                            Flagged{job.flaggedConfidence != null ? ` (${job.flaggedConfidence}%)` : ''}
                          </Badge>
                        )}
                      </div>
                      {job.errorMessage && (
                        <p className="text-xs text-destructive mt-0.5 truncate">
                          {job.errorMessage}
                        </p>
                      )}
                      {job.retryCount > 0 && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          Retried {job.retryCount}×
                          {job.lastRetriedAt && ` · last ${formatDistanceToNow(new Date(job.lastRetriedAt), { addSuffix: true })}`}
                        </p>
                      )}
                    </td>
                    <td className="p-3 capitalize text-xs">{job.jobType}</td>
                    <td className="p-3">
                      <Badge variant={STATUS_VARIANT[job.status]}>{job.status}</Badge>
                    </td>
                    <td className="p-3">
                      <JobProgress job={job} />
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(job.createdAt), { addSuffix: true })}
                    </td>
                    <td className="p-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex gap-1">
                        {(job.status === 'failed' || job.status === 'completed') && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            title={job.status === 'completed' ? 'Re-scrape' : 'Retry'}
                            onClick={() => retryMutation.mutate(job._id)}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {job.status === 'queued' && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-amber-600"
                            title="Pause"
                            onClick={() => pauseMutation.mutate(job._id)}
                          >
                            <Pause className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {job.status === 'paused' && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-green-600"
                            title="Resume"
                            onClick={() => resumeMutation.mutate(job._id)}
                          >
                            <Play className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {(job.status === 'queued' || job.status === 'paused' || job.status === 'processing') && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive"
                            title="Cancel"
                            onClick={() => cancelMutation.mutate(job._id)}
                          >
                            <XCircle className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-destructive"
                          title="Delete job record"
                          onClick={() => setPendingAction({ kind: 'delete', mode: 'ids', ids: [job._id], label: 'Delete this job' })}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data && data.meta.pages > 1 && (
            <SmartPagination
              currentPage={page}
              totalPages={data.meta.pages}
              totalItems={data.meta.total}
              onPageChange={setPage}
              className="p-3 border-t"
            />
          )}
        </CardContent>
      </Card>

      <AlertDialog open={pendingAction !== null} onOpenChange={(open) => { if (!open) setPendingAction(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingAction?.label}</AlertDialogTitle>
            <AlertDialogDescription>
              {impactLoading
                ? 'Calculating impact…'
                : pendingAction?.kind === 'delete'
                  ? `This will permanently delete ${impactData ?? 0} job record(s). Linked products are not affected. This cannot be undone.`
                  : `This will re-queue ${impactData ?? 0} job(s) for extraction.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionRunning}>Cancel</AlertDialogCancel>
            <Button
              variant={pendingAction?.kind === 'delete' ? 'destructive' : 'default'}
              disabled={actionRunning || impactLoading || impactData === 0}
              onClick={(e) => { e.preventDefault(); runConfirmedAction(); }}
            >
              {actionRunning && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Confirm
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
