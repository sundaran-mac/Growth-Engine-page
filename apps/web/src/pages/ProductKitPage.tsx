// Product kit screen (Figma frame 239:1081). Owned by the PRODUCTS agent.
import { ArrowsClockwise, Check, Lightbulb, PencilSimple, Seal } from '@phosphor-icons/react';
import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  updateKitRequestSchema,
  type ProductKitView,
  type UpdateKitRequest,
} from '@growth-desk/contract';
import { Avatar } from '@/components/atoms/Avatar';
import { Button } from '@/components/atoms/Button';
import { IconButton } from '@/components/atoms/IconButton';
import { Icon } from '@/components/atoms/Icon';
import { Input, Textarea } from '@/components/atoms/Input';
import { Kicker } from '@/components/atoms/Kicker';
import { StatusChip } from '@/components/atoms/StatusChip';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import { ErrorState } from '@/components/molecules/ErrorState';
import { Page } from '@/components/templates/Page';
import { Skeleton } from '@/components/ui/skeleton';
import { isApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useSessionStore } from '@/stores/session';
import { useUiStore } from '@/stores/ui';
import {
  useKit,
  useProduct,
  useRefreshKit,
  useSignKit,
  useUpdateKit,
} from '@/features/products/api';
import { ChipEditor, ItemListEditor, LinesEditor } from '@/features/products/components/KitEditors';
import { OwnerBackupDialog } from '@/features/products/components/OwnerBackupDialog';
import { GithubNotConnected, RefreshPanel } from '@/features/products/components/RefreshPanel';
import { shortDate, toastArgs } from '@/features/products/format';

type Draft = Omit<UpdateKitRequest, 'version'>;

function draftOf(kit: ProductKitView): Draft {
  return {
    promise: kit.promise,
    behaviours: kit.behaviours,
    neverSay: kit.neverSay,
    notBuilt: kit.notBuilt,
    audiences: kit.audiences,
    activationEvent: kit.activationEvent,
    truthSources: kit.truthSources,
  };
}

