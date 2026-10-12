import { Plus } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import type { ProductSummary } from '@growth-desk/contract';
import { PLATFORM_LABELS } from '@growth-desk/contract';
import { Button } from '@/components/atoms/Button';
import { Icon } from '@/components/atoms/Icon';
import { StatusChip } from '@/components/atoms/StatusChip';
import { KeyValue, KeyValueList } from '@/components/molecules/KeyValue';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  kitBarClass,
  kitLine,
  PLATFORM_ICONS,
  PRODUCT_STATUS_TONE,
  productStatusText,
  thisMonthText,
} from '../format';

/** Kit completeness bar (Figma: 8px, sunken track, coloured fill). */
export function KitBar({ score, className }: { score: number; className?: string }) {
  return (
    <div
      role="progressbar"
      aria-label="Kit completeness"
      aria-valuemin={0}
      aria-valuemax={10}
      aria-valuenow={score}
      className={cn('h-2 w-full overflow-hidden rounded-[4px] bg-surface-sunken', className)}
    >
      <div
        className={cn('h-2 rounded-[4px]', kitBarClass(score))}
        style={{ width: `${score * 10}%` }}
      />
    </div>
  );
}

/** One product card (Figma 239:986). */
export function ProductCard({ product }: { product: ProductSummary }) {
  const score = product.kit?.score ?? 0;
  const promise = product.kit?.promise ?? 'To confirm with the product team';
  return (
    <article
      aria-labelledby={`product-${product.id}`}
      className="flex min-w-0 flex-col items-start gap-3 rounded-card border border-hairline bg-surface-card p-6"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <span
          aria-hidden="true"
          className="size-3.5 shrink-0 rounded-full"
          style={{ backgroundColor: product.color ?? '#d4ccbc' }}
        />
        <h2 id={`product-${product.id}`} className="truncate text-xl font-bold text-ink">
          {product.name}
        </h2>
        <StatusChip tone={PRODUCT_STATUS_TONE[product.status]} className="text-ink">
          {productStatusText(product.status, product.statusNote)}
        </StatusChip>
      </div>
      <p className="text-[15px] font-medium text-muted">{promise}</p>
      <KitBar score={score} />
      <p className="text-13 font-semibold text-ink">{kitLine(product)}</p>
      <KeyValueList className="flex-row gap-6">
        <KeyValue label="Owner" value={product.owner?.name ?? 'To confirm'} />
        <KeyValue label="This month" value={thisMonthText(product)} />
      </KeyValueList>
      {product.platforms.length > 0 ? (
        <ul className="flex gap-2.5" aria-label="Channels">
          {product.platforms.map((p) => (
            <li key={p} className="text-ink">
              <Icon icon={PLATFORM_ICONS[p]} size={20} label={PLATFORM_LABELS[p]} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted">No channels yet</p>
      )}
      <Button asChild variant="secondary">
        <Link to={`/products/${product.id}/kit`}>Open product kit →</Link>
      </Button>
    </article>
  );
}

/** Dashed "Add the next product" card (Figma 239:1076). */
export function AddProductCard({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-w-0 flex-col items-start gap-3 rounded-card border-[1.5px] border-dashed border-strong bg-surface-base p-6 text-left transition-colors hover:bg-surface-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
    >
      <Icon icon={Plus} size={28} className="text-ink" />
      <span className="text-[20px] font-bold text-ink">Add the next product</span>
      <span className="text-sm text-muted">
        SEND, GIVE, REFER, GATE, LIFT… Point Growth Desk at its repo; the owner fills and signs the
        kit.
      </span>
      {disabled ? (
        <span className="text-xs text-muted">Only editors and admins can add products.</span>
      ) : null}
    </button>
  );
}

export function ProductCardSkeleton() {
  return (
    <div
      className="flex flex-col gap-3 rounded-card border border-hairline bg-surface-card p-6"
      aria-hidden="true"
    >
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-5 w-72" />
      <Skeleton className="h-2 w-full" />
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-11 w-44 rounded-pill" />
    </div>
  );
}
