'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { jobsApi } from '@/lib/api';
import { ExtractionJob, JobStatus } from '@/types';
import { toast } from 'sonner';
import { format, formatDistanceToNow } from 'date-fns';
import {
  ArrowLeft,
  RotateCcw,
  XCircle,
  Pause,
  Play,
  ExternalLink,
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type JobDetail = ExtractionJob & { bullState?: string };

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

const ACTIVE_STATUSES: JobStatus[] = ['queued', 'processing', 'retry'];

function StatBox({
  label,
  value,
  color,
}: {
  label: string;
  value: number | string;
  color?: string;
}) {
  return (
    <div className="rounded-lg border p-3 space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${color ?? ''}`}>{value}</p>
    </div>
  );
}

function TimelineRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-center justify-between py-2 border-b last:border-0 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">
        {value ? (
          <span title={format(new Date(value), 'PPpp')}>
            {formatDistanceToNow(new Date(value), { addSuffix: true })}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </span>
    </div>
  );
}

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();

  const { data: job, isLoading, error } = useQuery<JobDetail>({
    queryKey: ['job', id],
    queryFn: () => jobsApi.get(id).then((r) => r.data),
    // Auto-poll every 2s while active
    refetchInterval: (query) => {
      const status = query.state.data?.status as JobStatus | undefined;
      return status && ACTIVE_STATUSES.includes(status) ? 2000 : false;
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['job', id] });
    qc.invalidateQueries({ queryKey: ['jobs'] });
  };

  const retryMutation = useMutation({
    mutationFn: () => jobsApi.retry(id),
    onSuccess: () => { toast.success('Job re-queued'); invalidate(); },
    onError: (e: any) => toast.error(e.response?.data?.message ?? 'Retry failed'),
  });

  const cancelMutation = useMutation({
    mutationFn: () => jobsApi.cancel(id),
    onSuccess: () => { toast.success('Job cancelled'); invalidate(); },
    onError: (e: any) => toast.error(e.response?.data?.message ?? 'Cancel failed'),
  });

  const pauseMutation = useMutation({
    mutationFn: () => jobsApi.pause(id),
    onSuccess: () => { toast.success('Job paused'); invalidate(); },
    onError: (e: any) => toast.error(e.response?.data?.message ?? 'Pause failed'),
  });

  const resumeMutation = useMutation({
    mutationFn: () => jobsApi.resume(id),
    onSuccess: () => { toast.success('Job resumed'); invalidate(); },
    onError: (e: any) => toast.error(e.response?.data?.message ?? 'Resume failed'),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Loading job…</span>
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <AlertCircle className="h-10 w-10 text-destructive/60" />
        <p className="text-sm text-muted-foreground">Job not found</p>
        <Button variant="outline" size="sm" onClick={() => router.push('/jobs')}>
          Back to Jobs
        </Button>
      </div>
    );
  }

  const total = job.totalProducts ?? 0;
  const processed = job.processedCount ?? 0;
  const failed = job.failedCount ?? 0;
  const successful = processed - failed >= 0 ? processed - failed : 0;
  const remaining = Math.max(0, total - processed - failed);
  const pct = total > 0 ? Math.min(100, Math.round(((processed + failed) / total) * 100)) : 0;
  const isActive = ACTIVE_STATUSES.includes(job.status);

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Back + Header */}
      <div className="flex items-start gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 mt-0.5"
          onClick={() => router.push('/jobs')}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold">Job Detail</h1>
            <Badge variant={STATUS_VARIANT[job.status]} className="capitalize">
              {isActive && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
              {job.status}
            </Badge>
            {job.bullState && job.bullState !== job.status && (
              <Badge variant="secondary" className="text-xs font-mono">
                Bull: {job.bullState}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground font-mono mt-1 truncate">{id}</p>
        </div>

        {/* Action buttons */}
        <div className="flex gap-1 shrink-0">
          {job.status === 'failed' && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={retryMutation.isPending}
              onClick={() => retryMutation.mutate()}
            >
              <RotateCcw className="h-3.5 w-3.5" /> Retry
            </Button>
          )}
          {job.status === 'queued' && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-amber-600 border-amber-300"
              disabled={pauseMutation.isPending}
              onClick={() => pauseMutation.mutate()}
            >
              <Pause className="h-3.5 w-3.5" /> Pause
            </Button>
          )}
          {job.status === 'paused' && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-green-600 border-green-300"
              disabled={resumeMutation.isPending}
              onClick={() => resumeMutation.mutate()}
            >
              <Play className="h-3.5 w-3.5" /> Resume
            </Button>
          )}
          {(job.status === 'queued' || job.status === 'paused') && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-destructive border-destructive/30"
              disabled={cancelMutation.isPending}
              onClick={() => cancelMutation.mutate()}
            >
              <XCircle className="h-3.5 w-3.5" /> Cancel
            </Button>
          )}
        </div>
      </div>

      {/* Job Info */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Job Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Type</span>
            <span className="capitalize font-medium">{job.jobType}</span>
          </div>
          <div className="flex items-start justify-between gap-4">
            <span className="text-muted-foreground shrink-0">Source URL</span>
            <a
              href={job.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-primary hover:underline text-xs truncate"
            >
              {job.sourceUrl}
              <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
          </div>
          {job.attempts > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Attempts</span>
              <span className="font-medium">{job.attempts}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Progress (only for batch/discovery jobs) */}
      {total > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Progress
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Progress bar */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="font-medium">{processed + failed} of {total} processed</span>
                <span className="text-muted-foreground">{pct}%</span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    failed > 0 ? 'bg-yellow-500' : pct === 100 ? 'bg-green-500' : 'bg-blue-500'
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>

            {/* Stat grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatBox label="Total" value={total} />
              <StatBox
                label="Successful"
                value={successful}
                color="text-green-600"
              />
              <StatBox
                label="Failed"
                value={failed}
                color={failed > 0 ? 'text-destructive' : undefined}
              />
              <StatBox label="Remaining" value={remaining} color="text-muted-foreground" />
            </div>

            {/* Live indicator */}
            {isActive && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
                </span>
                Auto-refreshing every 2s
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Timeline */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Timeline
          </CardTitle>
        </CardHeader>
        <CardContent>
          <TimelineRow label="Submitted" value={job.createdAt} />
          <TimelineRow label="Started" value={job.startedAt} />
          <TimelineRow label="Last Updated" value={job.updatedAt} />
          {job.pausedAt && <TimelineRow label="Paused" value={job.pausedAt} />}
          <TimelineRow label="Completed" value={job.completedAt} />
        </CardContent>
      </Card>

      {/* Error */}
      {job.errorMessage && (
        <Card className="border-destructive/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-destructive flex items-center gap-1.5">
              <AlertCircle className="h-4 w-4" /> Error
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm font-mono bg-destructive/5 rounded p-3 text-destructive break-all">
              {job.errorMessage}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Products scraped */}
      {job.status === 'completed' && job.productIds?.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              Scraped Products ({job.productIds.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Link
              href={`/products`}
              className="text-sm text-primary hover:underline"
            >
              View in Products →
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Footer timestamps */}
      <div className="text-xs text-muted-foreground text-right pb-4">
        <Clock className="inline h-3 w-3 mr-1" />
        Submitted {format(new Date(job.createdAt), 'PPpp')}
      </div>
    </div>
  );
}
