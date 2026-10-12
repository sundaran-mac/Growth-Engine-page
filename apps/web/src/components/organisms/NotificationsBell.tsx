import { Bell } from '@phosphor-icons/react';
import { motion } from 'motion/react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { Icon } from '@/components/atoms/Icon';
import { isApiError } from '@/lib/api';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from '@/lib/shell-queries';
import { cn } from '@/lib/utils';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return '';
  const min = Math.round(diff / 60_000);
  if (min < 1) return 'now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/** Bell button in the top bar (Figma 239:766) with a popover list of notifications. */
export function NotificationsBell() {
  const [open, setOpen] = React.useState(false);
  const navigate = useNavigate();
  const query = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const items = query.data?.items ?? [];
  const unread = items.filter((n) => !n.readAt).length;
  // Pulse the dot once when the unread count goes up after the first load (not on every refetch).
  const prevUnread = React.useRef<number | null>(null);
  const [pulse, setPulse] = React.useState(0);
  React.useEffect(() => {
    if (!query.data) return;
    if (prevUnread.current !== null && unread > prevUnread.current) setPulse((n) => n + 1);
    prevUnread.current = unread;
  }, [query.data, unread]);
  const notReady =
    isApiError(query.error) && (query.error.status === 404 || query.error.status === 501);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        className="focus-ring relative inline-flex size-10 shrink-0 items-center justify-center rounded-pill border border-hairline bg-surface-card text-ink transition-[color,background-color,border-color,box-shadow,filter,transform] duration-150 ease-out motion-safe:active:scale-[0.94] hover:bg-surface-sunken"
      >
        <Icon icon={Bell} size={18} />
        {unread ? (
          <motion.span
            key={pulse}
            aria-hidden="true"
            data-pulse={pulse || undefined}
            className="absolute right-2 top-2 size-2 rounded-full bg-joy ring-2 ring-surface-card"
            initial={pulse ? { scale: 1 } : false}
            animate={pulse ? { scale: [1, 1.7, 1] } : { scale: 1 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
          />
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
          <p className="text-sm font-bold">Notifications</p>
          {unread ? (
            <button
              type="button"
              className="focus-ring rounded-md text-xs font-semibold text-joy-text hover:underline disabled:opacity-60"
              disabled={markAll.isPending}
              onClick={() => markAll.mutate()}
            >
              Mark all read ({unread})
            </button>
          ) : null}
        </div>
        <div className="max-h-96 overflow-y-auto p-1.5">
          {query.isPending ? (
            <div className="flex flex-col gap-2 p-2.5" aria-busy="true">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ) : query.isError ? (
            <p className="px-2.5 py-6 text-center text-13 text-muted">
              {notReady ? 'Notifications are not set up yet.' : 'Could not load notifications.'}
            </p>
          ) : items.length === 0 ? (
            <p className="px-2.5 py-6 text-center text-13 text-muted">You are all caught up.</p>
          ) : (
            <ul className="flex flex-col">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    disabled={!n.link && Boolean(n.readAt)}
                    onClick={() => {
                      if (!n.readAt) markRead.mutate(n.id);
                      if (!n.link) return;
                      setOpen(false);
                      navigate(n.link);
                    }}
                    className={cn(
                      'focus-ring flex w-full gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors enabled:hover:bg-surface-sunken disabled:cursor-default',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'mt-1.5 size-2 shrink-0 rounded-full',
                        n.readAt ? 'bg-transparent' : 'bg-joy',
                      )}
                    />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-13 font-semibold text-ink">
                        {n.title}
                        {!n.readAt ? <span className="sr-only"> (unread)</span> : null}
                      </span>
                      {n.body ? <span className="text-xs text-muted">{n.body}</span> : null}
                      <span className="text-2xs text-muted">{timeAgo(n.createdAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
