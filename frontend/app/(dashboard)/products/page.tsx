'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import Image from 'next/image';
import { productsApi } from '@/lib/api';
import {
  Product,
  CategoryInfo,
  SubcategoryInfo,
  PaginatedResponse,
} from '@/types';
import {
  Flag,
  ImageOff,
  Package,
  LayoutGrid,
  X,
  SlidersHorizontal,
} from 'lucide-react';
import { SmartPagination } from '@/components/ui/smart-pagination';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

function ProductCard({ p }: { p: Product }) {
  const featured = p.images?.find((i) => i.isFeatured) ?? p.images?.[0];
  const imgSrc =
    (featured?.thumbnailUrl?.trim() || featured?.storageUrl?.trim() || featured?.originalUrl?.trim()) || null;

  return (
    <Link
      href={`/products/${p._id}`}
      className="group flex flex-col overflow-hidden rounded-lg border bg-card transition hover:shadow-md hover:border-primary/40"
    >
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
      </div>

      <div className="flex flex-1 flex-col gap-1 p-2.5">
        <h3 className="line-clamp-2 text-xs font-medium leading-snug" title={p.productName}>
          {p.productName}
        </h3>
        <p className="text-sm font-semibold">
          {p.price != null ? `${p.currency} ${p.price.toLocaleString()}` : 'Ask Price'}
          {p.moq ? (
            <span className="ml-1 text-[10px] font-normal text-muted-foreground">
              / MOQ {p.moq}
            </span>
          ) : null}
        </p>
        {p.seller?.sellerName && (
          <p className="truncate text-[10px] text-muted-foreground">{p.seller.sellerName}</p>
        )}
        <div className="mt-auto flex items-center justify-between pt-1">
          <Badge
            variant={p.confidenceScore >= 70 ? 'success' : 'warning'}
            className="text-[10px] px-1.5 py-0"
          >
            {p.confidenceScore}%
          </Badge>
        </div>
      </div>
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

export default function ProductsPage() {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedSubcategory, setSelectedSubcategory] = useState<string>('');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState('desc');
  const [mobileCatOpen, setMobileCatOpen] = useState(false);

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
    queryKey: ['products', page, limit, selectedCategory, selectedSubcategory, sortBy, sortOrder],
    queryFn: () =>
      productsApi
        .list({
          page,
          limit,
          category: selectedCategory || undefined,
          subCategory: selectedSubcategory || undefined,
          sortBy,
          sortOrder,
        })
        .then((r) => r.data),
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

  const totalProducts = data?.meta.total ?? 0;
  const totalPages = data?.meta.pages ?? 1;

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
              <h1 className="text-xl font-bold">
                {selectedCategory || 'All Products'}
              </h1>
              <p className="text-muted-foreground text-sm">
                {isLoading ? 'Loading…' : `${totalProducts.toLocaleString()} products`}
                {selectedSubcategory ? ` · ${selectedSubcategory}` : ''}
              </p>
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
              <Select
                value={`${sortBy}:${sortOrder}`}
                onValueChange={handleSortChange}
              >
                <SelectTrigger className="w-36 h-8 text-sm">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="createdAt:desc">Newest first</SelectItem>
                  <SelectItem value="createdAt:asc">Oldest first</SelectItem>
                  <SelectItem value="price:asc">Price: Low to High</SelectItem>
                  <SelectItem value="price:desc">Price: High to Low</SelectItem>
                  <SelectItem value="name:asc">Name A–Z</SelectItem>
                  <SelectItem value="name:desc">Name Z–A</SelectItem>
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
                {selectedCategory
                  ? 'No products found in this category'
                  : 'No products yet — submit a category URL to start scraping'}
              </p>
            </div>
          )}

          {/* Product grid */}
          {!isLoading && data && data.data.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {data.data.map((p) => (
                <ProductCard key={p._id} p={p} />
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
    </div>
  );
}
