import { Image, Pause, Play } from '@phosphor-icons/react';
import * as React from 'react';
import type { ReviewComment, ReviewMasterAsset } from '@growth-desk/contract';
import { Icon } from '@/components/atoms';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useAssetUrl } from '../api';
import { formatTimecode } from '../format';

export interface ReviewPreviewProps {
  master: ReviewMasterAsset | null;
  /** Text on the caption card (the brief hook). */
  caption: string | null;
  comments: readonly ReviewComment[];
  positionMs: number;
  onPositionChange: (ms: number) => void;
  /** A seek request from outside (a comment timecode was clicked). */
  seekTo: { ms: number; nonce: number } | null;
}

/**
 * Dark preview canvas (Figma 241:1293): timecode top left, play button, caption card,
 * and a timeline with comment markers below it. Click the timeline to move the playhead.
 */
export function ReviewPreview({
  master,
  caption,
  comments,
  positionMs,
  onPositionChange,
  seekTo,
}: ReviewPreviewProps) {
  const url = useAssetUrl(master?.id);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = React.useState(false);
  // Length read from the video file; the asset record value is the fallback.
  const [measured, setMeasured] = React.useState<{ assetId: string; ms: number } | null>(null);
  const durationMs =
    (measured && measured.assetId === master?.id ? measured.ms : null) ?? master?.durationMs ?? 0;
  const isVideo = Boolean(master?.mimeType.startsWith('video/'));
  const isImage = Boolean(master?.mimeType.startsWith('image/'));

  // Move the video to a timecode the parent asked for (a comment chip was clicked).
  React.useEffect(() => {
    const v = videoRef.current;
    if (seekTo && v) v.currentTime = seekTo.ms / 1000;
  }, [seekTo]);

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => setPlaying(false));
    else v.pause();
  }

  function seekFromBar(e: React.MouseEvent<HTMLDivElement>) {
    if (!durationMs) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const ms = Math.round(ratio * durationMs);
    if (videoRef.current) videoRef.current.currentTime = ms / 1000;
    onPositionChange(ms);
  }

  function onBarKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!durationMs) return;
    const step = e.shiftKey ? 5000 : 1000;
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = Math.min(durationMs, positionMs + step);
    if (e.key === 'ArrowLeft') next = Math.max(0, positionMs - step);
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = durationMs;
    if (next === null) return;
    e.preventDefault();
    if (videoRef.current) videoRef.current.currentTime = next / 1000;
    onPositionChange(next);
  }

  const timeLabel = `${formatTimecode(positionMs)} / ${formatTimecode(durationMs)}`;

  return (
    <div className="flex w-full max-w-[380px] shrink-0 flex-col gap-3">
      <div className="relative h-[475px] w-full overflow-hidden rounded-[24px] bg-media-canvas text-media-text">
        {master && isVideo && url.data ? (
          <video
            ref={videoRef}
            src={url.data.url}
            className="absolute inset-0 size-full object-contain"
            playsInline
            preload="metadata"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onLoadedMetadata={(e) => {
              const d = e.currentTarget.duration;
              if (Number.isFinite(d) && d > 0)
                setMeasured({ assetId: master.id, ms: Math.round(d * 1000) });
            }}
            onTimeUpdate={(e) => onPositionChange(Math.round(e.currentTarget.currentTime * 1000))}
          >
            <track kind="captions" />
          </video>
        ) : null}
        {master && isImage && url.data ? (
          <img
            src={url.data.url}
            alt={master.fileName ?? 'Poster preview'}
            className="absolute inset-0 size-full object-contain"
          />
        ) : null}
        {master && url.isPending ? (
          <Skeleton className="absolute inset-0 rounded-none bg-white/5" />
        ) : null}

        {isVideo ? (
          <p className="absolute left-6 top-5 text-xs font-medium" aria-live="off">
            {timeLabel}
          </p>
        ) : null}

        {isVideo ? (
          <button
            type="button"
            onClick={togglePlay}
            disabled={!url.data}
            aria-label={playing ? 'Pause' : 'Play'}
            className={cn(
              'focus-ring-dark absolute left-1/2 top-1/2 inline-flex size-[60px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-joy text-ink transition-opacity disabled:cursor-not-allowed',
              playing && 'opacity-0 hover:opacity-100 focus-visible:opacity-100',
            )}
          >
            <Icon icon={playing ? Pause : Play} size={26} weight="fill" />
          </button>
        ) : null}

        {!master ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-8 text-center">
            <Icon icon={Image} size={28} className="text-media-text/60" />
            <p className="text-sm text-media-text/80">
              No ready master asset yet. Upload it in Studio.
            </p>
          </div>
        ) : null}
        {master && url.isError ? (
          <p className="absolute inset-x-6 top-1/2 -translate-y-1/2 text-center text-13 text-media-text/80">
            The preview could not load. Check storage on Integrations.
          </p>
        ) : null}

        {caption ? (
          <div className="absolute bottom-6 left-6 right-6 flex">
            <p className="rounded-[10px] bg-surface-card px-3.5 py-2 text-sm font-bold text-ink">
              {caption}
            </p>
          </div>
        ) : null}
      </div>

      {isVideo && durationMs > 0 ? (
        <div
          role="slider"
          tabIndex={0}
          aria-label="Timeline. Click to move the playhead for a comment."
          aria-valuemin={0}
          aria-valuemax={Math.round(durationMs / 1000)}
          aria-valuenow={Math.round(positionMs / 1000)}
          aria-valuetext={timeLabel}
          onClick={seekFromBar}
          onKeyDown={onBarKey}
          className="focus-ring relative h-6 w-full cursor-pointer rounded-pill bg-surface-sunken"
        >
          <span
            aria-hidden="true"
            className="absolute inset-y-0 left-0 rounded-pill bg-joy/40"
            style={{ width: `${Math.min(100, (positionMs / durationMs) * 100)}%` }}
          />
          {comments
            // One marker per thread: replies share their root's timecode.
            .filter((c) => c.timecodeMs !== null && !c.parentId)
            .map((c) => (
              <span
                key={c.id}
                aria-hidden="true"
                title={`${formatTimecode(c.timecodeMs!)} ${c.body}`}
                className={cn(
                  'absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface-card',
                  c.resolved ? 'bg-strong' : 'bg-joy-text',
                )}
                style={{ left: `${Math.min(100, (c.timecodeMs! / durationMs) * 100)}%` }}
              />
            ))}
        </div>
      ) : null}
    </div>
  );
}
