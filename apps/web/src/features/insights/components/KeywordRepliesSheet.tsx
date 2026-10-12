/**
 * Keyword replies: the rules (comment CIRCLE, get the tracked link by DM) and the comments they
 * caught, with the reply status. Opened from Sales and from Home "Open inbox".
 */
import * as React from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import type { KeywordReplyStatus } from '@growth-desk/contract';
import { Button } from '@/components/atoms/Button';
import { Input, Textarea } from '@/components/atoms/Input';
import { Kicker } from '@/components/atoms/Kicker';
import { StatusChip, type StatusTone } from '@/components/atoms/StatusChip';
import { ErrorState } from '@/components/molecules/ErrorState';
import { Field } from '@/components/molecules/Field';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { isApiError } from '@/lib/api';
import {
  useCreateKeywordRule,
  useKeywordEvents,
  useKeywordRules,
  useUpdateKeywordRule,
} from '../api';
import { useCanManageProduct } from '../permissions';

const ruleFormSchema = z.object({
  keyword: z
    .string()
    .trim()
    .min(1, 'Enter one word')
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/, 'One word: letters, numbers, - or _'),
  replyText: z.string().trim().min(1, 'Write the reply').max(900),
  link: z.union([z.literal(''), z.url('Enter a full link, starting with https://')]),
});
type RuleForm = z.infer<typeof ruleFormSchema>;

const STATUS_TONE: Record<KeywordReplyStatus, StatusTone> = {
  queued: 'reminder',
  sent: 'success',
  failed: 'danger',
  skipped: 'neutral',
};

export function KeywordRepliesSheet({
  open,
  onOpenChange,
  productId,
  productName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string | null;
  productName?: string | undefined;
}) {
  const rules = useKeywordRules(productId, open);
  const events = useKeywordEvents(productId, open);
  const create = useCreateKeywordRule();
  const update = useUpdateKeywordRule();
  const canManage = useCanManageProduct(productId) && productId !== null;

  const form = useForm<RuleForm>({
    resolver: zodResolver(ruleFormSchema),
    defaultValues: { keyword: '', replyText: '', link: '' },
  });
  const { register, handleSubmit, formState, reset, setError } = form;

  const onSubmit = handleSubmit(async (v) => {
    if (!productId) return;
    try {
      await create.mutateAsync({
        productId,
        platform: 'instagram',
        keyword: v.keyword,
        replyText: v.replyText,
        link: v.link || null,
      });
      reset();
    } catch (error) {
      if (isApiError(error) && error.status === 409)
        setError('keyword', { message: 'This keyword already exists' });
    }
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-6 overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Keyword replies</SheetTitle>
          <SheetDescription>
            {productName ? `${productName} · ` : ''}A comment with the keyword gets the tracked link
            by DM and becomes a lead.
          </SheetDescription>
        </SheetHeader>

        <section aria-labelledby="kw-rules" className="flex flex-col gap-3">
          <Kicker as="h3" id="kw-rules">
            Rules
          </Kicker>
          {rules.isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : rules.isError ? (
            <ErrorState error={rules.error} onRetry={() => void rules.refetch()} className="py-6" />
          ) : rules.data.items.length === 0 ? (
            <p className="text-13 text-muted">No keywords yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {rules.data.items.map((r) => (
                <li
                  key={r.id}
                  className="flex items-start gap-3 rounded-tile border border-hairline bg-surface-card p-3"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-sm font-semibold text-ink">
                      {r.keyword} <span className="font-normal text-muted">· Instagram</span>
                    </span>
                    <span className="truncate text-xs text-muted">{r.replyText}</span>
                    <span className="text-2xs text-muted">
                      {r.queuedCount} queued · {r.eventCount} caught
                    </span>
                  </div>
                  <Switch
                    checked={r.active}
                    disabled={!canManage || update.isPending}
                    aria-label={`Keyword ${r.keyword} ${r.active ? 'on' : 'off'}`}
                    onCheckedChange={(active) => update.mutate({ id: r.id, input: { active } })}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        {canManage ? (
          <form
            className="flex flex-col gap-3 rounded-tile bg-surface-sunken p-4"
            onSubmit={(e) => void onSubmit(e)}
            noValidate
          >
            <Kicker as="h3">Add a keyword</Kicker>
            <Field label="Keyword" required error={formState.errors.keyword}>
              <Input placeholder="CIRCLE" {...register('keyword')} />
            </Field>
            <Field label="Reply" required error={formState.errors.replyText}>
              <Textarea
                rows={2}
                placeholder="Here is the link to start your circle"
                {...register('replyText')}
              />
            </Field>
            <Field
              label="Link"
              hint="Left empty, the post’s tracked link is used."
              error={formState.errors.link}
            >
              <Input
                type="url"
                placeholder="https://live.humini.app/?utm_source=instagram"
                {...register('link')}
              />
            </Field>
            <div>
              <Button type="submit" loading={create.isPending}>
                Add keyword
              </Button>
            </div>
          </form>
        ) : null}

        <section aria-labelledby="kw-events" className="flex flex-col gap-3">
          <Kicker as="h3" id="kw-events">
            Recent comments
          </Kicker>
          {events.isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : events.isError ? (
            <ErrorState
              error={events.error}
              onRetry={() => void events.refetch()}
              className="py-6"
            />
          ) : events.data.items.length === 0 ? (
            <p className="text-13 text-muted">No comments caught yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {events.data.items.map((e) => (
                <li key={e.id} className="flex items-center gap-3 text-13">
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-semibold text-ink">{e.authorHandle ?? 'Someone'}</span>{' '}
                    <span className="text-muted">
                      {e.keyword}
                      {e.briefCode ? ` on ${e.briefCode}` : ''}
                    </span>
                  </span>
                  <StatusChip tone={STATUS_TONE[e.replyStatus]} title={e.error ?? undefined}>
                    {e.replyStatus === 'queued'
                      ? 'Reply queued'
                      : e.replyStatus === 'sent'
                        ? 'Reply sent'
                        : e.replyStatus === 'failed'
                          ? 'Reply failed'
                          : 'Skipped'}
                  </StatusChip>
                </li>
              ))}
            </ul>
          )}
        </section>
      </SheetContent>
    </Sheet>
  );
}
