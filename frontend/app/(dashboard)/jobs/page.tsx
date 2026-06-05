'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { jobsApi } from '@/lib/api';
import { ExtractionJob, JobStatus, PaginatedResponse } from '@/types';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import {
  RotateCcw,
  XCircle,
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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

export default function JobsPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const { data, isLoading } = useQuery<PaginatedResponse<ExtractionJob>>({
    queryKey: ['jobs', page, statusFilter, search],
    queryFn: () =>
      jobsApi
        .list({
          page,
          limit: 20,
          status: statusFilter === 'all' ? undefined : statusFilter,
          search: search || undefined,
        })
        .then((r) => r.data),
    refetchInterval: 5_000,
  });

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

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput.trim());
    setPage(1);
  };

  const handleRowClick = (id: string) => {
    router.push(`/jobs/${id}`);
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

        <div className="flex items-center gap-2 flex-wrap">
          {/* Search */}
          <form onSubmit={handleSearch} className="flex gap-1">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search by URL…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-8 h-8 w-52 text-sm"
              />
            </div>
            <Button type="submit" size="sm" variant="outline" className="h-8">
              Search
            </Button>
            {search && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8"
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

          {/* Status filter */}
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
            <SelectTrigger className="w-36 h-8">
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
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
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
                    <td colSpan={6} className="p-6 text-center text-muted-foreground">
                      Loading…
                    </td>
                  </tr>
                )}
                {!isLoading && data?.data.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-muted-foreground">
                      {search ? `No jobs matching "${search}"` : 'No jobs found'}
                    </td>
                  </tr>
                )}
                {data?.data.map((job) => (
                  <tr
                    key={job._id}
                    className="border-b hover:bg-muted/30 cursor-pointer"
                    onClick={() => handleRowClick(job._id)}
                  >
                    <td className="p-3 max-w-xs">
                      <a
                        href={job.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline truncate block text-xs"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {job.sourceUrl}
                      </a>
                      {job.errorMessage && (
                        <p className="text-xs text-destructive mt-0.5 truncate">
                          {job.errorMessage}
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
                        {/* Retry: failed or re-scrape completed */}
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
                        {/* Pause: queued only */}
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
                        {/* Resume: paused only */}
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
                        {/* Cancel: queued, paused, or processing (stuck) */}
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
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {data && data.meta.pages > 1 && (
            <div className="flex items-center justify-between p-3 border-t">
              <p className="text-xs text-muted-foreground">
                {data.meta.total.toLocaleString()} total — page {data.meta.page} of{' '}
                {data.meta.pages}
              </p>
              <div className="flex gap-1">
                <Button
                  size="icon"
                  variant="outline"
                  className="h-7 w-7"
                  disabled={page === 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="outline"
                  className="h-7 w-7"
                  disabled={page === data.meta.pages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
