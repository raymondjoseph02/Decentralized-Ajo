'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PlusCircle, Search } from 'lucide-react';
import { authenticatedFetch } from '@/lib/auth-client';
import { useWallet } from '@/lib/wallet-context';
import { Dashboard } from '@/components/dashboard';
import { DashboardStats } from '@/components/dashboard/dashboard-stats';
import { CircleList } from '@/components/dashboard/circle-list';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';

const PAGE_SIZE = 9;

interface Circle {
  id: string;
  name: string;
  description?: string;
  contributionAmount: number;
  contributionFrequencyDays: number;
  maxRounds: number;
  currentRound: number;
  status: string;
  createdAt: string;
  members: { userId: string }[];
  contributions: { amount: number }[];
}

export default function DashboardPage() {
  const router = useRouter();
  useWallet(); // ensures wallet context is available for child components

  const [circles, setCircles] = useState<Circle[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const fetchCircles = useCallback(async () => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if (!token) {
      router.push('/auth/login');
      return;
    }

    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_SIZE),
        ...(search && { search }),
        ...(statusFilter && { status: statusFilter }),
      });

      const res = await authenticatedFetch(`/api/circles?${params}`);
      if (res.status === 401) {
        router.push('/auth/login');
        return;
      }
      if (!res.ok) throw new Error('Failed to fetch circles');

      const json = await res.json();
      setCircles(json.data ?? []);
      setTotalPages(json.meta?.pages ?? 1);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, router]);

  useEffect(() => {
    fetchCircles();
  }, [fetchCircles]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  // Map circles to the shape Dashboard expects
  const activeGroups = circles
    .filter((c: Circle) => c.status === 'ACTIVE')
    .map((c: Circle) => ({
      id: c.id,
      name: c.name,
      balance: c.members.length * c.contributionAmount * c.currentRound,
      nextCycle: (() => {
        const daysSinceStart =
          (Date.now() - new Date(c.createdAt).getTime()) / (1000 * 60 * 60 * 24);
        const daysUntilNext =
          c.contributionFrequencyDays - (daysSinceStart % c.contributionFrequencyDays);
        return daysUntilNext <= 1
          ? 'Tomorrow'
          : `In ${Math.ceil(daysUntilNext)} days`;
      })(),
    }));

  const renderPagination = () => {
    if (totalPages <= 1) return null;
    const pages: (number | 'ellipsis')[] = [];
    if (totalPages <= 5) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (page > 3) pages.push('ellipsis');
      for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
        pages.push(i);
      }
      if (page < totalPages - 2) pages.push('ellipsis');
      pages.push(totalPages);
    }

    return (
      <Pagination>
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              href="#"
              onClick={(e: React.MouseEvent) => { e.preventDefault(); setPage((p: number) => Math.max(1, p - 1)); }}
              aria-disabled={page === 1}
              className={page === 1 ? 'pointer-events-none opacity-50' : ''}
            />
          </PaginationItem>
          {pages.map((p, i) =>
            p === 'ellipsis' ? (
              <PaginationItem key={`ellipsis-${i}`}>
                <PaginationEllipsis />
              </PaginationItem>
            ) : (
              <PaginationItem key={p}>
                <PaginationLink
                  href="#"
                  isActive={p === page}
                  onClick={(e: React.MouseEvent) => { e.preventDefault(); setPage(p as number); }}
                >
                  {p}
                </PaginationLink>
              </PaginationItem>
            )
          )}
          <PaginationItem>
            <PaginationNext
              href="#"
              onClick={(e: React.MouseEvent) => { e.preventDefault(); setPage((p: number) => Math.min(totalPages, p + 1)); }}
              aria-disabled={page === totalPages}
              className={page === totalPages ? 'pointer-events-none opacity-50' : ''}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    );
  };

  return (
    <main className="min-h-screen bg-background">
      {/* Overview: wallet gate + active group cards + upcoming cycles */}
      <Dashboard activeGroups={activeGroups} />

      <div className="container mx-auto px-4 py-10 space-y-8">
        {/* Stats row */}
        <DashboardStats />

        {/* Circle browser */}
        <div className="space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <h2 className="text-2xl font-bold">My Circles</h2>
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search circles..."
                  value={search}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
                  className="pl-9 w-56"
                />
              </div>
              <Tabs value={statusFilter} onValueChange={setStatusFilter}>
                <TabsList>
                  <TabsTrigger value="">All</TabsTrigger>
                  <TabsTrigger value="ACTIVE">Active</TabsTrigger>
                  <TabsTrigger value="PENDING">Pending</TabsTrigger>
                  <TabsTrigger value="COMPLETED">Completed</TabsTrigger>
                </TabsList>
              </Tabs>
              <Button asChild>
                <Link href="/circles/create">
                  <PlusCircle className="mr-2 h-4 w-4" />
                  New Circle
                </Link>
              </Button>
            </div>
          </div>

          <CircleList circles={circles} loading={loading} />
          {renderPagination()}
        </div>
      </div>
    </main>
  );
}
