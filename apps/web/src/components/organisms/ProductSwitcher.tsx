import { PRODUCT_STATUS_LABELS } from '@growth-desk/contract';
import { CaretDown } from '@phosphor-icons/react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu';
import { DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ProductDot } from '@/components/molecules/ProductDot';
import { Spinner } from '@/components/atoms/Spinner';
import { useSelectedProduct } from '@/lib/use-selected-product';
import { cn } from '@/lib/utils';


/** Product switcher in the sidebar (Figma 239:684): joy-soft pill with the product dot. */
export function ProductSwitcher({ className }: { className?: string }) {
  const { product, products, setProductId, isLoading, isError, refetch } = useSelectedProduct();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'focus-ring-dark flex h-10 w-full items-center gap-2.5 rounded-tile bg-joy-soft px-3.5 text-left transition-colors hover:brightness-[0.97]',
          className,
        )}
        aria-label={product ? `Product: ${product.name}. Change product` : 'Choose a product'}
      >
        {isLoading ? (
          <Spinner size={10} label={null} className="text-joy-text" />
        ) : (
          <ProductDot color={product?.color} />
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
          {isLoading ? 'Loading' : product?.name ?? (isError ? 'Products not loaded' : 'No products yet')}
        </span>
        <CaretDown size={12} weight="bold" className="shrink-0 text-muted" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-[216px]">
        <DropdownMenuLabel>Products</DropdownMenuLabel>
        {isError ? (
          <DropdownMenuItem onSelect={() => void refetch()}>Could not load products. Try again</DropdownMenuItem>
        ) : products.length === 0 && !isLoading ? (
          <DropdownMenuItem disabled>No products yet</DropdownMenuItem>
        ) : (
          <DropdownMenuRadioGroup value={product?.id ?? ''} onValueChange={(id) => setProductId(id)}>
            {products.map((p) => (
              <DropdownMenuRadioItem key={p.id} value={p.id}>
                <ProductDot color={p.color} />
                <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                <span className="text-2xs text-muted">{PRODUCT_STATUS_LABELS[p.status]}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
