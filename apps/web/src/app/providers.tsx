import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { createQueryClient } from '@/lib/query-client';

export function AppProviders({ children, client }: { children: React.ReactNode; client?: QueryClient }) {
  const [queryClient] = React.useState(() => client ?? createQueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        {children}
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
