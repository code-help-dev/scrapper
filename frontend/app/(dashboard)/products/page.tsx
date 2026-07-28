'use client';
import { useState, Suspense } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import Image from 'next/image';
import { useSearchParams, useRouter } from 'next/navigation';
import { productsApi } from '@/lib/api';
import {
  Product,
  CategoryInfo,
  SubcategoryInfo,
  PaginatedResponse,
  BulkActionResult,
} from '@/types';
import { toast } from 'sonner';
import {
  Flag,
  ImageOff,
  Package,
  LayoutGrid,
  X,
  SlidersHorizontal,
  CheckSquare,
  Trash2,
  Loader2,
  Search,
} from 'lucide-react';
import { SmartPagination } from '@/components/ui/smart-pagination';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { cn } from '@/lib/utils';

const CONFIDENCE_PRESETS = [
  { label: '0–20', min: 0, max: 20 },
  { label: '20–40', min: 20, max: 40 },
  { label: '40–60', min: 40, max: 60 },
  { label: '60–80', min: 60, max: 80 },
  { label: '80–100', min: 80, max: 100 },
];

function confidenceBarColor(score: number) {
  if (score >= 70) return 'bg-green-500';
  if (score >= 40) return 'bg-yellow-500';
  return 'bg-red-500';
}

