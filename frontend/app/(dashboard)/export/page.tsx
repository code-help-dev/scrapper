'use client';
import { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { exportApi, productsApi, sellersApi } from '@/lib/api';
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
  Search,
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
import { useDebounce } from '@/hooks/useDebounce';

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

function DropdownSearch({
  value,
  onChange,
  placeholder,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  inputRef: React.RefObject<HTMLInputElement>;
}) {
  return (
    <div className="flex items-center gap-1.5 border-b px-2 py-1.5">
      <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <input
        ref={inputRef}
        className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        
        onKeyDown={(e) => e.stopPropagation()}
      />
    </div>
  );
}

export default function ExportPage() {
  const qc = useQueryClient();
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [category, setCategory] = useState('');
  const [subCategory, setSubCategory] = useState('');
  const [seller, setSeller] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);
  const [pollingIds, setPollingIds] = useState<Set<string>>(new Set());
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const [sellerSearch, setSellerSearch] = useState('');
  const [categorySearch, setCategorySearch] = useState('');
  const [subCategorySearch, setSubCategorySearch] = useState('');

  const debouncedSellerSearch = useDebounce(sellerSearch, 300);
  
  const debouncedCategorySearch = useDebounce(categorySearch, 150);
  const debouncedSubCategorySearch = useDebounce(subCategorySearch, 150);

  const sellerSearchRef = useRef<HTMLInputElement>(null);
  const categorySearchRef = useRef<HTMLInputElement>(null);
  const subCategorySearchRef = useRef<HTMLInputElement>(null);

  const [sellerOpen, setSellerOpen] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [subCategoryOpen, setSubCategoryOpen] = useState(false);

  useEffect(() => {
    if (sellerOpen) setTimeout(() => sellerSearchRef.current?.focus(), 30);
    else setSellerSearch('');
  }, [sellerOpen]);

  useEffect(() => {
    if (categoryOpen) setTimeout(() => categorySearchRef.current?.focus(), 30);
    else setCategorySearch('');
  }, [categoryOpen]);

  useEffect(() => {
    if (subCategoryOpen) setTimeout(() => subCategorySearchRef.current?.focus(), 30);
    else setSubCategorySearch('');
  }, [subCategoryOpen]);

  const { data: sellersData } = useQuery<{ data: { sellerName: string }[]; total: number }>({
    queryKey: ['export-sellers', debouncedSellerSearch],
    queryFn: () =>
      sellersApi
        .list({ search: debouncedSellerSearch || undefined, limit: 200 })
        .then((r) => r.data),
    staleTime: 2 * 60 * 1000,
  });
  const sellers = sellersData?.data ?? [];

  const { data: categories = [] } = useQuery<CategoryInfo[]>({
    queryKey: ['export-categories'],
    queryFn: () => productsApi.categories().then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const filteredCategories = useMemo(
    () =>
      debouncedCategorySearch
        ? categories.filter((c) =>
            c.name.toLowerCase().includes(debouncedCategorySearch.toLowerCase()),
          )
        : categories,
    [categories, debouncedCategorySearch],
  );

  const { data: subcategories = [] } = useQuery<SubcategoryInfo[]>({
    queryKey: ['export-subcategories'],
    queryFn: () => productsApi.subcategories().then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const filteredSubcategories = useMemo(
    () =>
      debouncedSubCategorySearch
        ? subcategories.filter((s) =>
            s.name.toLowerCase().includes(debouncedSubCategorySearch.toLowerCase()),
          )
        : subcategories,
    [subcategories, debouncedSubCategorySearch],
  );

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

  const handleDirectDownload = async () => {
    setIsDownloading(true);
    try {
      await exportApi.directDownload({
        format,
        category: category || undefined,
        subCategory: subCategory || undefined,
        seller: seller || undefined,
      });
      toast.success(`${FORMAT_META[format].label} downloaded`);
    } catch (e: any) {
      const msg = e.response?.data?.message;
      toast.error(Array.isArray(msg) ? msg.join(', ') : (msg ?? 'Export failed'));
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

  const scopeLabel = [
    seller || null,
    subCategory ? `${category} › ${subCategory}` : category || null,
  ]
    .filter(Boolean)
    .join(', ') || 'all products';

  return (
    <div className="space-y-4 sm:space-y-6 max-w-2xl w-full">
      <div>
        <h1 className="text-2xl font-bold">Export</h1>
        <p className="text-muted-foreground text-sm">
          Generate product catalogs — files are streamed directly, nothing saved on the server
        </p>
      </div>

      {}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Export Format</CardTitle>
          <CardDescription>Choose a format, apply filters, then download</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {}
          <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-3 gap-2">
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

          {}
          <div className="grid grid-cols-2 gap-3">

            {}
            <div className="space-y-1.5 col-span-2">
              <Label className="text-xs">Seller</Label>
              <Select
                open={sellerOpen}
                onOpenChange={setSellerOpen}
                value={seller || '__all__'}
                onValueChange={(v) => { setSeller(v === '__all__' ? '' : v); setSellerOpen(false); }}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="All sellers" />
                </SelectTrigger>
                <SelectContent>
                  <DropdownSearch
                    value={sellerSearch}
                    onChange={setSellerSearch}
                    placeholder="Search sellers…"
                    inputRef={sellerSearchRef}
                  />
                  <SelectItem value="__all__">All sellers</SelectItem>
                  {sellers.map((s) => (
                    <SelectItem key={s.sellerName} value={s.sellerName}>
                      {s.sellerName}
                    </SelectItem>
                  ))}
                  {sellers.length === 0 && debouncedSellerSearch && (
                    <div className="py-4 text-center text-xs text-muted-foreground">
                      No sellers found
                    </div>
                  )}
                </SelectContent>
              </Select>
            </div>

            {}
            <div className="space-y-1.5">
              <Label className="text-xs">Category</Label>
              <Select
                open={categoryOpen}
                onOpenChange={setCategoryOpen}
                value={category || '__all__'}
                onValueChange={(v) => { setCategory(v === '__all__' ? '' : v); setCategoryOpen(false); }}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="All categories" />
                </SelectTrigger>
                <SelectContent>
                  <DropdownSearch
                    value={categorySearch}
                    onChange={setCategorySearch}
                    placeholder="Search categories…"
                    inputRef={categorySearchRef}
                  />
                  <SelectItem value="__all__">All categories</SelectItem>
                  {filteredCategories.map((c) => (
                    <SelectItem key={c.name} value={c.name}>
                      {c.name}
                      <span className="ml-1 text-xs text-muted-foreground">({c.productCount})</span>
                    </SelectItem>
                  ))}
                  {filteredCategories.length === 0 && debouncedCategorySearch && (
                    <div className="py-4 text-center text-xs text-muted-foreground">
                      No categories found
                    </div>
                  )}
                </SelectContent>
              </Select>
            </div>

            {}
            <div className="space-y-1.5">
              <Label className="text-xs">Sub-category</Label>
              <Select
                open={subCategoryOpen}
                onOpenChange={setSubCategoryOpen}
                value={subCategory || '__all__'}
                onValueChange={(v) => { setSubCategory(v === '__all__' ? '' : v); setSubCategoryOpen(false); }}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="All sub-categories" />
                </SelectTrigger>
                <SelectContent>
                  <DropdownSearch
                    value={subCategorySearch}
                    onChange={setSubCategorySearch}
                    placeholder="Search sub-categories…"
                    inputRef={subCategorySearchRef}
                  />
                  <SelectItem value="__all__">All sub-categories</SelectItem>
                  {filteredSubcategories.map((s) => (
                    <SelectItem key={s.name} value={s.name}>
                      {s.name}
                      <span className="ml-1 text-xs text-muted-foreground">({s.productCount})</span>
                    </SelectItem>
                  ))}
                  {filteredSubcategories.length === 0 && debouncedSubCategorySearch && (
                    <div className="py-4 text-center text-xs text-muted-foreground">
                      No sub-categories found
                    </div>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <p className="text-xs text-muted-foreground">
              Exporting <span className="font-medium">{scopeLabel}</span> as{' '}
              <span className="font-medium">{fmt.label}</span>
            </p>
            <Button onClick={handleDirectDownload} disabled={isDownloading} className="gap-2">
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

      {}
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
                  <div key={job._id} className="flex items-center justify-between p-4 text-sm">
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
                        {isProcessing && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
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
