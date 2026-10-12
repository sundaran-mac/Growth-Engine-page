import { CloudArrowUp, Pause } from '@phosphor-icons/react';
import * as React from 'react';
import type { MakeAsset, Ratio } from '@growth-desk/contract';
import { Button } from '@/components/atoms/Button';
import { Icon } from '@/components/atoms/Icon';
import { Spinner } from '@/components/atoms/Spinner';
import { cn } from '@/lib/utils';
import { useAssetUrl } from '../api';
import playButtonUrl from './play.svg';
import { captionChipText, PREVIEW_HEIGHT } from './helpers';
import { formatTimecode } from './upload';

/** Height of the 300px wide preview for each ratio (Figma: 300 x 375 for 4:5). */

export interface PreviewPlayerProps {
  asset: MakeAsset | null;
  ratio: Ratio;
  /** Caption chip text at the bottom (the brief hook). */
  caption: string | null;
  canUpload: boolean;
  onUpload: () => void;
}

/** Dark preview card with the play button, timecode and caption chip (Figma 241:1100). */
export function PreviewPlayer({ asset, ratio, caption, canUpload, onUpload }: PreviewPlayerProps) {
  const url = useAssetUrl(asset?.id);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = React.useState(false);
  const [currentMs, setCurrentMs] = React.useState(0);
  const [durationMs, setDurationMs] = React.useState<number | null>(asset?.durationMs ?? null);

  function toggle() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => setPlaying(false));
    else v.pause();
  }

  const height = PREVIEW_HEIGHT[ratio];
  const cleanCaption = captionChipText(caption);

  return (
    <div
      className="relative w-[300px] shrink-0 overflow-hidden rounded-[24px] bg-media-canvas text-media-text transition-[height]"
      style={{ height }}
      aria-label={`Preview, ratio ${ratio}`}
      role="region"
    >
      {asset && url.data ? (
        <video
          ref={videoRef}
          src={url.data.url}
          className="absolute inset-0 size-full object-cover"
          playsInline
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={(e) => setCurrentMs(Math.round(e.currentTarget.currentTime * 1000))}
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d)) setDurationMs(Math.round(d * 1000));
          }}
          aria-label={asset.fileName ?? 'Master video'}
        />
      ) : null}

      <p className="absolute left-6 top-5 text-xs font-medium tabular-nums" aria-live="off">
        {formatTimecode(currentMs)} / {formatTimecode(durationMs)}
      </p>

      {asset ? (
        url.isPending ? (
          <span className="absolute inset-0 flex items-center justify-center">
            <Spinner size={28} label="Loading video" />
          </span>
        ) : url.isError ? (
          <p
            role="alert"
            className="absolute inset-x-6 top-1/2 -translate-y-1/2 text-center text-13"
          >
            The video link could not be made. Try again in a moment.
          </p>
        ) : (
          <button
            type="button"
            onClick={toggle}
            aria-label={playing ? 'Pause' : 'Play'}
            className={cn(
              'focus-ring-dark absolute left-1/2 top-1/2 size-[60px] -translate-x-1/2 -translate-y-1/2 rounded-full transition-opacity',
              playing && 'opacity-0 hover:opacity-100 focus-visible:opacity-100',
            )}
          >
            {playing ? (
              <span className="flex size-[60px] items-center justify-center rounded-full bg-joy text-ink">
                <Icon icon={Pause} size={24} weight="fill" />
              </span>
            ) : (
              <img
                src={playButtonUrl}
                alt=""
                width={60}
                height={60}
                className="block size-[60px]"
              />
            )}
          </button>
        )
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <img
            src={playButtonUrl}
            alt=""
            width={60}
            height={60}
            className="block size-[60px] opacity-40"
          />
          <p className="text-13 text-media-text/80">No {ratio} video yet.</p>
          {canUpload ? (
            <Button size="sm" leftIcon={CloudArrowUp} onClick={onUpload}>
              Upload master
            </Button>
          ) : null}
        </div>
      )}

      {cleanCaption ? (
        <div className="absolute bottom-[40px] left-6 max-w-[252px] rounded-[10px] bg-surface-card px-3.5 py-2">
          <p className="truncate text-sm font-bold text-ink">{cleanCaption}</p>
        </div>
      ) : null}
    </div>
  );
}
