// Products screen (Figma frame 239:888). Owned by the PRODUCTS agent.
import { Plus } from '@phosphor-icons/react';
import { useState } from 'react';
import { Button } from '@/components/atoms/Button';
import { EmptyState } from '@/components/molecules/EmptyState';
import { ErrorState } from '@/components/molecules/ErrorState';
import { Stagger, StaggerItem } from '@/components/motion';
import { Page } from '@/components/templates/Page';
import { useSessionStore } from '@/stores/session';
import { useProducts } from '@/features/products/api';
import { AddProductDialog } from '@/features/products/components/AddProductDialog';
import {
  AddProductCard,
  ProductCard,
  ProductCardSkeleton,
} from '@/features/products/components/ProductCard';

export default function ProductsPage() {
  const query = useProducts();
  const role = useSessionStore((s) => s.user?.role);
  const canAdd = role === 'admin' || role === 'editor';
  const [adding, setAdding] = useState(false);

  return (
    <Page
      title="Products"
      subtitle="Every Humini product in the engine, and how ready its kit is"
      actions={
        canAdd ? (
          <Button leftIcon={Plus} onClick={() => setAdding(true)}>
            Add product
          </Button>
        ) : null
      }
    >
      {query.isPending ? (
        <div
          className="grid grid-cols-1 gap-6 lg:grid-cols-2"
          aria-busy="true"
          aria-label="Loading products"
        >
          <ProductCardSkeleton />
          <ProductCardSkeleton />
        </div>
      ) : query.isError ? (
        <ErrorState
          error={query.error}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      ) : query.data.items.length === 0 ? (
        <EmptyState
          title="No products yet"
          description="Add the first product by pointing Growth Desk at its repo."
          action={
            canAdd ? (
              <Button leftIcon={Plus} onClick={() => setAdding(true)}>
                Add product
              </Button>
            ) : null
          }
        />
      ) : (
        <Stagger className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
          {query.data.items.map((p) => (
            <StaggerItem key={p.id} className="min-w-0">
              <ProductCard product={p} />
            </StaggerItem>
          ))}
          <StaggerItem className="flex min-w-0">
            <AddProductCard onClick={() => setAdding(true)} disabled={!canAdd} />
          </StaggerItem>
        </Stagger>
      )}
      {adding ? <AddProductDialog open onOpenChange={setAdding} /> : null}
    </Page>
  );
}
