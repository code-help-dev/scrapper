'use client';
import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import Image from 'next/image';
import { sellersApi } from '@/lib/api';
import {
  Product,
  CategoryInfo,
  SubcategoryInfo,
  PaginatedResponse,
  Seller,
} from '@/types';
import {
  Flag,
  ImageOff,
  LayoutGrid,
  Package,
  ChevronLeft,
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
    (featured?.thumbnailUrl?.trim() ||
      featured?.storageUrl?.trim() ||
      featured?.originalUrl?.trim()) ||
    null;

  return (
    <Link
      href={`/products/${p._id}`}
      className="group flex flex-col overflow-hidden rounded-xl border bg-card transition hover:shadow-md hover:border-primary/40"
    >
      <div className="relative aspect-square w-full bg-muted/40 flex items-center justify-center overflow-hidden">
        {imgSrc ? (
          <Image
            src={imgSrc}
            alt={p.productName}
            fill
            unoptimized
            className="object-contain p-2 transition group-hover:scale-105"
            sizes="(max-width:768px) 50vw, 180px"
          />
        ) : (
          <ImageOff className="h-8 w-8 text-muted-foreground/40" />
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
        <h3
          className="line-clamp-2 text-xs font-medium leading-snug"
          title={p.productName}
        >
          {p.productName}
        </h3>
        <p className="text-sm font-semibold">
          {p.price != null
            ? `${p.currency} ${p.price.toLocaleString()}`
            : 'Ask Price'}
          {p.moq ? (
            <span className="ml-1 text-[10px] font-normal text-muted-foreground">
              / MOQ {p.moq}
            </span>
          ) : null}
        </p>
        <div className="mt-auto pt-1">
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

const SORT_OPTIONS = [
  { value: 'createdAt:desc', label: 'Newest first' },
  { value: 'createdAt:asc', label: 'Oldest first' },
  { value: 'price:asc', label: 'Price: Low → High' },
  { value: 'price:desc', label: 'Price: High → Low' },
  { value: 'name:asc', label: 'Name A–Z' },
  { value: 'name:desc', label: 'Name Z–A' },
];

export default function SellerDetailPage() {
  const params = useParams();
  const sellerName = decodeURIComponent(params.sellerName as string);

  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedSubcategories, setSelectedSubcategories] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState('desc');

  const { data: seller } = useQuery<Seller>({
    queryKey: ['seller', sellerName],
    queryFn: () => sellersApi.get(sellerName).then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const { data: categories = [] } = useQuery<CategoryInfo[]>({
    queryKey: ['seller-categories', sellerName],
    queryFn: () => sellersApi.categories(sellerName).then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const { data: subcategories = [] } = useQuery<SubcategoryInfo[]>({
    queryKey: ['seller-subcategories', sellerName, selectedCategory],
    queryFn: () =>
      selectedCategory
        ? sellersApi.subcategories(sellerName, selectedCategory).then((r) => r.data)
        : Promise.resolve([]),
    enabled: !!selectedCategory,
    staleTime: 5 * 60 * 1000,
  });

  const { data: productsData, isLoading } = useQuery<PaginatedResponse<Product>>({
    queryKey: [
      'seller-products',
      sellerName,
      selectedCategory,
      selectedSubcategories,
      page,
      sortBy,
      sortOrder,
    ],
    queryFn: () =>
      sellersApi
        .products(sellerName, {
          page,
          limit: 20,
          category: selectedCategory || undefined,
          subCategory: selectedSubcategories.length > 0 ? selectedSubcategories.join(',') : undefined,
          sortBy,
          sortOrder,
        })
        .then((r) => r.data),
  });

  const handleCategorySelect = (name: string) => {
    setSelectedCategory((prev) => (prev === name ? '' : name));
    setSelectedSubcategories([]);
    setPage(1);
  };

  const toggleSubcategory = (name: string) => {
    setSelectedSubcategories((prev) => (prev.includes(name) ? [] : [name]));
    setPage(1);
  };

  const handleSortChange = (value: string) => {
    const [field, order] = value.split(':');
    setSortBy(field);
    setSortOrder(order);
    setPage(1);
  };

  const totalProducts = productsData?.meta.total ?? 0;
  const totalPages = productsData?.meta.pages ?? 1;

  return (
    <div className="flex h-full min-h-0 gap-0 -m-6">
      {}
      <aside className="w-56 shrink-0 border-r bg-background flex flex-col overflow-hidden">
        {}
        <div className="sticky top-0 bg-background border-b px-4 py-3 shrink-0">
          <Link
            href="/sellers"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-2 transition-colors"
          >
            <ChevronLeft className="h-3 w-3" />
            All Sellers
          </Link>
          <div className="flex items-center gap-2">
            <LayoutGrid className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold">Categories</span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1 truncate">
            Seller:{' '}
            <span className="font-bold text-foreground">
              {sellerName.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')}
            </span>
          </p>
        </div>

        {}
        <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
          <button
            onClick={() => handleCategorySelect('')}
            className={cn(
              'w-full text-left px-3 py-2 rounded-md text-sm flex items-center justify-between transition-colors hover:bg-muted/60',
              !selectedCategory && 'bg-primary/10 text-primary font-medium',
            )}
          >
            <span>All Products</span>
            {seller && !selectedCategory && (
              <span className="text-xs text-muted-foreground">
                {seller.productCount?.toLocaleString()}
              </span>
            )}
          </button>

          {categories.map((cat) => (
            <button
              key={cat.name}
              onClick={() => handleCategorySelect(cat.name)}
              className={cn(
                'w-full text-left px-3 py-2 rounded-md text-sm flex items-center justify-between gap-1 transition-colors hover:bg-muted/60',
                selectedCategory === cat.name && 'bg-primary/10 text-primary font-medium',
              )}
            >
              <span className="truncate">{cat.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {cat.productCount.toLocaleString()}
              </span>
            </button>
          ))}

          {categories.length === 0 && (
            <p className="px-3 py-4 text-xs text-muted-foreground">No categories yet</p>
          )}
        </nav>

      </aside>

      {}
      <div className="flex-1 min-w-0 flex flex-col overflow-y-auto">
        <div className="p-6 space-y-4">
          {}
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-xl font-bold">
                {selectedCategory || 'All Products'}
              </h1>
              <p className="text-muted-foreground text-sm">
                {isLoading
                  ? 'Loading…'
                  : `${totalProducts.toLocaleString()} products`}
                {selectedSubcategories.length > 0 &&
                  ` · ${selectedSubcategories.join(', ')}`}
              </p>
            </div>
            <Select
              value={`${sortBy}:${sortOrder}`}
              onValueChange={handleSortChange}
            >
              <SelectTrigger className="w-44 h-8 text-sm">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {}
          {selectedCategory && subcategories.length > 0 && (
            <div className="flex flex-wrap gap-2 pb-1">
              {subcategories.map((sub) => {
                const checked = selectedSubcategories.includes(sub.name);
                return (
                  <button
                    key={sub.name}
                    onClick={() => toggleSubcategory(sub.name)}
                    className={cn(
                      'flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors',
                      checked
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background hover:bg-muted/60',
                    )}
                  >
                    <span
                      className={cn(
                        'h-3.5 w-3.5 rounded-sm border flex items-center justify-center shrink-0',
                        checked
                          ? 'bg-primary-foreground border-primary-foreground'
                          : 'border-current',
                      )}
                    >
                      {checked && (
                        <svg
                          className="h-2.5 w-2.5 text-primary"
                          viewBox="0 0 10 10"
                          fill="none"
                        >
                          <path
                            d="M1.5 5l2.5 2.5 4.5-4.5"
                            stroke="currentColor"
                            strokeWidth={1.5}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </span>
                    {sub.name}
                    <span className="opacity-60">{sub.productCount}</span>
                  </button>
                );
              })}
            </div>
          )}

          {}
          {isLoading && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {Array.from({ length: 20 }).map((_, i) => (
                <div
                  key={i}
                  className="h-52 animate-pulse rounded-xl border bg-muted/40"
                />
              ))}
            </div>
          )}

          {}
          {!isLoading && productsData?.data.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed py-20 text-center">
              <Package className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                {selectedCategory
                  ? 'No products in this category'
                  : 'No products found for this seller'}
              </p>
            </div>
          )}

          {}
          {!isLoading && productsData && productsData.data.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {productsData.data.map((p) => (
                <ProductCard key={p._id} p={p} />
              ))}
            </div>
          )}

          {}
          {productsData && totalPages > 1 && (
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
