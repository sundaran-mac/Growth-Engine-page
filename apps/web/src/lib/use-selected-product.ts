import { useEffect, useMemo } from 'react';
import { useUiStore } from '@/stores/ui';
import { useProductsForSwitcher } from './shell-queries';
import type { Product } from '@growth-desk/contract';

/**
 * The product chosen in the sidebar switcher. Falls back to the first product when the saved
 * id is missing or no longer in the list. Module screens use `productId` to scope their queries.
 */
export function useSelectedProduct() {
  const query = useProductsForSwitcher();
  const selectedId = useUiStore((s) => s.selectedProductId);
  const setSelectedId = useUiStore((s) => s.setSelectedProductId);
  const items = query.data?.items;

  const product: Product | null = useMemo(() => {
    if (!items || items.length === 0) return null;
    return items.find((p) => p.id === selectedId) ?? items[0] ?? null;
  }, [items, selectedId]);

  useEffect(() => {
    if (product && product.id !== selectedId) setSelectedId(product.id);
  }, [product, selectedId, setSelectedId]);

  return {
    product,
    productId: product?.id ?? null,
    products: items ?? [],
    setProductId: setSelectedId,
    isLoading: query.isPending,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}
