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
import { cn } from '@/lib/utils';

const ALPHABET = ['All', ...Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i))];

function AlphabetBar({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (letter: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-0.5">
      {ALPHABET.map((l) => (
        <button
          key={l}
          onClick={() => onSelect(l === selected ? '' : l)}
          className={cn(
            'h-7 rounded text-xs font-medium transition-colors px-2',
            l === 'All' ? 'min-w-[2.5rem]' : 'w-7',
            selected === l
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

function SellerRow({ seller }: { seller: Seller }) {
  const initials = seller.sellerName
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <Link
      href={`/sellers/${encodeURIComponent(seller.sellerName)}`}
      className="group flex items-center gap-3 rounded-lg border bg-card px-4 py-3 transition hover:border-primary/40 hover:bg-muted/30"
    >
      <div className="h-9 w-9 rounded-md border bg-muted/40 overflow-hidden flex items-center justify-center shrink-0">
        {seller.sellerLogoUrl ? (
          <Image
            src={seller.sellerLogoUrl}
            alt={seller.sellerName}
            width={36}
            height={36}
            unoptimized
            className="object-contain"
          />
        ) : (
          <span className="text-xs font-bold text-muted-foreground">{initials}</span>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">
          {seller.sellerName}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          {seller.businessType && (
            <span className="text-[11px] text-muted-foreground flex items-center gap-0.5 truncate">
              <Building2 className="h-3 w-3 shrink-0" />
              {seller.businessType}
            </span>
          )}
          {(seller.state || seller.country) && (
            <span className="text-[11px] text-muted-foreground flex items-center gap-0.5 truncate">
              <MapPin className="h-3 w-3 shrink-0" />
              {[seller.state, seller.country].filter(Boolean).join(', ')}
            </span>
          )}
        </div>
      </div>

      <Badge variant="secondary" className="text-[10px] shrink-0">
        <Package className="h-2.5 w-2.5 mr-1" />
        {seller.productCount.toLocaleString()}
      </Badge>
    </Link>
  );
}

export default function SellersPage() {
  const searchParams = useSearchParams();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(searchParams.get('search') ?? '');
  const [selectedLetter, setSelectedLetter] = useState('');
  const debouncedSearch = useDebounce(search, 300);

  const { data, isLoading } = useQuery<PaginatedResponse<Seller>>({
    queryKey: ['sellers', page, debouncedSearch, selectedLetter],
    queryFn: () =>
      sellersApi
        .list({
          page,
          limit: 30,
          search: debouncedSearch || undefined,
          letter: selectedLetter && selectedLetter !== 'All'
            ? selectedLetter
            : undefined,
        })
        .then((r) => r.data),
  });

  const sellers = data?.data ?? [];
  const total = data?.meta.total ?? 0;
  const totalPages = data?.meta.pages ?? 1;

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
    setSelectedLetter('');
    setPage(1);
  };

  const handleLetterSelect = (letter: string) => {
    setSelectedLetter(letter);
    setSearch('');
    setPage(1);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" />
            List of Sellers
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {isLoading ? 'Loading…' : `${total.toLocaleString()} sellers`}
            {selectedLetter && selectedLetter !== 'All' && !isLoading && (
              <span className="ml-1 text-xs">
                — starting with <span className="font-semibold text-foreground">{selectedLetter}</span>
              </span>
            )}
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

      {/* Alphabet bar */}
      <AlphabetBar selected={selectedLetter} onSelect={handleLetterSelect} />

      {/* Skeleton */}
      {isLoading && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg border bg-muted/40" />
          ))}
        </div>
      )}

      {/* Empty */}
      {!isLoading && sellers.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-24 text-center">
          <Users className="h-12 w-12 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            {search
              ? `No sellers matching "${search}"`
              : selectedLetter && selectedLetter !== 'All'
                ? `No sellers starting with "${selectedLetter}"`
                : 'No sellers found yet — scrape some seller pages first'}
          </p>
        </div>
      )}

      {/* Grid */}
      {!isLoading && sellers.length > 0 && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {sellers.map((s) => (
            <SellerRow key={s.sellerName} seller={s} />
          ))}
        </div>
      )}

      {/* Pagination */}
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
