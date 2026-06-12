'use client';
import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

function getPageRange(currentPage: number, totalPages: number): (number | 'ellipsis')[] {
  if (totalPages <= 9) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const pages = new Set<number>();
  [1, 2, 3].forEach((p) => { if (p <= totalPages) pages.add(p); });
  [totalPages - 2, totalPages - 1, totalPages].forEach((p) => { if (p >= 1) pages.add(p); });
  [currentPage - 1, currentPage, currentPage + 1].forEach((p) => {
    if (p >= 1 && p <= totalPages) pages.add(p);
  });

  const sorted = Array.from(pages).sort((a, b) => a - b);
  const result: (number | 'ellipsis')[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) {
      result.push('ellipsis');
    }
    result.push(sorted[i]);
  }
  return result;
}

interface SmartPaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  totalItems?: number;
  className?: string;
}

export function SmartPagination({
  currentPage,
  totalPages,
  onPageChange,
  totalItems,
  className,
}: SmartPaginationProps) {
  const [jumpValue, setJumpValue] = useState('');
  const pages = getPageRange(currentPage, totalPages);

  const handleJump = (e: React.FormEvent) => {
    e.preventDefault();
    const n = parseInt(jumpValue, 10);
    if (!isNaN(n) && n >= 1 && n <= totalPages) {
      onPageChange(n);
      setJumpValue('');
    }
  };

  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3', className)}>
      {totalItems != null && (
        <p className="text-xs text-muted-foreground">
          Page {currentPage} of {totalPages.toLocaleString()}
          &nbsp;·&nbsp;
          {totalItems.toLocaleString()} total
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1">
        <Button
          size="icon"
          variant="outline"
          className="h-7 w-7"
          disabled={currentPage === 1}
          onClick={() => onPageChange(currentPage - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>

        {/* Page number buttons hidden on xs screens to avoid overflow */}
        <div className="hidden sm:flex flex-wrap items-center gap-1">
          {pages.map((p, i) =>
            p === 'ellipsis' ? (
              <span
                key={`ellipsis-${i}`}
                className="px-1 text-xs text-muted-foreground select-none"
              >
                …
              </span>
            ) : (
              <Button
                key={p}
                size="sm"
                variant={currentPage === p ? 'default' : 'outline'}
                className="h-7 min-w-7 px-1.5 text-xs font-normal tabular-nums"
                onClick={() => onPageChange(p)}
                aria-label={`Page ${p}`}
                aria-current={currentPage === p ? 'page' : undefined}
              >
                {p}
              </Button>
            ),
          )}
        </div>

        {/* On xs screens show just current page indicator */}
        <span className="sm:hidden text-xs text-muted-foreground px-2 tabular-nums">
          {currentPage} / {totalPages}
        </span>

        <Button
          size="icon"
          variant="outline"
          className="h-7 w-7"
          disabled={currentPage === totalPages}
          onClick={() => onPageChange(currentPage + 1)}
          aria-label="Next page"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>

        <form onSubmit={handleJump} className="ml-1 sm:ml-2 flex items-center gap-1">
          <Input
            className="h-7 w-16 sm:w-20 text-xs text-center"
            placeholder="Go to…"
            value={jumpValue}
            onChange={(e) => setJumpValue(e.target.value)}
            aria-label="Jump to page"
          />
          <Button type="submit" size="sm" variant="outline" className="h-7 px-2 text-xs">
            Go
          </Button>
        </form>
      </div>
    </div>
  );
}
