/**
 * Approvals tab: approval time limit (SLA hours) and who approves. The claims gate is the
 * product owner with the backup; the brand gate is the brand approver. Reviewers are product
 * members, changed through PRODUCTS' PUT /products/:id/members.
 * Placeholder design until Jeeva designs Settings.
 */
import { Plus, X } from '@phosphor-icons/react';
import * as React from 'react';
import { toast } from 'sonner';
import type { ProductSettingsDetail } from '@growth-desk/contract';
import { Avatar } from '@/components/atoms/Avatar';
import { Button } from '@/components/atoms/Button';
import { IconButton } from '@/components/atoms/IconButton';
import { Input } from '@/components/atoms/Input';
import { ErrorState } from '@/components/molecules/ErrorState';
import { ListRow } from '@/components/molecules/ListRow';
import { Panel } from '@/components/organisms/Panel';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useProductDetail, usePutProductMembers, useTeamList } from '../api';
import { errorToast } from '../format';
import { useSettingsDraft } from '../use-settings-draft';
import { FieldError } from './GeneralTab';
import { ReadOnlyNote, SaveBar, SettingRow, TabSkeleton } from './shared';

const KEYS = ['approvalSlaHours'] as const;

export function ApprovalsTab({
  productId,
  settings,
}: {
  productId: string;
  settings: ProductSettingsDetail;
}) {
  const canEdit = settings.canEdit;
  const form = useSettingsDraft(settings, KEYS, 'approvals');
  const detail = useProductDetail(productId);
  const team = useTeamList();
  const putMembers = usePutProductMembers(productId);
  const [adding, setAdding] = React.useState('');

  if (detail.isPending) return <TabSkeleton />;
  if (detail.isError)
    return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />;

  const product = detail.data;
  const reviewers = product.members.filter((m) => m.productRole === 'reviewer');
  const brandApprovers = team.data?.items.filter((u) => u.isBrandApprover && u.isActive) ?? [];
  const candidates = (team.data?.items ?? []).filter(
    (u) => u.isActive && !reviewers.some((r) => r.user.id === u.id),
  );

  async function setReviewers(nextIds: string[]) {
    const others = product.members
      .filter((m) => m.productRole !== 'reviewer')
      .map((m) => ({ userId: m.user.id, productRole: m.productRole }));
    try {
      await putMembers.mutateAsync({
        members: [
          ...others,
          ...nextIds.map((userId) => ({ userId, productRole: 'reviewer' as const })),
        ],
      });
      toast.success('Reviewers saved');
    } catch (error) {
      toast.error(...errorToast(error, 'Reviewers not saved'));
    }
  }

  const disabled = !canEdit || form.saving;

  return (
    <div className="flex flex-col gap-4">
      <ReadOnlyNote show={!canEdit} />
      <Panel
        title="Time limit"
        description="If an approver does not decide in time, the backup is asked. Nothing is ever approved on its own."
      >
        <SettingRow
          title="Hours to decide"
          help="1 to 720 hours. The default is 24."
          htmlFor="ap-sla"
        >
          <Input
            id="ap-sla"
            type="number"
            min={1}
            max={720}
            value={form.draft.approvalSlaHours}
            onChange={(e) => form.set('approvalSlaHours', Number(e.target.value))}
            disabled={disabled}
            className="w-28"
            aria-invalid={form.errors.approvalSlaHours ? true : undefined}
          />
          {form.errors.approvalSlaHours ? <FieldError text={form.errors.approvalSlaHours} /> : null}
        </SettingRow>
      </Panel>

      <Panel
        title="Claims gate"
        description="Checks every product claim against the specs. Change the owner and backup in General."
      >
        <ul className="flex flex-col">
          <ListRow
            as="li"
            leading={
              <Avatar
                name={product.owner?.name ?? 'To confirm'}
                initials={product.owner?.initials ?? '?'}
              />
            }
            title={product.owner?.name ?? 'To confirm'}
            meta="Product owner, approves"
          />
          <ListRow
            as="li"
            leading={
              <Avatar
                name={product.backup?.name ?? 'No backup'}
                initials={product.backup?.initials ?? '?'}
              />
            }
            title={product.backup?.name ?? 'No backup yet'}
            meta="Backup, asked after the time limit"
          />
        </ul>
      </Panel>

      <Panel
        title="Brand gate"
        description="Checks tone and the brand line. Brand approvers are set by an admin in Integrations, Team."
      >
        {team.isError ? (
          <p className="text-sm text-muted">Could not load the team.</p>
        ) : brandApprovers.length === 0 ? (
          <p className="text-sm text-muted">
            {team.isPending ? 'Loading' : 'No brand approver yet.'}
          </p>
        ) : (
          <ul className="flex flex-col">
            {brandApprovers.map((u) => (
              <ListRow
                as="li"
                key={u.id}
                leading={<Avatar name={u.name} initials={u.initials} />}
                title={u.name}
                meta={u.title ?? 'Brand approver'}
              />
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="Reviewers"
        description="People who check the made piece before it goes for approval."
      >
        {reviewers.length === 0 ? <p className="text-sm text-muted">No reviewers yet.</p> : null}
        <ul className="flex flex-col">
          {reviewers.map((m) => (
            <ListRow
              as="li"
              key={m.id}
              leading={<Avatar name={m.user.name} initials={m.user.initials} />}
              title={m.user.name}
              meta="Reviewer"
              action={
                canEdit ? (
                  <IconButton
                    icon={X}
                    label={`Remove ${m.user.name} as reviewer`}
                    variant="ghost"
                    size="sm"
                    disabled={putMembers.isPending}
                    onClick={() =>
                      void setReviewers(
                        reviewers.filter((r) => r.id !== m.id).map((r) => r.user.id),
                      )
                    }
                  />
                ) : null
              }
            />
          ))}
        </ul>
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={adding}
              onValueChange={setAdding}
              disabled={putMembers.isPending || candidates.length === 0}
            >
              <SelectTrigger className="max-w-xs" aria-label="Person to add as reviewer">
                <SelectValue placeholder={team.isPending ? 'Loading people' : 'Choose a person'} />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {candidates.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="secondary"
              leftIcon={Plus}
              disabled={!adding}
              loading={putMembers.isPending}
              onClick={() => {
                const id = adding;
                setAdding('');
                void setReviewers([...reviewers.map((r) => r.user.id), id]);
              }}
            >
              Add reviewer
            </Button>
          </div>
        ) : null}
      </Panel>
      <SaveBar
        dirty={form.dirty}
        saving={form.saving}
        onSave={() => void form.save()}
        onDiscard={form.discard}
        disabled={!canEdit}
      />
    </div>
  );
}
