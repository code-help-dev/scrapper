'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { exportApi, productsApi } from '@/lib/api';
import { ExportJob, ExportFormat, CategoryInfo, SubcategoryInfo } from '@/types';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import {
  Download,
  FileSpreadsheet,
  FileJson,
  FileText,
  ShoppingBag,
  Globe,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const FORMAT_META: Record<
  ExportFormat,
  { label: string; icon: React.ElementType; desc: string }
> = {
  csv: { label: 'CSV', icon: FileText, desc: 'Flat CSV — one row per product' },
  xlsx: { label: 'Excel', icon: FileSpreadsheet, desc: '4-sheet Excel workbook' },
  json: { label: 'JSON', icon: FileJson, desc: 'Full nested JSON documents' },
  shopify_csv: { label: 'Shopify CSV', icon: ShoppingBag, desc: 'Direct Shopify import' },
  woocommerce_xml: { label: 'WooCommerce XML', icon: Globe, desc: 'WooCommerce WXR format' },
};

export default function ExportPage() {
  const qc = useQueryClient();
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [category, setCategory] = useState('');
  const [subCategory, setSubCategory] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);
  const [pollingIds, setPollingIds] = useState<Set<string>>(new Set());
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // Category dropdown
  const { data: categories = [] } = useQuery<CategoryInfo[]>({
    queryKey: ['export-categories'],
    queryFn: () => productsApi.categories().then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  // Subcategory dropdown (dependent on category)
  const { data: subcategories = [] } = useQuery<SubcategoryInfo[]>({
    queryKey: ['export-subcategories', category],
    queryFn: () =>
      category ? productsApi.subcategories(category).then((r) => r.data) : Promise.resolve([]),
    enabled: !!category,
    staleTime: 5 * 60 * 1000,
  });

  // Export history
  const { data: history, isLoading: historyLoading } = useQuery<{ data: ExportJob[] }>({
    queryKey: ['export-history'],
    queryFn: () => exportApi.list().then((r) => r.data),
    refetchInterval: pollingIds.size > 0 ? 3_000 : false,
    select: (d) => {
      const pending = (d.data ?? []).filter(
        (j) => pollingIds.has(j._id) && ['queued', 'processing'].includes(j.status),
      );
      if (pending.length === 0 && pollingIds.size > 0) setPollingIds(new Set());
      return d;
    },
  });

  const handleCategoryChange = (val: string) => {
    setCategory(val === '__all__' ? '' : val);
    setSubCategory('');
  };

  const handleDirectDownload = async () => {
    setIsDownloading(true);
    try {
      await exportApi.directDownload({
        format,
        category: category || undefined,
        subCategory: subCategory || undefined,
      });
      toast.success(`${FORMAT_META[format].label} downloaded`);
    } catch (e: any) {
      toast.error(e.response?.data?.message ?? 'Export failed');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleDownloadHistory = async (id: string) => {
    setDownloadingId(id);
    try {
      await exportApi.download(id);
    } catch {
      toast.error('Download failed — the link may have expired');
    } finally {
      setDownloadingId(null);
    }
  };

  const fmt = FORMAT_META[format];
  const Icon = fmt.icon;

  const scopeLabel =
    subCategory
      ? `${category} › ${subCategory}`
      : category
        ? category
        : 'all products';

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">Export</h1>
        <p className="text-muted-foreground text-sm">
          Generate product catalogs — files are streamed directly, nothing saved on the server
        </p>
      </div>

      {/* Format picker */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Export Format</CardTitle>
          <CardDescription>Choose a format, apply filters, then download</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Format cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {(Object.entries(FORMAT_META) as [ExportFormat, typeof fmt][]).map(([key, meta]) => {
              const FIcon = meta.icon;
              return (
                <button
                  key={key}
                  onClick={() => setFormat(key)}
                  className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors ${
                    format === key ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
                  }`}
                >
                  <FIcon
                    className={`h-4 w-4 ${format === key ? 'text-primary' : 'text-muted-foreground'}`}
                  />
                  <span className="text-sm font-medium">{meta.label}</span>
                  <span className="text-xs text-muted-foreground">{meta.desc}</span>
                </button>
              );
            })}
          </div>

          {/* Category + Subcategory filters */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Category</Label>
              <Select value={category || '__all__'} onValueChange={handleCategoryChange}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="All categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All categories</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.name} value={c.name}>
                      {c.name}
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({c.productCount})
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Sub-category</Label>
              <Select
                value={subCategory || '__all__'}
                onValueChange={(v) => setSubCategory(v === '__all__' ? '' : v)}
                disabled={!category || subcategories.length === 0}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="All sub-categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All sub-categories</SelectItem>
                  {subcategories.map((s) => (
                    <SelectItem key={s.name} value={s.name}>
                      {s.name}
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({s.productCount})
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <p className="text-xs text-muted-foreground">
              Exporting <span className="font-medium">{scopeLabel}</span> as{' '}
              <span className="font-medium">{fmt.label}</span>
            </p>
            <Button
              onClick={handleDirectDownload}
              disabled={isDownloading}
              className="gap-2"
            >
              {isDownloading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Generating…
                </>
              ) : (
                <>
                  <Icon className="h-4 w-4" /> Download {fmt.label}
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Export history (legacy async exports) */}
      {(history?.data ?? []).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Export History</CardTitle>
            <CardDescription>Previously queued async exports</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {historyLoading && (
              <p className="p-4 text-sm text-muted-foreground">Loading…</p>
            )}
            <div className="divide-y">
              {history?.data.map((job) => {
                const meta = FORMAT_META[job.format];
                const FIcon = meta?.icon ?? FileText;
                const isReady = job.status === 'completed' && job.fileUrl;
                const isProcessing = ['queued', 'processing'].includes(job.status);
                return (
                  <div
                    key={job._id}
                    className="flex items-center justify-between p-4 text-sm"
                  >
                    <div className="flex items-center gap-3">
                      <FIcon className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="font-medium">{meta?.label ?? job.format}</p>
                        <p className="text-xs text-muted-foreground">
                          {job.rowCount > 0 ? `${job.rowCount} products · ` : ''}
                          {formatDistanceToNow(new Date(job.createdAt), { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge
                        variant={
                          job.status === 'completed'
                            ? 'success'
                            : job.status === 'failed'
                              ? 'destructive'
                              : 'secondary'
                        }
                      >
                        {isProcessing && (
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        )}
                        {job.status}
                      </Badge>
                      {isReady && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1.5"
                          disabled={downloadingId === job._id}
                          onClick={() => handleDownloadHistory(job._id)}
                        >
                          {downloadingId === job._id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Download className="h-3.5 w-3.5" />
                          )}
                          Download
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
