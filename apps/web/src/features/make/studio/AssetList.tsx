import {
  ArrowSquareOut,
  FileText,
  FilmStrip,
  Image as ImageIcon,
  Trash,
} from '@phosphor-icons/react';
import * as React from 'react';
import { toast } from 'sonner';
import type { MakeAsset, AssetKind, AssetUrlResponse } from '@growth-desk/contract';
import { IconButton } from '@/components/atoms/IconButton';
import { StatusChip, type StatusTone } from '@/components/atoms/StatusChip';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import { EmptyState } from '@/components/molecules/EmptyState';
import { errorMessage } from '@/components/molecules/ErrorState';
import { IconTile } from '@/components/molecules/ListRow';
import { api } from '@/lib/api';
import { useAssetUrl, useDeleteAsset } from '../api';
import { AssetDetailsButton, LoudnessInline } from './AssetDetailsEditor';
import { assetMeta, hasLoudness } from './helpers';

const statusChip: Record<MakeAsset['status'], { label: string; tone: StatusTone }> = {
  ready: { label: 'Ready', tone: 'care' },
  uploading: { label: 'Uploading', tone: 'joy' },
  failed: { label: 'Failed', tone: 'danger' },
};

const kindIcon: Record<AssetKind, typeof FilmStrip> = {
  video: FilmStrip,
  cutdown: FilmStrip,
  poster: ImageIcon,
  caption: FileText,
};

function AssetFlags({ asset }: { asset: MakeAsset }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <StatusChip tone={asset.consentOnFile ? 'care' : 'neutral'}>
        {asset.consentOnFile ? 'Consent on file' : 'No consent record'}
      </StatusChip>
      <StatusChip tone={asset.licence ? 'care' : 'neutral'} title={asset.licence ?? undefined}>
        {asset.licence ? 'Licensed' : 'No licence'}
      </StatusChip>
      {asset.aiGenerated ? <StatusChip tone="joy">AI label</StatusChip> : null}
    </div>
  );
}

async function openAsset(asset: MakeAsset) {
  try {
    const { url } = await api<AssetUrlResponse>(`/assets/${asset.id}/url`);
    window.open(url, '_blank', 'noopener,noreferrer');
  } catch (err) {
    toast.error('Could not open the file', { description: errorMessage(err).detail });
  }
}

function PosterThumb({ asset }: { asset: MakeAsset }) {
  const url = useAssetUrl(asset.status === 'ready' ? asset.id : null);
  return (
    <div className="flex aspect-[4/5] w-full items-center justify-center overflow-hidden rounded-tile bg-surface-sunken">
      {url.data ? (
        <img
          src={url.data.url}
          alt={asset.fileName ?? 'Poster'}
          className="size-full object-cover"
          loading="lazy"
        />
      ) : (
        <IconTile icon={ImageIcon} tone="neutral" />
      )}
    </div>
  );
}

export interface AssetListProps {
  briefId: string;
  assets: MakeAsset[];
  canEdit: boolean;
  layout?: 'list' | 'grid';
  emptyTitle: string;
  emptyDescription?: React.ReactNode;
  emptyAction?: React.ReactNode;
}

export function AssetList({
  briefId,
  assets,
  canEdit,
  layout = 'list',
  emptyTitle,
  emptyDescription,
  emptyAction,
}: AssetListProps) {
  const del = useDeleteAsset(briefId);
  const [toDelete, setToDelete] = React.useState<MakeAsset | null>(null);

  if (assets.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />;
  }

  const actions = (asset: MakeAsset) => (
    <div className="flex items-center gap-1">
      {canEdit ? <AssetDetailsButton briefId={briefId} asset={asset} /> : null}
      {asset.status === 'ready' ? (
        <IconButton
          icon={ArrowSquareOut}
          label={`Open ${asset.fileName ?? 'file'}`}
          variant="ghost"
          size="sm"
          onClick={() => void openAsset(asset)}
        />
      ) : null}
      {canEdit ? (
        <IconButton
          icon={Trash}
          label={`Delete ${asset.fileName ?? 'file'}`}
          variant="ghost"
          size="sm"
          onClick={() => setToDelete(asset)}
        />
      ) : null}
    </div>
  );

  return (
    <>
      {layout === 'grid' ? (
        <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4" aria-label="Files">
          {assets.map((asset) => (
            <li
              key={asset.id}
              className="flex flex-col gap-2 rounded-card border border-hairline bg-surface-card p-3"
            >
              <PosterThumb asset={asset} />
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-13 font-semibold text-ink">
                    {asset.fileName ?? 'Untitled file'}
                  </p>
                  <p className="truncate text-xs text-muted">{assetMeta(asset)}</p>
                </div>
                {actions(asset)}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusChip tone={statusChip[asset.status].tone}>
                  {statusChip[asset.status].label}
                </StatusChip>
                <AssetFlags asset={asset} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <ul
          className="flex flex-col divide-y divide-hairline rounded-card border border-hairline bg-surface-card"
          aria-label="Files"
        >
          {assets.map((asset) => (
            <li key={asset.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <IconTile icon={kindIcon[asset.kind]} tone="neutral" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">
                  {asset.fileName ?? 'Untitled file'}
                </p>
                <p className="truncate text-xs text-muted">{assetMeta(asset)}</p>
              </div>
              <AssetFlags asset={asset} />
              <StatusChip tone={statusChip[asset.status].tone}>
                {statusChip[asset.status].label}
              </StatusChip>
              {actions(asset)}
              {hasLoudness(asset.kind) ? (
                <div className="basis-full pl-[54px]">
                  <LoudnessInline briefId={briefId} asset={asset} canEdit={canEdit} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Delete this file?"
        description={`${toDelete?.fileName ?? 'The file'} is removed from storage. This cannot be undone.`}
        confirmLabel="Delete file"
        tone="danger"
        onConfirm={async () => {
          if (!toDelete) return;
          try {
            await del.mutateAsync(toDelete.id);
            toast.success('File deleted');
          } catch (err) {
            toast.error('Could not delete the file', { description: errorMessage(err).detail });
            throw err;
          }
        }}
      />
    </>
  );
}
