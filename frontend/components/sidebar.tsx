'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import {
  LayoutDashboard, Link2, ListChecks, Package,
  Download, BarChart2, LogOut, Activity,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const NAV = [
  { href: '/stats',   icon: BarChart2,       label: 'Dashboard' },
  { href: '/submit',  icon: Link2,           label: 'Submit URL' },
  { href: '/jobs',    icon: ListChecks,      label: 'Job Monitor' },
  { href: '/products',icon: Package,         label: 'Products' },
  { href: '/export',  icon: Download,        label: 'Export' },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();

  return (
    <aside className="w-60 border-r bg-card flex flex-col shrink-0">
      {/* Brand */}
      <div className="p-5 border-b">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          <span className="font-bold text-sm">Aajjo Scraper</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">EB2BMART — Phase 1</p>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-1">
        {NAV.map(({ href, icon: Icon, label }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              pathname.startsWith(href)
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        ))}
      </nav>

      {/* User */}
      <div className="p-3 border-t">
        <div className="flex items-center gap-2 px-3 py-2 mb-1">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate">{session?.user?.email}</p>
            <Badge variant="secondary" className="text-[10px] capitalize mt-0.5">
              {(session?.user as any)?.role ?? 'viewer'}
            </Badge>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-muted-foreground"
          onClick={() => signOut({ callbackUrl: '/login' })}
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      </div>
    </aside>
  );
}