function ProductCard({
  p,
  selectMode,
  selected,
  onToggle,
}: {
  p: Product;
  selectMode: boolean;
  selected: boolean;
  onToggle: (id: string, checked: boolean) => void;
}) {
  const featured = p.images?.find((i) => i.isFeatured) ?? p.images?.[0];
  const imgSrc =
    (featured?.thumbnailUrl?.trim() || featured?.storageUrl?.trim() || featured?.originalUrl?.trim()) || null;

  const cardBody = (
    <>
      <div className="relative aspect-square w-full bg-muted/40 flex items-center justify-center overflow-hidden">
        {imgSrc ? (
          <Image
            src={imgSrc}
            alt={p.productName}
            fill
            unoptimized
            className="object-contain p-2 transition group-hover:scale-105"
            sizes="(max-width:768px) 50vw, 200px"
          />
        ) : (
          <ImageOff className="h-10 w-10 text-muted-foreground/40" />
        )}
        {p.isFlagged && (
          <span className="absolute left-2 top-2">
            <Badge variant="warning" className="gap-1 text-[10px] px-1.5 py-0.5">
              <Flag className="h-2.5 w-2.5" /> Flagged
            </Badge>
          </span>
        )}
        {selectMode && (
          <span
            className="absolute right-2 top-2 rounded bg-background/90 p-1 shadow"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
          >
            <Checkbox
              checked={selected}
              onCheckedChange={(c) => onToggle(p._id, c === true)}
              aria-label={`Select ${p.productName}`}
            />
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-2.5">
        <h3 className="line-clamp-2 text-xs font-medium leading-snug" title={p.productName}>
          {p.productName}
        </h3>
        <p className="text-sm font-semibold">
          {p.price != null ? `${p.currency} ${p.price.toLocaleString()}` : 'Ask Price'}
          {p.price != null && p.priceUnit && (
            <span className="ml-1 text-[10px] font-normal text-muted-foreground">/ {p.priceUnit}</span>
          )}
          {p.moq ? (
            <span className="ml-1 text-[10px] font-normal text-muted-foreground">
              MOQ {p.moq}
            </span>
          ) : null}
        </p>
        {p.seller?.sellerName && (
          <p className="truncate text-[10px] text-muted-foreground">{p.seller.sellerName}</p>
        )}
        <div className="mt-auto flex flex-col gap-1 pt-1">
          <div className="flex items-center justify-between">
            <Badge
              variant={p.confidenceScore >= 70 ? 'success' : 'warning'}
              className="text-[10px] px-1.5 py-0"
            >
              {p.confidenceScore}%
            </Badge>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn('h-full rounded-full', confidenceBarColor(p.confidenceScore))}
              style={{ width: `${Math.max(0, Math.min(100, p.confidenceScore))}%` }}
            />
          </div>
        </div>
      </div>
    </>
  );

  const className = 'group flex flex-col overflow-hidden rounded-lg border bg-card transition hover:shadow-md hover:border-primary/40';

  if (selectMode) {
    return (
      <div
        className={cn(className, 'cursor-pointer', selected && 'ring-2 ring-primary border-primary/40')}
        onClick={() => onToggle(p._id, !selected)}
      >
        {cardBody}
      </div>
    );
  }

  return (
    <Link href={`/products/${p._id}`} className={className}>
      {cardBody}
    </Link>
  );
}

function CategoryNav({
  categories,
  selectedCategory,
  totalProducts,
  onSelect,
}: {
  categories: CategoryInfo[];
  selectedCategory: string;
  totalProducts: number;
  onSelect: (name: string) => void;
}) {
  return (
    <nav className="p-2 space-y-0.5">
      <button
        onClick={() => onSelect('')}
        className={cn(
          'w-full text-left px-3 py-2 rounded-md text-sm flex items-center justify-between transition-colors hover:bg-muted/60',
          !selectedCategory && 'bg-primary/10 text-primary font-medium',
        )}
      >
        <span>All Categories</span>
        {totalProducts > 0 && !selectedCategory && (
          <span className="text-xs text-muted-foreground">{totalProducts.toLocaleString()}</span>
        )}
      </button>
      {categories.map((cat) => (
        <button
          key={cat.name}
          onClick={() => onSelect(cat.name)}
          className={cn(
            'w-full text-left px-3 py-2 rounded-md text-sm flex items-center justify-between transition-colors hover:bg-muted/60',
            selectedCategory === cat.name && 'bg-primary/10 text-primary font-medium',
          )}
        >
          <span className="truncate">{cat.name}</span>
          <span className="ml-1 shrink-0 text-xs text-muted-foreground">
            {cat.productCount.toLocaleString()}
          </span>
        </button>
      ))}
      {categories.length === 0 && (
        <p className="px-3 py-4 text-xs text-muted-foreground">No categories yet</p>
      )}
    </nav>
  );
}

const ITEMS_PER_PAGE_OPTIONS = [10, 20, 50];

type PendingDelete =
  | { mode: 'selected'; ids: string[] }
  | { mode: 'all-flagged' };

function ProductsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedSubcategory, setSelectedSubcategory] = useState<string>('');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState('desc');
  const [mobileCatOpen, setMobileCatOpen] = useState(false);

  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const [minConfidenceInput, setMinConfidenceInput] = useState('');
  const [maxConfidenceInput, setMaxConfidenceInput] = useState('');
  const [minConfidence, setMinConfidence] = useState<number | undefined>(undefined);
  const [maxConfidence, setMaxConfidence] = useState<number | undefined>(undefined);

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

  const showFlagged = searchParams.get('flagged') === 'true';

  const clearFlaggedFilter = () => {
    router.push('/products');
    setPage(1);
  };

  const { data: categories = [] } = useQuery<CategoryInfo[]>({
    queryKey: ['product-categories'],
    queryFn: () => productsApi.categories().then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const { data: subcategories = [] } = useQuery<SubcategoryInfo[]>({
    queryKey: ['product-subcategories', selectedCategory],
    queryFn: () =>
      selectedCategory
        ? productsApi.subcategories(selectedCategory).then((r) => r.data)
        : Promise.resolve([]),
    enabled: !!selectedCategory,
    staleTime: 5 * 60 * 1000,
  });

  const { data, isLoading } = useQuery<PaginatedResponse<Product>>({
    queryKey: ['products', page, limit, selectedCategory, selectedSubcategory, sortBy, sortOrder, showFlagged, minConfidence, maxConfidence, search],
    queryFn: () =>
      productsApi
        .list({
          page,
          limit,
          category: selectedCategory || undefined,
          subCategory: selectedSubcategory || undefined,
          search: search || undefined,
          sortBy,
          sortOrder,
          flagged: showFlagged || undefined,
          minConfidence,
          maxConfidence,
        })
        .then((r) => r.data),
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput.trim());
    setPage(1);
  };

  const bulkDeleteMutation = useMutation({
    mutationFn: (payload: Parameters<typeof productsApi.bulkDelete>[0]) => productsApi.bulkDelete(payload),
    onSuccess: (res) => {
      const result = res.data as BulkActionResult;
      const deleted = result.deleted ?? 0;
      if (result.failed.length > 0) {
        toast.warning(`${deleted} of ${result.requested} product(s) deleted — ${result.failed.length} failed`);
      } else {
        toast.success(`${deleted} of ${result.requested} product(s) deleted`);
      }
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['product-categories'] });
      setSelectedIds(new Set());
      setSelectMode(false);
    },
    onError: (e: any) => toast.error(e.response?.data?.message ?? 'Bulk delete failed'),
    onSettled: () => setPendingDelete(null),
  });

  const handleCategorySelect = (name: string) => {
    setSelectedCategory((prev) => (prev === name ? '' : name));
    setSelectedSubcategory('');
    setPage(1);
  };

  const handleSubcategorySelect = (name: string) => {
    setSelectedSubcategory((prev) => (prev === name ? '' : name));
    setPage(1);
  };

  const handleSortChange = (value: string) => {
    const [field, order] = value.split(':');
    setSortBy(field);
    setSortOrder(order);
    setPage(1);
  };

  const handleLimitChange = (value: string) => {
    setLimit(Number(value));
    setPage(1);
  };

  const applyConfidenceRange = () => {
    const min = minConfidenceInput.trim() === '' ? undefined : Number(minConfidenceInput);
    const max = maxConfidenceInput.trim() === '' ? undefined : Number(maxConfidenceInput);
    setMinConfidence(min !== undefined && !Number.isNaN(min) ? min : undefined);
    setMaxConfidence(max !== undefined && !Number.isNaN(max) ? max : undefined);
    setPage(1);
  };

  const applyPreset = (min: number, max: number) => {
    setMinConfidenceInput(String(min));
    setMaxConfidenceInput(String(max));
    setMinConfidence(min);
    setMaxConfidence(max);
    setPage(1);
  };

  const clearConfidenceRange = () => {
    setMinConfidenceInput('');
    setMaxConfidenceInput('');
    setMinConfidence(undefined);
    setMaxConfidence(undefined);
    setPage(1);
  };

  const confidenceActive = minConfidence !== undefined || maxConfidence !== undefined;

  const toggleSelect = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const pageIds = data?.data.map((p) => p._id) ?? [];
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));

  const toggleSelectAllOnPage = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        pageIds.forEach((id) => next.delete(id));
      } else {
        pageIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const totalProducts = data?.meta.total ?? 0;
  const totalPages = data?.meta.pages ?? 1;

  const confirmDeleteDescription = () => {
    if (!pendingDelete) return '';
    if (pendingDelete.mode === 'selected') {
      return `This will permanently delete ${pendingDelete.ids.length} product(s), including their stored images. This cannot be undone.`;
    }
    return `This will permanently delete all ${totalProducts.toLocaleString()} flagged product(s) currently matching your filters, including their stored images. This cannot be undone.`;
  };

  const runDelete = () => {
    if (!pendingDelete) return;
    if (pendingDelete.mode === 'selected') {
      bulkDeleteMutation.mutate({ productIds: pendingDelete.ids, confirm: true });
    } else {
      bulkDeleteMutation.mutate({
        filter: {
          flagged: true,
          category: selectedCategory || undefined,
          subCategory: selectedSubcategory || undefined,
        },
        confirm: true,
      });
    }
  };

  return (
    <div className="flex h-full min-h-0 gap-0 -m-6">
      {/* Mobile categories overlay */}
      {mobileCatOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileCatOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col border-r bg-background shadow-xl">
            <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
              <div className="flex items-center gap-2">
                <LayoutGrid className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold">Categories</span>
              </div>
              <button
                onClick={() => setMobileCatOpen(false)}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                aria-label="Close categories"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <CategoryNav
                categories={categories}
                selectedCategory={selectedCategory}
                totalProducts={totalProducts}
                onSelect={(name) => { handleCategorySelect(name); setMobileCatOpen(false); }}
              />
            </div>
          </aside>
        </div>
      )}

      {/* Desktop categories sidebar */}
      <aside className="hidden md:block w-52 shrink-0 border-r bg-background overflow-y-auto">
        <div className="sticky top-0 bg-background border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <LayoutGrid className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold">Categories</span>
          </div>
        </div>
        <CategoryNav
          categories={categories}
          selectedCategory={selectedCategory}
          totalProducts={totalProducts}
          onSelect={handleCategorySelect}
        />
      </aside>

      {/* Main content */}
      <div className="flex-1 min-w-0 flex flex-col overflow-y-auto">
        <div className="p-4 sm:p-6 space-y-4">

          {/* Header row */}
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2">
                {showFlagged
                  ? <><Flag className="h-5 w-5 text-yellow-600" /> Flagged Products</>
                  : (selectedCategory || 'All Products')}
              </h1>
              <p className="text-muted-foreground text-sm">
                {isLoading ? 'Loading…' : `${totalProducts.toLocaleString()} products`}
                {selectedSubcategory ? ` · ${selectedSubcategory}` : ''}
              </p>
              {showFlagged && (
                <button
                  onClick={clearFlaggedFilter}
                  className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-800 hover:bg-yellow-200 transition-colors dark:bg-yellow-900/30 dark:text-yellow-400"
                >
                  <Flag className="h-3 w-3" /> Confidence &lt; 70% <X className="h-3 w-3 ml-0.5" />
                </button>
              )}
              {/* Mobile categories trigger */}
              <button
                onClick={() => setMobileCatOpen(true)}
                className="md:hidden mt-2 inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/50 transition-colors"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                {selectedCategory ? selectedCategory : 'All Categories'}
              </button>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <form onSubmit={handleSearch} className="flex gap-1">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search by product name…"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    className="pl-8 h-8 w-48 text-sm"
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
              {selectMode ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8"
                    disabled={pageIds.length === 0}
                    onClick={toggleSelectAllOnPage}
                  >
                    <CheckSquare className="h-3.5 w-3.5 mr-1.5" />
                    {allOnPageSelected ? 'Deselect all' : 'Select all'}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8" onClick={exitSelectMode}>
                    <X className="h-3.5 w-3.5 mr-1.5" /> Cancel select
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="outline" className="h-8" onClick={() => setSelectMode(true)}>
                  <CheckSquare className="h-3.5 w-3.5 mr-1.5" /> Select
                </Button>
              )}
              {showFlagged && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-destructive"
                  disabled={totalProducts === 0}
                  onClick={() => setPendingDelete({ mode: 'all-flagged' })}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete all flagged
                </Button>
              )}
              <Select
                value={`${sortBy}:${sortOrder}`}
                onValueChange={handleSortChange}
              >
                <SelectTrigger className="w-40 h-8 text-sm">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="createdAt:desc">Newest first</SelectItem>
                  <SelectItem value="createdAt:asc">Oldest first</SelectItem>
                  <SelectItem value="price:asc">Price: Low to High</SelectItem>
                  <SelectItem value="price:desc">Price: High to Low</SelectItem>
                  <SelectItem value="name:asc">Name A–Z</SelectItem>
                  <SelectItem value="name:desc">Name Z–A</SelectItem>
                  <SelectItem value="confidence:asc">Confidence: Low to High</SelectItem>
                  <SelectItem value="confidence:desc">Confidence: High to Low</SelectItem>
                </SelectContent>
              </Select>
              <Select value={String(limit)} onValueChange={handleLimitChange}>
                <SelectTrigger className="w-24 h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ITEMS_PER_PAGE_OPTIONS.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n} / page
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Confidence range filter */}
          <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/20 px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground shrink-0">Confidence score:</span>
            <div className="flex flex-wrap gap-1.5">
              {CONFIDENCE_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => applyPreset(preset.min, preset.max)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-muted/60',
                    minConfidence === preset.min && maxConfidence === preset.max
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background',
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <Input
                type="number"
                min={0}
                max={100}
                placeholder="Min"
                value={minConfidenceInput}
                onChange={(e) => setMinConfidenceInput(e.target.value)}
                className="h-7 w-16 text-xs"
              />
              <span className="text-xs text-muted-foreground">–</span>
              <Input
                type="number"
                min={0}
                max={100}
                placeholder="Max"
                value={maxConfidenceInput}
                onChange={(e) => setMaxConfidenceInput(e.target.value)}
                className="h-7 w-16 text-xs"
              />
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={applyConfidenceRange}>
                Apply
              </Button>
              {confidenceActive && (
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={clearConfidenceRange}>
                  Clear
                </Button>
              )}
            </div>
          </div>

          {/* Subcategory chips */}
          {selectedCategory && subcategories.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => handleSubcategorySelect('')}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs transition-colors hover:bg-muted/60',
                  !selectedSubcategory
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background',
                )}
              >
                All
              </button>
              {subcategories.map((sub) => (
                <button
                  key={sub.name}
                  onClick={() => handleSubcategorySelect(sub.name)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs transition-colors hover:bg-muted/60',
                    selectedSubcategory === sub.name
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background',
                  )}
                >
                  {sub.name}
                  <span className="ml-1 text-[10px] opacity-70">
                    {sub.productCount}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Loading skeleton */}
          {isLoading && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {Array.from({ length: limit }).map((_, i) => (
                <div key={i} className="h-56 animate-pulse rounded-lg border bg-muted/40" />
              ))}
            </div>
          )}

          {/* Empty state */}
          {!isLoading && data?.data.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-20 text-center">
              <Package className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                {search
                  ? `No products matching "${search}"`
                  : showFlagged
                  ? 'No flagged products — all extractions are above 70% confidence'
                  : confidenceActive
                  ? 'No products in this confidence range'
                  : selectedCategory
                  ? 'No products found in this category'
                  : 'No products yet — submit a category URL to start scraping'}
              </p>
            </div>
          )}

          {/* Product grid */}
          {!isLoading && data && data.data.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {data.data.map((p) => (
                <ProductCard
                  key={p._id}
                  p={p}
                  selectMode={selectMode}
                  selected={selectedIds.has(p._id)}
                  onToggle={toggleSelect}
                />
              ))}
            </div>
          )}

          {/* Pagination */}
          {data && totalPages > 1 && (
            <SmartPagination
              currentPage={page}
              totalPages={totalPages}
              totalItems={totalProducts}
              onPageChange={setPage}
              className="border-t pt-4"
            />
          )}
        </div>
      </div>

      {/* Selection action bar */}
      {selectMode && selectedIds.size > 0 && (
        <div className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border bg-background px-4 py-2 shadow-lg">
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <Button
            size="sm"
            variant="destructive"
            className="h-8"
            onClick={() => setPendingDelete({ mode: 'selected', ids: Array.from(selectedIds) })}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete selected
          </Button>
        </div>
      )}

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingDelete?.mode === 'selected' ? 'Delete selected products?' : 'Delete all flagged products?'}
            </AlertDialogTitle>
            <AlertDialogDescription>{confirmDeleteDescription()}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDeleteMutation.isPending}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={bulkDeleteMutation.isPending}
              onClick={(e) => { e.preventDefault(); runDelete(); }}
            >
              {bulkDeleteMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function ProductsPage() {
  return (
    <Suspense>
      <ProductsContent />
    </Suspense>
  );
}
