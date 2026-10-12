/**
 * Knowledge tab: documents Claude reads for this product (files, links, notes, repo specs).
 * Pinned documents go into every Claude prompt in full; the rest go in as summaries.
 * Placeholder design until Jeeva designs Settings.
 */
import {
  ArrowClockwise,
  DotsThreeVertical,
  FileText,
  GithubLogo,
  Link as LinkIcon,
  NotePencil,
  PushPin,
  PushPinSlash,
  Trash,
  UploadSimple,
} from '@phosphor-icons/react';
import * as React from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  MAX_DOCUMENT_BYTES,
  type DocumentKind,
  type ProductDocument,
  type ProductSettingsDetail,
} from '@growth-desk/contract';
import { Button } from '@/components/atoms/Button';
import { IconButton } from '@/components/atoms/IconButton';
import { Input, Textarea } from '@/components/atoms/Input';
import { StatusChip, type StatusTone } from '@/components/atoms/StatusChip';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import { EmptyState } from '@/components/molecules/EmptyState';
import { ErrorState } from '@/components/molecules/ErrorState';
import { Field } from '@/components/molecules/Field';
import { IconTile } from '@/components/molecules/ListRow';
import { Panel } from '@/components/organisms/Panel';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  uploadToStorage,
  useCompleteDocument,
  useCreateDocument,
  useDeleteDocument,
  useDocuments,
  useReprocessDocument,
  useSyncRepo,
  useUpdateDocument,
} from '../api';
import { errorToast, formatBytes, formatDateTime, mimeFor } from '../format';
import { ReadOnlyNote, TabSkeleton } from './shared';

const KIND_ICONS: Record<DocumentKind, typeof FileText> = {
  file: FileText,
  url: LinkIcon,
  repo_spec: GithubLogo,
  note: NotePencil,
};
const KIND_LABELS: Record<DocumentKind, string> = {
  file: 'File',
  url: 'Link',
  repo_spec: 'Repo spec',
  note: 'Note',
};

const STATUS: Record<ProductDocument['status'], { tone: StatusTone; label: string }> = {
  uploading: { tone: 'neutral', label: 'Uploading' },
  processing: { tone: 'joy', label: 'Reading' },
  ready: { tone: 'care', label: 'Ready' },
  failed: { tone: 'danger', label: 'Failed' },
};

