'use client';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'loading') return;
    if ((session?.user as any)?.role !== 'admin') {
      router.replace('/stats');
    }
  }, [session, status, router]);

  if (status === 'loading' || (session?.user as any)?.role !== 'admin') {
    return null;
  }

  return <>{children}</>;
}
