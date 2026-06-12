'use client';
import { useState } from 'react';
import { Activity, Menu } from 'lucide-react';
import { Sidebar } from '@/components/sidebar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar
        mobileOpen={mobileSidebarOpen}
        onMobileClose={() => setMobileSidebarOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Mobile top header — hidden on md+ */}
        <header className="flex shrink-0 items-center gap-3 border-b bg-card px-4 py-3 md:hidden">
          <button
            onClick={() => setMobileSidebarOpen(true)}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            <span className="font-bold text-sm">Aajjo Scraper</span>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="container mx-auto p-4 sm:p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