export function KnowledgeTab({
  productId,
  settings,
}: {
  productId: string;
  settings: ProductSettingsDetail;
}) {
  const canEdit = settings.canEdit;
  const docs = useDocuments(productId);
  const create = useCreateDocument(productId);
  const complete = useCompleteDocument(productId);
  const sync = useSyncRepo(productId);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const [progress, setProgress] = React.useState<{ name: string; value: number } | null>(null);
  const [dialog, setDialog] = React.useState<'url' | 'note' | null>(null);

  async function onFile(file: File) {
    const mimeType = mimeFor(file);
    if (!mimeType) {
      toast.error('This file type is not supported', {
        description: 'Use PDF, DOCX, Markdown, text or HTML.',
      });
      return;
    }
    if (file.size === 0 || file.size > MAX_DOCUMENT_BYTES) {
      toast.error('File size not allowed', {
        description: 'Files must be between 1 byte and 20 MB.',
      });
      return;
    }
    setProgress({ name: file.name, value: 0 });
    try {
      const out = await create.mutateAsync({
        kind: 'file',
        fileName: file.name,
        mimeType,
        sizeBytes: file.size,
      });
      if (!out.upload) throw new Error('No upload address was returned.');
      await uploadToStorage(out.upload.url, file, out.upload.headers, (v) =>
        setProgress({ name: file.name, value: v }),
      );
      await complete.mutateAsync(out.document.id);
      toast.success(`${file.name} uploaded`, { description: 'Claude is reading it now.' });
    } catch (error) {
      toast.error(...errorToast(error, 'Upload failed'));
    } finally {
      setProgress(null);
    }
  }

  async function onSync() {
    try {
      const r = await sync.mutateAsync();
      toast.success('Repo specs synced', {
        description: `${r.added} added, ${r.updated} updated, ${r.unchanged} unchanged.`,
      });
    } catch (error) {
      toast.error(...errorToast(error, 'Sync failed'));
    }
  }

  const items = docs.data?.items ?? [];
  const pinnedTokens = items
    .filter((d) => d.pinned && d.status === 'ready')
    .reduce((n, d) => n + (d.tokenEstimate ?? 0), 0);
  const repoHint = !settings.features.github
    ? 'GitHub is not connected.'
    : !settings.githubRepo
      ? 'Set the GitHub repo in the Claude and weekly run tab first.'
      : `Reads docs/specs from ${settings.githubRepo}.`;

  return (
    <div className="flex flex-col gap-4">
      <ReadOnlyNote show={!canEdit} />
      <Panel
        title="Knowledge"
        description="Documents Claude reads for this product. Pinned ones go into every prompt in full; the others as short summaries."
        actions={
          canEdit ? (
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                size="sm"
                leftIcon={UploadSimple}
                onClick={() => fileInput.current?.click()}
                disabled={!settings.features.storage || progress !== null}
                title={settings.features.storage ? undefined : 'File storage is not set up'}
              >
                Upload file
              </Button>
              <Button
                size="sm"
                variant="secondary"
                leftIcon={LinkIcon}
                onClick={() => setDialog('url')}
              >
                Add link
              </Button>
              <Button
                size="sm"
                variant="secondary"
                leftIcon={NotePencil}
                onClick={() => setDialog('note')}
              >
                Add note
              </Button>
              <Button
                size="sm"
                variant="secondary"
                leftIcon={GithubLogo}
                onClick={() => void onSync()}
                loading={sync.isPending}
                disabled={!settings.features.github || !settings.githubRepo}
                title={repoHint}
              >
                Sync repo specs
              </Button>
            </div>
          ) : null
        }
      >
        <input
          ref={fileInput}
          type="file"
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose a file to upload"
          accept=".pdf,.docx,.md,.markdown,.txt,.html,.htm"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void onFile(f);
          }}
        />
        <p className="text-xs text-muted">
          {repoHint} Pinned text about {pinnedTokens.toLocaleString('en-IN')} tokens.
          {!settings.features.claude ? (
            <>
              {' '}
              Claude is not connected, so summaries are skipped.{' '}
              <Link
                to="/integrations"
                className="font-semibold text-ink underline underline-offset-2"
              >
                Open Integrations
              </Link>
            </>
          ) : null}
        </p>
        {progress ? (
          <div
            className="flex flex-col gap-1.5 rounded-tile bg-surface-sunken px-4 py-3"
            role="status"
            aria-live="polite"
          >
            <span className="text-13 font-medium text-ink">Uploading {progress.name}</span>
            <div
              className="h-2 overflow-hidden rounded-pill bg-surface-card"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress.value * 100)}
              aria-label="Upload progress"
            >
              <div
                className="h-full rounded-pill bg-joy transition-[width]"
                style={{ width: `${Math.round(progress.value * 100)}%` }}
              />
            </div>
          </div>
        ) : null}
      </Panel>

      {docs.isPending ? (
        <TabSkeleton />
      ) : docs.isError ? (
        <ErrorState
          error={docs.error}
          onRetry={() => void docs.refetch()}
          retrying={docs.isFetching}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No documents yet"
          description="Add the product specs, a pitch deck or a page about the product. Claude uses them for ideas and briefs."
          action={
            canEdit ? (
              <Button
                size="sm"
                variant="secondary"
                leftIcon={NotePencil}
                onClick={() => setDialog('note')}
              >
                Add a note
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Documents">
          {items.map((d) => (
            <DocumentRow key={d.id} doc={d} productId={productId} canEdit={canEdit} />
          ))}
        </ul>
      )}

      <AddLinkDialog
        open={dialog === 'url'}
        onOpenChange={(o) => setDialog(o ? 'url' : null)}
        productId={productId}
      />
      <AddNoteDialog
        open={dialog === 'note'}
        onOpenChange={(o) => setDialog(o ? 'note' : null)}
        productId={productId}
      />
    </div>
  );
}

