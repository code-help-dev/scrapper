'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { sellersApi } from '@/lib/api';
import { Seller, PaginatedResponse } from '@/types';
import { Building2, MapPin, Package, Search, Users } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { SmartPagination } from '@/components/ui/smart-pagination';
import { Badge } from '@/components/ui/badge';
import { useDebounce } from '@/lib/hooks/use-debounce';

function SellerCard({ seller }: { seller: Seller }) {
  const initials = seller.sellerName
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <Link
      href={`/sellers/${encodeURIComponent(seller.sellerName)}`}
      className="group flex flex-col gap-3 rounded-xl border bg-card p-4 transition hover:shadow-md hover:border-primary/40"
    >
      {}
      <div className="flex items-start justify-between gap-2">
        <div className="h-12 w-12 rounded-lg border bg-muted/40 overflow-hidden flex items-center justify-center shrink-0">
          {seller.sellerLogoUrl ? (
            <Image
              src={seller.sellerLogoUrl}
              alt={seller.sellerName}
              width={48}
              height={48}
              unoptimized
              className="object-contain"
            />
          ) : (
            <span className="text-sm font-bold text-muted-foreground">{initials}</span>
          )}
        </div>
        <Badge variant="secondary" className="text-[10px] shrink-0">
          <Package className="h-2.5 w-2.5 mr-1" />
          {seller.productCount.toLocaleString()} products
        </Badge>
      </div>

      {}
      <div>
        <h3 className="font-semibold text-sm leading-snug group-hover:text-primary transition-colors line-clamp-2">
          {seller.sellerName}
        </h3>
        {seller.businessType && (
          <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
            <Building2 className="h-3 w-3" />
            {seller.businessType}
          </p>
        )}
      </div>

      {}
      {(seller.state || seller.country) && (
        <p className="text-[11px] text-muted-foreground flex items-center gap-1">
          <MapPin className="h-3 w-3 shrink-0" />
          {[seller.state, seller.country].filter(Boolean).join(', ')}
        </p>
      )}
    </Link>
  );
}

export default function SellersPage() {
  const searchParams = useSearchParams();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(searchParams.get('search') ?? '');
  const debouncedSearch = useDebounce(search, 300);

  const { data, isLoading } = useQuery<PaginatedResponse<Seller>>({
    queryKey: ['sellers', page, debouncedSearch],
    queryFn: () =>
      sellersApi
        .list({ page, limit: 24, search: debouncedSearch || undefined })
        .then((r) => r.data),
  });

  const sellers = data?.data ?? [];
  const total = data?.meta.total ?? 0;
  const totalPages = data?.meta.pages ?? 1;

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
    setPage(1);
  };

  return (
    <div className="space-y-6">
      {}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" />
            List of Sellers
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {isLoading ? 'Loading…' : `${total.toLocaleString()} sellers`}
          </p>
        </div>
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search sellers…"
            value={search}
            onChange={handleSearch}
            className="pl-9 h-9"
          />
        </div>
      </div>

      {}
      {isLoading && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="h-40 animate-pulse rounded-xl border bg-muted/40" />
          ))}
        </div>
      )}

      {}
      {!isLoading && sellers.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-24 text-center">
          <Users className="h-12 w-12 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            {search ? `No sellers matching "${search}"` : 'No sellers found yet — scrape some seller pages first'}
          </p>
        </div>
      )}

      {}
      {!isLoading && sellers.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {sellers.map((s) => (
            <SellerCard key={s.sellerName} seller={s} />
          ))}
        </div>
      )}

      {}
      {totalPages > 1 && (
        <SmartPagination
          currentPage={page}
          totalPages={totalPages}
          totalItems={total}
          onPageChange={setPage}
          className="border-t pt-4"
        />
      )}
    </div>
  );
}
