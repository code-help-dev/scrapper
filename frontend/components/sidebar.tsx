'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import {
  Link2, ListChecks, Package, Download, BarChart2,
  LogOut, Activity, ShoppingBag, Users, Search,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useState, useEffect } from 'react';

const NAV_MAIN = [
  { href: '/stats',    icon: BarChart2,  label: 'Dashboard' },
  { href: '/submit',   icon: Link2,      label: 'Submit URL' },
  { href: '/jobs',     icon: ListChecks, label: 'Job Monitor' },
  { href: '/products', icon: Package,    label: 'Products' },
  { href: '/export',   icon: Download,   label: 'Export' },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();

  const [collapsed, setCollapsed] = useState(false);
  const [sellerOpen, setSellerOpen] = useState(pathname.startsWith('/sellers'));

  // Persist collapsed state across page loads
  useEffect(() => {
    const saved = localStorage.getItem('sidebar-collapsed');
    if (saved !== null) setCollapsed(saved === 'true');
  }, []);

  const toggleCollapse = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('sidebar-collapsed', String(next));
      return next;
    });
  };

  const isActive = (href: string) =>
    href === '/sellers' ? pathname === '/sellers' : pathname.startsWith(href);

  return (
    <aside
      className={cn(
        'border-r bg-card flex flex-col shrink-0 transition-all duration-200',
        collapsed ? 'w-16' : 'w-60',
      )}
    >
      {/* Brand + collapse toggle */}
      <div className={cn('border-b flex items-center shrink-0', collapsed ? 'p-3 justify-center' : 'p-4 gap-2')}>
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary shrink-0" />
              <span className="font-bold text-sm truncate">Aajjo Scraper</span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">EB2BMART — Phase 1</p>
          </div>
        )}
        {collapsed && <Activity className="h-5 w-5 text-primary" />}
        <button
          onClick={toggleCollapse}
          className={cn(
            'rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors shrink-0',
            collapsed && 'mt-0',
          )}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Nav */}
      <nav className={cn('flex-1 overflow-y-auto space-y-0.5', collapsed ? 'p-2' : 'p-3')}>
        {NAV_MAIN.map(({ href, icon: Icon, label }) => (
          <Link
            key={href}
            href={href}
            title={collapsed ? label : undefined}
            className={cn(
              'flex items-center rounded-md px-2 py-2 text-sm font-medium transition-colors',
              collapsed ? 'justify-center' : 'gap-3 px-3',
              isActive(href)
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {!collapsed && label}
          </Link>
        ))}

        {/* Divider */}
        <div className="my-2 border-t" />

        {/* Seller Orders (collapsible sub-menu) */}
        {collapsed ? (
          <Link
            href="/sellers"
            title="Sellers"
            className={cn(
              'flex items-center justify-center rounded-md px-2 py-2 text-sm font-medium transition-colors',
              pathname.startsWith('/sellers')
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            <ShoppingBag className="h-4 w-4 shrink-0" />
          </Link>
        ) : (
          <>
            <button
              onClick={() => setSellerOpen((o) => !o)}
              className={cn(
                'w-full flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                pathname.startsWith('/sellers')
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              <ShoppingBag className="h-4 w-4 shrink-0" />
              <span className="flex-1 text-left">Seller Orders</span>
              <span className="text-xs opacity-50">{sellerOpen ? '▲' : '▼'}</span>
            </button>

            {sellerOpen && (
              <div className="ml-4 space-y-0.5">
                <Link
                  href="/sellers/search"
                  className={cn(
                    'flex items-center gap-3 rounded-md px-3 py-1.5 text-sm transition-colors',
                    pathname === '/sellers/search'
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  <Search className="h-3.5 w-3.5" />
                  Search
                </Link>
              </div>
            )}

            {/* List of Sellers */}
            <Link
              href="/sellers"
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                pathname === '/sellers'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              <Users className="h-4 w-4" />
              List of Sellers
            </Link>
          </>
        )}
      </nav>

      {/* User */}
      <div className={cn('border-t shrink-0', collapsed ? 'p-2' : 'p-3')}>
        {!collapsed && (
          <div className="flex items-center gap-2 px-3 py-2 mb-1">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate">{session?.user?.email}</p>
              <Badge variant="secondary" className="text-[10px] capitalize mt-0.5">
                {(session?.user as any)?.role ?? 'viewer'}
              </Badge>
            </div>
          </div>
        )}
        <Button
          variant="ghost"
          size="sm"
          title="Sign out"
          className={cn(
            'w-full text-muted-foreground',
            collapsed ? 'justify-center px-0' : 'justify-start gap-2',
          )}
          onClick={() => signOut({ callbackUrl: '/login' })}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {!collapsed && 'Sign out'}
        </Button>
      </div>
    </aside>
  );
}