function DocumentRow({
  doc,
  productId,
  canEdit,
}: {
  doc: ProductDocument;
  productId: string;
  canEdit: boolean;
}) {
  const update = useUpdateDocument(productId);
  const remove = useDeleteDocument(productId);
  const reprocess = useReprocessDocument(productId);
  const [confirm, setConfirm] = React.useState(false);
  const status = STATUS[doc.status];

  const togglePin = () =>
    update.mutate(
      { id: doc.id, patch: { pinned: !doc.pinned } },
      {
        onSuccess: () =>
          toast.success(doc.pinned ? 'Unpinned' : 'Pinned', { description: doc.title }),
        onError: (e) => toast.error(...errorToast(e, 'Not changed')),
      },
    );

  return (
    <li className="flex gap-4 rounded-card border border-hairline bg-surface-card p-5">
      <IconTile icon={KIND_ICONS[doc.kind]} tone={doc.pinned ? 'joy' : 'neutral'} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="min-w-0 truncate text-sm font-semibold text-ink">{doc.title}</h3>
          <StatusChip tone={status.tone} dot>
            {status.label}
          </StatusChip>
          {doc.pinned ? (
            <StatusChip tone="dark" icon={PushPin}>
              Pinned
            </StatusChip>
          ) : null}
        </div>
        <p className="text-xs text-muted">
          {[
            KIND_LABELS[doc.kind],
            doc.tokenEstimate !== null
              ? `about ${doc.tokenEstimate.toLocaleString('en-IN')} tokens`
              : null,
            formatBytes(doc.sizeBytes) || null,
            doc.uploadedBy ? `added by ${doc.uploadedBy.name}` : null,
            formatDateTime(doc.createdAt),
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {doc.sourceUrl ? (
          <a
            href={doc.sourceUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="truncate text-xs font-medium text-ink underline underline-offset-2"
          >
            {doc.sourceUrl}
          </a>
        ) : null}
        {doc.summary ? <p className="line-clamp-3 text-13 text-ink">{doc.summary}</p> : null}
        {doc.error ? (
          <p
            className={
              doc.status === 'failed'
                ? 'text-xs font-medium text-danger-text'
                : 'text-xs text-muted'
            }
          >
            {doc.error}
          </p>
        ) : null}
      </div>
      {canEdit ? (
        <div className="flex shrink-0 items-start gap-1">
          <IconButton
            icon={doc.pinned ? PushPinSlash : PushPin}
            label={doc.pinned ? `Unpin ${doc.title}` : `Pin ${doc.title}`}
            variant="ghost"
            size="sm"
            onClick={togglePin}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                icon={DotsThreeVertical}
                label={`More for ${doc.title}`}
                variant="ghost"
                size="sm"
                tooltip={false}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                disabled={doc.status === 'processing' || doc.status === 'uploading'}
                onSelect={() =>
                  reprocess.mutate(doc.id, {
                    onSuccess: () => toast.success('Reading again', { description: doc.title }),
                    onError: (e) => toast.error(...errorToast(e, 'Not started')),
                  })
                }
              >
                <ArrowClockwise size={16} aria-hidden="true" /> Read again
              </DropdownMenuItem>
              <DropdownMenuItem className="text-danger-text" onSelect={() => setConfirm(true)}>
                <Trash size={16} aria-hidden="true" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Delete this document?"
        description={`"${doc.title}" is removed from Knowledge. Claude stops using it.`}
        confirmLabel="Delete"
        tone="danger"
        onConfirm={async () => {
          try {
            await remove.mutateAsync(doc.id);
            toast.success('Document deleted');
          } catch (e) {
            toast.error(...errorToast(e, 'Not deleted'));
            throw e;
          }
        }}
      />
    </li>
  );
}

function AddLinkDialog({
  open,
  onOpenChange,
  productId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  productId: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* The content unmounts when closed, so the form starts empty every time. */}
      <DialogContent>
        {open ? <AddLinkForm productId={productId} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function AddLinkForm({ productId, onDone }: { productId: string; onDone: () => void }) {
  const create = useCreateDocument(productId);
  const [url, setUrl] = React.useState('');
  const [title, setTitle] = React.useState('');
  const [error, setError] = React.useState<string | undefined>();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^https?:\/\/\S+$/i.test(url.trim())) {
      setError('Use a full web address that starts with https://');
      return;
    }
    try {
      await create.mutateAsync({
        kind: 'url',
        url: url.trim(),
        ...(title.trim() ? { title: title.trim() } : {}),
      });
      toast.success('Link added', { description: 'Growth Desk is reading the page now.' });
      onDone();
    } catch (err) {
      toast.error(...errorToast(err, 'Link not added'));
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Add a link</DialogTitle>
        <DialogDescription>
          A public page about the product. Private and internal addresses are blocked.
        </DialogDescription>
      </DialogHeader>
      <Field label="Web address" required error={error}>
        <Input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://live.humini.app/about"
          autoFocus
        />
      </Field>
      <Field label="Title" hint="Optional. The address is used when empty.">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} />
      </Field>
      <DialogFooter>
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="dark" loading={create.isPending}>
          Add link
        </Button>
      </DialogFooter>
    </form>
  );
}

function AddNoteDialog({
  open,
  onOpenChange,
  productId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  productId: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open ? <AddNoteForm productId={productId} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function AddNoteForm({ productId, onDone }: { productId: string; onDone: () => void }) {
  const create = useCreateDocument(productId);
  const [title, setTitle] = React.useState('');
  const [text, setText] = React.useState('');
  const [pinned, setPinned] = React.useState(false);
  const [errors, setErrors] = React.useState<{ title?: string; text?: string }>({});

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    if (!title.trim()) next.title = 'Give the note a title';
    if (!text.trim()) next.text = 'Write the note';
    setErrors(next);
    if (next.title || next.text) return;
    try {
      await create.mutateAsync({ kind: 'note', title: title.trim(), text: text.trim(), pinned });
      toast.success('Note added');
      onDone();
    } catch (err) {
      toast.error(...errorToast(err, 'Note not added'));
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Add a note</DialogTitle>
        <DialogDescription>
          Facts Claude must know, in plain words. For example the brand line or the tone.
        </DialogDescription>
      </DialogHeader>
      <Field label="Title" required error={errors.title}>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} autoFocus />
      </Field>
      <Field label="Note" required error={errors.text}>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          maxLength={50_000}
        />
      </Field>
      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={pinned}
          onChange={(e) => setPinned(e.target.checked)}
          className="size-4 accent-joy"
        />
        Pin it (Claude reads it in full every time)
      </label>
      <DialogFooter>
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="dark" loading={create.isPending}>
          Add note
        </Button>
      </DialogFooter>
    </form>
  );
}