/** White card from the Figma kit (16px bold title). */
function KitCard({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  const id = React.useId();
  return (
    <section
      aria-labelledby={id}
      className={cn(
        'flex flex-col gap-3 rounded-card border border-hairline bg-surface-card p-6',
        className,
      )}
    >
      <h2 id={id} className="text-base font-bold text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

function KitSkeleton() {
  return (
    <div className="flex gap-6" aria-busy="true" aria-label="Loading the kit">
      <div className="flex flex-[1.9] flex-col gap-4">
        <Skeleton className="h-28 rounded-card" />
        <Skeleton className="h-44 rounded-card" />
        <Skeleton className="h-32 rounded-card" />
      </div>
      <div className="flex flex-1 flex-col gap-4">
        <Skeleton className="h-36 rounded-card" />
        <Skeleton className="h-40 rounded-card" />
      </div>
    </div>
  );
}

/** Map server or client field errors ("body.behaviours.1.specRef") to a message per section. */
function sectionErrors(errors: { path: string; message: string }[]) {
  const out: Record<string, string> = {};
  const rows: Record<string, Record<number, string>> = {};
  for (const e of errors) {
    const parts = e.path.replace(/^body\./, '').split('.');
    const key = parts[0] ?? '';
    const idx = parts[1] !== undefined ? Number(parts[1]) : NaN;
    if ((key === 'behaviours' || key === 'notBuilt') && Number.isInteger(idx)) {
      (rows[key] ??= {})[idx] = `${parts[2] === 'specRef' ? 'Spec ref' : 'Text'}: ${e.message}`;
    } else out[key] ??= e.message;
  }
  return { out, rows };
}

export default function ProductKitPage() {
  const { productId = '' } = useParams();
  const kitQuery = useKit(productId);
  const productQuery = useProduct(productId);
  const update = useUpdateKit(productId);
  const sign = useSignKit(productId);
  const refresh = useRefreshKit(productId);
  const user = useSessionStore((s) => s.user);
  const memberships = useSessionStore((s) => s.memberships);
  const setSelectedProductId = useUiStore((s) => s.setSelectedProductId);
  const navigate = useNavigate();

  /** Next step after a signed kit: Ideas, with this product chosen in the switcher. */
  function goToIdeas() {
    setSelectedProductId(productId);
    navigate('/ideas');
  }

  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [errors, setErrors] = React.useState<{ path: string; message: string }[]>([]);
  const [confirmSign, setConfirmSign] = React.useState(false);
  const [confirmDiscard, setConfirmDiscard] = React.useState(false);
  const [ownerDialog, setOwnerDialog] = React.useState(false);
  const [githubOff, setGithubOff] = React.useState<string | null>(null);

  const kit = kitQuery.data;
  const product = productQuery.data;
  const name = product?.name ?? 'Product';
  const canChangeOwner =
    user?.role === 'admin' ||
    memberships.some((m) => m.productId === productId && m.productRole === 'owner');

  const dirty = Boolean(kit && draft && JSON.stringify(draftOf(kit)) !== JSON.stringify(draft));

  function startEdit() {
    if (!kit) return;
    setDraft(draftOf(kit));
    setErrors([]);
    setEditing(true);
  }

  function stopEdit() {
    setEditing(false);
    setDraft(null);
    setErrors([]);
  }

  async function save() {
    if (!kit || !draft) return;
    const body = {
      version: kit.version,
      ...draft,
      behaviours: draft.behaviours.filter((b) => b.text.trim() || b.specRef),
      notBuilt: draft.notBuilt.filter((b) => b.text.trim() || b.specRef),
      truthSources: draft.truthSources.map((s) => s.trim()).filter(Boolean),
      promise: draft.promise?.trim() ? draft.promise : null,
      activationEvent: draft.activationEvent?.trim() ? draft.activationEvent : null,
    };
    const check = updateKitRequestSchema.safeParse(body);
    if (!check.success) {
      setErrors(check.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
      toast.error('Check the kit', { description: 'Some fields need a fix before saving.' });
      return;
    }
    try {
      const saved = await update.mutateAsync(check.data);
      toast.success(
        saved.version > kit.version ? `Saved as version ${saved.version}` : 'Kit saved',
        saved.status === 'draft' && kit.status === 'signed'
          ? { description: 'The kit changed after signing, so it needs the owner to sign again.' }
          : {},
      );
      stopEdit();
    } catch (error) {
      if (isApiError(error) && error.code === 'KIT_VERSION_CONFLICT') {
        toast.error('Someone changed the kit', {
          description: 'Your edits are still here. Reload to see the new version, then edit again.',
          action: { label: 'Reload', onClick: () => void kitQuery.refetch() },
        });
        return;
      }
      if (isApiError(error) && error.errors.length > 0) setErrors(error.errors);
      toast.error(...toastArgs(error));
    }
  }

  async function doSign() {
    try {
      const signed = await sign.mutateAsync();
      toast.success(`Kit version ${signed.version} signed`, {
        description: 'Ideas can now start from this kit.',
        action: { label: 'Go to ideas', onClick: goToIdeas },
      });
    } catch (error) {
      toast.error(...toastArgs(error));
      throw error;
    }
  }

  async function doRefresh() {
    try {
      const result = await refresh.mutateAsync();
      setGithubOff(null);
      const n = result.changes.length;
      toast.success(
        n === 0 ? 'No spec changes found' : `${n} spec ${n === 1 ? 'file' : 'files'} to check`,
      );
    } catch (error) {
      if (isApiError(error) && error.code === 'FEATURE_DISABLED') {
        setGithubOff(error.detail ?? '');
        return;
      }
      toast.error(...toastArgs(error));
    }
  }

  const subtitle = kit
    ? kit.status === 'signed' && kit.signedAt
      ? `The truth every post starts from · signed by ${kit.signedBy?.name ?? 'the owner'} on ${shortDate(kit.signedAt)}`
      : `The truth every post starts from · version ${kit.version} is a draft, not signed yet`
    : 'The truth every post starts from';

  const actions = !kit ? null : editing ? (
    <>
      <Button
        variant="secondary"
        onClick={() => (dirty ? setConfirmDiscard(true) : stopEdit())}
        disabled={update.isPending}
      >
        Cancel
      </Button>
      <Button leftIcon={Check} onClick={() => void save()} loading={update.isPending}>
        Save kit
      </Button>
    </>
  ) : (
    <>
      {kit.canEdit ? (
        <Button
          variant="secondary"
          leftIcon={ArrowsClockwise}
          onClick={() => void doRefresh()}
          loading={refresh.isPending}
        >
          Refresh from repo
        </Button>
      ) : null}
      {kit.canEdit ? (
        <IconButton
          icon={PencilSimple}
          label="Edit kit"
          onClick={startEdit}
          className="size-11 border-[1.5px] border-strong"
        />
      ) : null}
      {kit.status === 'draft' && kit.canSign ? (
        <Button leftIcon={Seal} onClick={() => setConfirmSign(true)}>
          Sign kit
        </Button>
      ) : kit.status === 'signed' ? (
        <Button leftIcon={Lightbulb} onClick={goToIdeas}>
          Go to ideas
        </Button>
      ) : (
        <StatusChip tone="reminder">Waiting for the owner to sign</StatusChip>
      )}
    </>
  );

  const errs = sectionErrors(errors);
  const d = draft;

  return (
    <Page
      title={`${name} · product kit`}
      documentTitle={`${name} kit`}
      subtitle={subtitle}
      actions={actions}
    >
      {kitQuery.isPending ? (
        <KitSkeleton />
      ) : kitQuery.isError ? (
        <ErrorState
          error={kitQuery.error}
          onRetry={() => void kitQuery.refetch()}
          retrying={kitQuery.isFetching}
        />
      ) : kit ? (
        <>
          {githubOff !== null ? <GithubNotConnected detail={githubOff || undefined} /> : null}
          {kit.lastRefresh && githubOff === null ? <RefreshPanel result={kit.lastRefresh} /> : null}
          <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
            {/* Left column (700 in Figma) */}
            <div className="flex min-w-0 flex-col gap-4 xl:flex-[1.9]">
              <section
                aria-labelledby="kit-promise"
                className="flex flex-col gap-3 rounded-card bg-joy-soft p-6"
              >
                <div className="flex items-center justify-between gap-3">
                  <Kicker as="h2" size="sm" tone="joy" id="kit-promise">
                    Promise
                  </Kicker>
                  {kit.status === 'signed' && !editing ? (
                    <StatusChip tone="care" icon={Seal}>
                      Signed · v{kit.version}
                    </StatusChip>
                  ) : null}
                </div>
                {editing && d ? (
                  <>
                    <Textarea
                      aria-labelledby="kit-promise"
                      value={d.promise ?? ''}
                      maxLength={300}
                      onChange={(e) => setDraft({ ...d, promise: e.target.value })}
                      className="text-lg font-bold"
                    />
                    {errs.out.promise ? (
                      <p className="text-xs text-danger-text">{errs.out.promise}</p>
                    ) : null}
                  </>
                ) : (
                  <p className="text-[24px] font-bold leading-[1.4] text-ink">
                    {kit.promise ?? 'Not written yet.'}
                  </p>
                )}
              </section>

              <KitCard title="Three true behaviours">
                {editing && d ? (
                  <ItemListEditor
                    label="Behaviour"
                    items={d.behaviours}
                    onChange={(behaviours) => setDraft({ ...d, behaviours })}
                    max={10}
                    addLabel="Add behaviour"
                    errors={errs.rows.behaviours}
                  />
                ) : kit.behaviours.length === 0 ? (
                  <p className="text-sm text-muted">
                    No behaviours yet. Every behaviour needs a spec behind it.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {kit.behaviours.map((b, i) => (
                      <li key={i} className="flex items-center gap-3">
                        <Icon icon={Check} size={18} className="text-care" />
                        <span className="flex-1 text-sm text-ink">{b.text}</span>
                        {b.specRef ? (
                          <StatusChip tone="neutral" className="text-muted">
                            spec {b.specRef}
                          </StatusChip>
                        ) : (
                          <StatusChip tone="danger">no spec</StatusChip>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </KitCard>

              <KitCard title="Never say">
                {editing && d ? (
                  <>
                    <ChipEditor
                      label="Never say"
                      values={d.neverSay}
                      onChange={(neverSay) => setDraft({ ...d, neverSay })}
                      tone="danger"
                      placeholder="Add a word or phrase"
                    />
                    {errs.out.neverSay ? (
                      <p className="text-xs text-danger-text">{errs.out.neverSay}</p>
                    ) : null}
                  </>
                ) : kit.neverSay.length === 0 ? (
                  <p className="text-sm text-muted">No never-say words yet.</p>
                ) : (
                  <ul className="flex flex-wrap gap-2">
                    {kit.neverSay.map((w) => (
                      <li key={w}>
                        <StatusChip tone="danger">{w}</StatusChip>
                      </li>
                    ))}
                  </ul>
                )}
              </KitCard>

              <KitCard title="Not built yet · no post may show it">
                {editing && d ? (
                  <ItemListEditor
                    label="Not built item"
                    items={d.notBuilt}
                    onChange={(notBuilt) => setDraft({ ...d, notBuilt })}
                    max={30}
                    addLabel="Add item"
                    errors={errs.rows.notBuilt}
                  />
                ) : kit.notBuilt.length === 0 ? (
                  <p className="text-sm text-muted">Nothing listed.</p>
                ) : (
                  <p className="text-sm text-muted">
                    {kit.notBuilt
                      .map((n) => (n.specRef ? `${n.text} (spec ${n.specRef})` : n.text))
                      .join(' · ')}
                  </p>
                )}
              </KitCard>
            </div>

            {/* Right column (372 in Figma) */}
            <div className="flex min-w-0 flex-col gap-4 xl:flex-1">
              <KitCard title="Owner">
                <div className="flex items-center gap-2.5">
                  <Avatar
                    name={kit.owner?.name ?? 'Owner'}
                    initials={kit.owner ? kit.owner.initials : '?'}
                  />
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold text-ink">
                      {kit.owner?.name ?? 'Owner'}
                    </span>
                    <span className="text-xs text-muted">
                      {kit.owner ? 'Signs the kit · claims gate' : 'To confirm'}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2.5">
                  <Avatar
                    name={kit.backup?.name ?? 'Backup'}
                    initials={kit.backup ? kit.backup.initials : '?'}
                  />
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold text-ink">
                      {kit.backup?.name ?? 'Backup'}
                    </span>
                    <span className="text-xs text-muted">
                      {kit.backup ? 'Decides after 24 hours' : 'To name'}
                    </span>
                  </div>
                </div>
                {canChangeOwner ? (
                  <Button
                    variant="link"
                    size="sm"
                    className="self-start px-0"
                    onClick={() => setOwnerDialog(true)}
                  >
                    Change owner or backup
                  </Button>
                ) : null}
              </KitCard>

              <KitCard title="Truth sources">
                {editing && d ? (
                  <LinesEditor
                    label="Truth source"
                    values={d.truthSources}
                    onChange={(truthSources) => setDraft({ ...d, truthSources })}
                    max={30}
                  />
                ) : kit.truthSources.length === 0 ? (
                  <p className="text-13 text-muted">No sources yet.</p>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {kit.truthSources.map((s) => (
                      <li key={s} className="text-13 text-muted">
                        · {s}
                      </li>
                    ))}
                  </ul>
                )}
              </KitCard>

              <KitCard title="Who it is for">
                {editing && d ? (
                  <ChipEditor
                    label="Who it is for"
                    values={d.audiences}
                    onChange={(audiences) => setDraft({ ...d, audiences })}
                    tone="joy"
                    placeholder="Add an audience"
                  />
                ) : kit.audiences.length === 0 ? (
                  <p className="text-13 text-muted">No audiences yet.</p>
                ) : (
                  <ul className="flex flex-wrap gap-2">
                    {kit.audiences.map((a) => (
                      <li key={a}>
                        <StatusChip tone="joy">{a}</StatusChip>
                      </li>
                    ))}
                  </ul>
                )}
              </KitCard>

              <section
                aria-labelledby="kit-activation"
                className="flex flex-col gap-3 rounded-card bg-media-canvas p-6"
              >
                <Kicker as="h2" size="sm" id="kit-activation" className="text-joy">
                  Activation event
                </Kicker>
                {editing && d ? (
                  <Input
                    aria-labelledby="kit-activation"
                    value={d.activationEvent ?? ''}
                    maxLength={200}
                    onChange={(e) => setDraft({ ...d, activationEvent: e.target.value })}
                  />
                ) : (
                  <p className="text-base font-bold text-media-text">
                    {kit.activationEvent ?? 'Not set yet.'}
                  </p>
                )}
              </section>

              <KitCard title={`Kit ${kit.score}/10`}>
                <ul className="flex flex-col gap-1.5">
                  {kit.fields.map((f) => (
                    <li
                      key={f.key}
                      className={cn(
                        'flex items-center gap-2 text-13',
                        f.done ? 'text-ink' : 'text-muted',
                      )}
                    >
                      <Icon
                        icon={Check}
                        size={14}
                        className={f.done ? 'text-care' : 'text-strong'}
                      />
                      {f.label}
                      <span className="sr-only">{f.done ? '(done)' : '(missing)'}</span>
                    </li>
                  ))}
                </ul>
              </KitCard>
            </div>
          </div>
          {productQuery.isError ? (
            <p className="text-xs text-muted">
              Could not load the product details.{' '}
              <Link to="/products" className="underline">
                Back to Products
              </Link>
            </p>
          ) : null}
        </>
      ) : null}

      <ConfirmDialog
        open={confirmSign}
        onOpenChange={setConfirmSign}
        title={`Sign kit version ${kit?.version ?? ''}?`}
        description="You confirm every behaviour is true, with a spec behind it. Posts start from this kit. Any later edit needs a new signature."
        confirmLabel="Sign kit"
        onConfirm={doSign}
      />
      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="Discard your changes?"
        description="Your edits to the kit are not saved."
        confirmLabel="Discard"
        tone="danger"
        onConfirm={stopEdit}
      />
      {product && ownerDialog ? (
        <OwnerBackupDialog
          productId={productId}
          owner={product.owner}
          backup={product.backup}
          open={ownerDialog}
          onOpenChange={(o) => {
            setOwnerDialog(o);
            if (!o) void kitQuery.refetch();
          }}
        />
      ) : null}
    </Page>
  );
}
