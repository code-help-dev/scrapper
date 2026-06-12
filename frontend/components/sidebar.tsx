'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import {
  Link2, ListChecks, Package, Download, BarChart2,
  LogOut, Activity, Users, ShieldCheck, LayoutDashboard,
  ChevronLeft, ChevronRight, X,
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

const NAV_ADMIN = [
  { href: '/admin/overview', icon: LayoutDashboard, label: 'Admin Overview' },
  { href: '/admin/users',    icon: ShieldCheck,     label: 'User Management' },
];

function NavLinks({
  collapsed,
  onLinkClick,
}: {
  collapsed: boolean;
  onLinkClick?: () => void;
}) {
  const pathname = usePathname();
  const { data: session } = useSession();

  const isActive = (href: string) =>
    href === '/sellers' ? pathname === '/sellers' : pathname.startsWith(href);

  const linkCls = (href: string) =>
    cn(
      'flex items-center rounded-md px-2 py-2.5 text-sm font-medium transition-colors',
      collapsed ? 'justify-center' : 'gap-3 px-3',
      isActive(href)
        ? 'bg-primary text-primary-foreground'
        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
    );

  return (
    <>
      <nav className={cn('flex-1 overflow-y-auto space-y-0.5', collapsed ? 'p-2' : 'p-3')}>
        {NAV_MAIN.map(({ href, icon: Icon, label }) => (
          <Link
            key={href}
            href={href}
            title={collapsed ? label : undefined}
            onClick={onLinkClick}
            className={linkCls(href)}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {!collapsed && label}
          </Link>
        ))}

        <div className="my-2 border-t" />

        <Link
          href="/sellers"
          title={collapsed ? 'List of Sellers' : undefined}
          onClick={onLinkClick}
          className={linkCls('/sellers')}
        >
          <Users className="h-4 w-4 shrink-0" />
          {!collapsed && 'List of Sellers'}
        </Link>

        {(session?.user as any)?.role === 'admin' && (
          <div className="hidden">
            <div className="my-2 border-t" />
            {!collapsed && (
              <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Admin
              </p>
            )}
            {NAV_ADMIN.map(({ href, icon: Icon, label }) => (
              <Link
                key={href}
                href={href}
                title={collapsed ? label : undefined}
                onClick={onLinkClick}
                className={linkCls(href)}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!collapsed && label}
              </Link>
            ))}
          </div>
        )}
      </nav>

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
    </>
  );
}

export function Sidebar({
  mobileOpen,
  onMobileClose,
}: {
  mobileOpen: boolean;
  onMobileClose: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

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

  return (
    <>
      {/* Mobile overlay backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={onMobileClose}
        />
      )}

      {/* Mobile slide-in drawer */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r bg-card shadow-xl transition-transform duration-200 md:hidden',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex shrink-0 items-center gap-2 border-b p-4">
          <Activity className="h-5 w-5 shrink-0 text-primary" />
          <div className="flex-1 min-w-0">
            <span className="font-bold text-sm">Aajjo Scraper</span>
            <p className="text-xs text-muted-foreground mt-0.5">EB2BMART — Phase 1</p>
          </div>
          <button
            onClick={onMobileClose}
            className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            aria-label="Close menu"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <NavLinks collapsed={false} onLinkClick={onMobileClose} />
      </aside>

      {/* Desktop sidebar */}
      <aside
        className={cn(
          'hidden md:flex flex-col shrink-0 border-r bg-card transition-all duration-200',
          collapsed ? 'w-16' : 'w-60',
        )}
      >
        <div
          className={cn(
            'flex shrink-0 items-center border-b',
            collapsed ? 'justify-center p-3' : 'gap-2 p-4',
          )}
        >
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <Activity className="h-5 w-5 shrink-0 text-primary" />
                <span className="font-bold text-sm truncate">Aajjo Scraper</span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">EB2BMART — Phase 1</p>
            </div>
          )}
          {collapsed && <Activity className="h-5 w-5 text-primary" />}
          <button
            onClick={toggleCollapse}
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </button>
        </div>
        <NavLinks collapsed={collapsed} />
      </aside>
    </>
  );
}
