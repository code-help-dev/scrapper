'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { dashboardApi } from '@/lib/api';
import { DashboardStats } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { Package, CheckCircle2, AlertTriangle, Flag, Briefcase } from 'lucide-react';

function StatCard({ title, value, sub, icon: Icon, color = 'text-primary', href }: {
  title: string; value: number | string; sub?: string;
  icon: React.ElementType; color?: string; href?: string;
}) {
  const inner = (
    <Card className={href ? 'transition hover:shadow-md hover:border-primary/40 cursor-pointer' : ''}>
      <CardContent className="p-4 sm:p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs sm:text-sm text-muted-foreground">{title}</p>
            <p className={`text-2xl sm:text-3xl font-bold mt-1 ${color}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </div>
          <Icon className={`h-6 w-6 sm:h-8 sm:w-8 opacity-20 ${color}`} />
        </div>
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export default function StatsPage() {
  const { data, isLoading } = useQuery<DashboardStats>({
    queryKey: ['dashboard-stats'],
    queryFn: () => dashboardApi.stats().then((r) => r.data),
    refetchInterval: 10_000,
  });

  if (isLoading) return <div className="text-muted-foreground text-sm">Loading stats…</div>;
  if (!data) return null;

  const { products, jobs, categoryBreakdown } = data;

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground text-sm">Real-time extraction stats</p>
      </div>

      {}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard title="Total Products" value={products.total} icon={Package} />
        <StatCard title="Completed" value={products.completed} icon={CheckCircle2} color="text-green-600" />
        <StatCard title="Flagged (< 70%)" value={products.flagged} icon={Flag} color="text-yellow-600" href="/products?flagged=true" />
        <StatCard title="Avg Confidence" value={`${products.avgConfidenceScore}%`} icon={AlertTriangle} />
      </div>

      {}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard title="Jobs Queued" value={jobs.queued} icon={Briefcase} />
        <StatCard title="Processing" value={jobs.processing} icon={Briefcase} color="text-blue-600" />
        <StatCard title="Completed" value={jobs.completed} icon={CheckCircle2} color="text-green-600" />
        <StatCard
          title="Success Rate"
          value={jobs.successRate}
          icon={CheckCircle2}
          color="text-emerald-600"
          sub={`${jobs.failed} failed`}
        />
      </div>

      {}
      {categoryBreakdown.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top Categories</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={categoryBreakdown} margin={{ top: 4, right: 16, bottom: 40, left: 0 }}>
                <XAxis dataKey="category" tick={{ fontSize: 11 }} angle={-30} textAnchor="end" interval={0} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {categoryBreakdown.map((_, i) => (
                    <Cell key={i} fill={`hsl(${221 + i * 18} 83% ${48 + i * 4}%)`} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
