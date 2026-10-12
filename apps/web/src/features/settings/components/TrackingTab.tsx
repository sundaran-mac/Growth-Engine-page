/**
 * Tracking tab: UTM campaign prefix, tracking base URL and a live preview of a tracked link.
 * Placeholder design until Jeeva designs Settings.
 */
import { Copy } from '@phosphor-icons/react';
import { toast } from 'sonner';
import type { ProductSettingsDetail } from '@growth-desk/contract';
import { Button } from '@/components/atoms/Button';
import { Input } from '@/components/atoms/Input';
import { Panel } from '@/components/organisms/Panel';
import { buildTrackedLink } from '../format';
import { useSettingsDraft } from '../use-settings-draft';
import { FieldError } from './GeneralTab';
import { ReadOnlyNote, SaveBar, SettingRow } from './shared';

const KEYS = ['utmCampaignPrefix', 'trackingBaseUrl'] as const;

export function TrackingTab({ settings }: { settings: ProductSettingsDetail }) {
  const canEdit = settings.canEdit;
  const form = useSettingsDraft(settings, KEYS, 'tracking');
  const disabled = !canEdit || form.saving;
  const preview = buildTrackedLink({
    baseUrl: form.draft.trackingBaseUrl,
    prefix: form.draft.utmCampaignPrefix,
    platform: 'instagram',
    medium: 'reel',
    theme: 'founder',
    month: new Date(),
    contentCode: 'REEL-031',
  });

  async function copy() {
    if (!preview) return;
    try {
      await navigator.clipboard.writeText(preview);
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy', { description: 'Select the link and copy it by hand.' });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ReadOnlyNote show={!canEdit} />
      <Panel
        title="Tracked links"
        description="Every post link carries UTM tags, so installs and sign-ups trace back to the piece."
      >
        <SettingRow
          title="Campaign prefix"
          help="Lower case, for example live. It starts every utm_campaign."
          htmlFor="tr-prefix"
        >
          <Input
            id="tr-prefix"
            value={form.draft.utmCampaignPrefix ?? ''}
            placeholder="live"
            onChange={(e) =>
              form.set(
                'utmCampaignPrefix',
                e.target.value.trim() === '' ? null : e.target.value.trim(),
              )
            }
            disabled={disabled}
            className="max-w-xs"
            aria-invalid={form.errors.utmCampaignPrefix ? true : undefined}
          />
          {form.errors.utmCampaignPrefix ? (
            <FieldError text={form.errors.utmCampaignPrefix} />
          ) : null}
        </SettingRow>
        <SettingRow
          title="Base URL"
          help="Where tracked links point, for example https://live.humini.app."
          htmlFor="tr-base"
        >
          <Input
            id="tr-base"
            type="url"
            value={form.draft.trackingBaseUrl ?? ''}
            placeholder="https://live.humini.app"
            onChange={(e) =>
              form.set(
                'trackingBaseUrl',
                e.target.value.trim() === '' ? null : e.target.value.trim(),
              )
            }
            disabled={disabled}
            aria-invalid={form.errors.trackingBaseUrl ? true : undefined}
          />
          {form.errors.trackingBaseUrl ? <FieldError text={form.errors.trackingBaseUrl} /> : null}
        </SettingRow>
      </Panel>
      <Panel
        title="Preview"
        description="An Instagram reel, founder theme, this month, brief REEL-031."
      >
        {preview ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <code
              className="min-w-0 flex-1 break-all rounded-tile bg-surface-sunken px-4 py-3 font-mono text-xs text-ink"
              data-testid="tracked-link-preview"
            >
              {preview}
            </code>
            <Button size="sm" variant="secondary" leftIcon={Copy} onClick={() => void copy()}>
              Copy
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted">Set a valid base URL to see the link.</p>
        )}
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
