'use client';
import { useState, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Loader2, Upload, Link2 } from 'lucide-react';
import { jobsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const schema = z.object({
  url: z.string().url('Must be a valid URL').includes('aajjo.com', { message: 'Must be an aajjo.com URL' }),
  label: z.string().optional(),
});
type FormData = z.infer<typeof schema>;

export default function SubmitPage() {
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [lastJob, setLastJob] = useState<{ jobId: string; url: string } | null>(null);
  const [bulkResult, setBulkResult] = useState<{ queued: number; skipped: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSingleSubmit = async (data: FormData) => {
    setSubmitting(true);
    try {
      const res = await jobsApi.submitUrl(data.url, data.label);
      const { jobId, message } = res.data;
      if (jobId) {
        setLastJob({ jobId, url: data.url });
        toast.success(`Job queued — ID: ${jobId}`);
        reset();
      } else {
        toast.warning(message ?? 'URL already processed or skipped');
      }
    } catch (e: any) {
      toast.error(e.response?.data?.message ?? 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  const onBulkUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const res = await jobsApi.submitBulk(file);
      const { queued, skipped } = res.data;
      setBulkResult({ queued, skipped });
      if (queued > 0) {
        toast.success(`${queued} job${queued > 1 ? 's' : ''} queued`);
      } else {
        toast.warning(`No new jobs queued — all ${skipped} URL${skipped > 1 ? 's' : ''} already processed or invalid`);
      }
    } catch (e: any) {
      toast.error(e.response?.data?.message ?? 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">Submit URLs</h1>
        <p className="text-muted-foreground text-sm">Queue Aajjo supplier or product pages for scraping</p>
      </div>

      {}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Link2 className="h-4 w-4" /> Single URL
          </CardTitle>
          <CardDescription>Submit one Aajjo URL to scrape immediately</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSingleSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="url">Aajjo URL</Label>
              <Input
                id="url"
                placeholder="https://www.aajjo.com/supplier/..."
                {...register('url')}
              />
              {errors.url && <p className="text-xs text-destructive">{errors.url.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="label">Label (optional)</Label>
              <Input id="label" placeholder="e.g. Steel Products Supplier" {...register('label')} />
            </div>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Queue Job
            </Button>
          </form>

          {lastJob && (
            <div className="mt-4 p-3 rounded-md bg-muted text-sm">
              <span className="font-medium">Job queued:</span>{' '}
              <Badge variant="secondary">{lastJob.jobId}</Badge>
              <p className="text-muted-foreground text-xs mt-1 truncate">{lastJob.url}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Upload className="h-4 w-4" /> Bulk CSV Upload
          </CardTitle>
          <CardDescription>Upload a CSV file — one Aajjo URL per line, max 500 URLs</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt"
              className="hidden"
              onChange={onBulkUpload}
            />
            <Button
              variant="outline"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {uploading ? 'Uploading…' : 'Choose CSV'}
            </Button>
            <p className="text-xs text-muted-foreground">CSV format: one URL per row in column A</p>
          </div>

          {bulkResult && (
            <div className="p-3 rounded-md bg-muted text-sm space-y-1">
              <p><Badge variant="success">{bulkResult.queued} queued</Badge></p>
              {bulkResult.skipped > 0 && (
                <p><Badge variant="warning">{bulkResult.skipped} skipped</Badge> (duplicates or invalid)</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
