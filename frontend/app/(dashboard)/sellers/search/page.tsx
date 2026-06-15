'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export default function SellerSearchPage() {
  const router = useRouter();
  const [query, setQuery] = useState('');

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      router.push(`/sellers?search=${encodeURIComponent(query.trim())}`);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center gap-6 py-24">
      <div className="text-center">
        <h1 className="text-2xl font-bold">Search Sellers</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Find a seller by name to view their products and categories
        </p>
      </div>
      <form onSubmit={handleSearch} className="flex w-full max-w-md gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Seller name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
            autoFocus
          />
        </div>
        <Button type="submit" disabled={!query.trim()}>
          Search
        </Button>
      </form>
    </div>
  );
}
