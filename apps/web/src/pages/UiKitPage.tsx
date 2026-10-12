/**
 * Dev-only component kit (route /kit, only when import.meta.env.DEV). Mirrors Figma frame 237:674
 * so the lead can check every atom and molecule by eye. Owned by FOUNDATION-WEB.
 */
import {
  ArrowRight,
  Bell,
  CalendarBlank,
  ChartLineUp,
  ChatCircle,
  Check,
  Clock,
  Eye,
  FacebookLogo,
  FilmStrip,
  Handshake,
  Heart,
  HouseSimple,
  InstagramLogo,
  Lightbulb,
  LinkedinLogo,
  MagnifyingGlass,
  NotePencil,
  PaperPlaneTilt,
  PlugsConnected,
  Plus,
  SealCheck,
  Sparkle,
  Stack,
  User,
  Users,
  Warning,
  WhatsappLogo,
  X,
  YoutubeLogo,
} from '@phosphor-icons/react';
import * as React from 'react';
import {
  Avatar,
  Button,
  Icon,
  IconButton,
  Input,
  Kbd,
  Kicker,
  SearchInput,
  Spinner,
  StatusChip,
  Textarea,
} from '@/components/atoms';
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  KeyValue,
  KeyValueList,
  ListRow,
  NavItemView,
  ProductDot,
  StatTile,
} from '@/components/molecules';
import { DataTable, PageHeader, Panel } from '@/components/organisms';
import { Page } from '@/components/templates/Page';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';

const ICONS = [
  HouseSimple,
  Stack,
  Lightbulb,
  CalendarBlank,
  NotePencil,
  FilmStrip,
  Eye,
  SealCheck,
  PaperPlaneTilt,
  ChartLineUp,
  Handshake,
  PlugsConnected,
  MagnifyingGlass,
  Bell,
  Plus,
  Sparkle,
  Check,
  X,
  ArrowRight,
  InstagramLogo,
  FacebookLogo,
  YoutubeLogo,
  LinkedinLogo,
  WhatsappLogo,
  Heart,
  ChatCircle,
  User,
  Users,
  Clock,
  Warning,
];

interface ChannelRow {
  id: string;
  channel: string;
  format: string;
  when: string;
  how: string;
  tone: 'scheduled' | 'reminder' | 'neutral';
}
const ROWS: ChannelRow[] = [
  {
    id: '1',
    channel: 'Instagram Reel',
    format: '9:16 · 58 s',
    when: 'Thu 7:30 pm IST',
    how: 'Auto · Meta API',
    tone: 'scheduled',
  },
  {
    id: '2',
    channel: 'LinkedIn · Elan',
    format: '4:5 native',
    when: 'Tue 8:30 am IST',
    how: 'Needs API approval',
    tone: 'neutral',
  },
  {
    id: '3',
    channel: 'WhatsApp Channel',
    format: '9:16 file',
    when: 'Thu 9:00 pm IST',
    how: 'Reminder · by hand',
    tone: 'reminder',
  },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Panel title={title}>
      <div className="flex flex-wrap items-center gap-4">{children}</div>
    </Panel>
  );
}

export default function UiKitPage() {
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  return (
    <Page
      title="Component kit"
      subtitle="Dev only · mirrors Figma 237:674"
      actions={<Button leftIcon={Plus}>New idea</Button>}
    >
      <Kicker tone="joy">Growth Desk · component kit</Kicker>

      <Section title="Icons (Phosphor, 24px)">
        {ICONS.map((glyph, i) => (
          <Icon key={i} icon={glyph} size={24} />
        ))}
      </Section>

      <Section title="Nav item">
        <div className="flex w-[264px] flex-col gap-1 rounded-card bg-media-canvas p-6">
          <NavItemView icon={HouseSimple} label="Label" />
          <NavItemView icon={HouseSimple} label="Label" active />
          <NavItemView icon={SealCheck} label="Approvals" count={3} />
        </div>
      </Section>

      <Section title="Buttons">
        <Button>Primary action</Button>
        <Button variant="dark">Dark action</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Delete</Button>
        <Button size="sm">Small</Button>
        <Button size="lg" rightIcon={ArrowRight}>
          Large
        </Button>
        <Button loading>Saving</Button>
        <Button disabled>Disabled</Button>
        <IconButton icon={Bell} label="Notifications" />
        <IconButton icon={X} label="Close" variant="ghost" />
        <IconButton icon={Plus} label="Add" variant="primary" />
      </Section>

      <Section title="Status chips">
        <StatusChip tone="scheduled">Scheduled · auto</StatusChip>
        <StatusChip tone="reminder">Reminder · post by hand</StatusChip>
        <StatusChip tone="neutral">Draft</StatusChip>
        <StatusChip tone="success" icon={Check}>
          Matches
        </StatusChip>
        <StatusChip tone="danger" dot>
          Failed
        </StatusChip>
        <StatusChip tone="dark">Human gate</StatusChip>
      </Section>

      <Section title="Avatar, dots, kicker, kbd, spinner">
        <Avatar name="Jeeva Santiago" size="sm" />
        <Avatar name="Jeeva Santiago" />
        <Avatar name="Elan" size="lg" />
        <ProductDot color="#ff9a00" name="Humini Live" meta="9 pieces this week" />
        <ProductDot color="#3e7568" name="Humini Pulse" meta="4 pieces this week" />
        <ProductDot name="Humini Proof" meta="Kit in progress" />
        <Kicker>Reach · 7 days</Kicker>
        <Kicker size="sm">Make</Kicker>
        <Kbd>⌘K</Kbd>
        <Spinner />
      </Section>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatTile label="Reach · 7 days" value="48.2k" delta="+12% vs last week" />
        <StatTile label="Installs" value="214" delta="+8% vs last week" deltaTone="care" />
        <StatTile
          label="Value / 1k reach"
          value="86"
          delta="Best: founder films"
          deltaTone="muted"
        />
        <StatTile label="Loading" value="0" loading />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,680px)_minmax(0,1fr)]">
        <Panel title="Needs you">
          <ListRow
            icon={SealCheck}
            title="Approve claims · REEL-031 “60 seconds with Elan”"
            meta="Live · owner approval · waiting 6 h"
            action={<Button>Review</Button>}
          />
          <ListRow
            icon={CalendarBlank}
            title="Freeze the November plan"
            meta="Live · 14 pieces · 2 founder films unbooked"
            action={<Button variant="secondary">Open plan</Button>}
          />
        </Panel>
        <Panel
          tone="dark"
          title="Claude this week"
          titleIcon={<Icon icon={Sparkle} className="text-joy" />}
        >
          <p className="text-sm">16 new ideas drafted: 10 for Live, 6 for Pulse.</p>
          <div>
            <Button rightIcon={ArrowRight}>Open ideas</Button>
          </div>
        </Panel>
      </div>

      <Panel title="Form controls">
        <PageHeader
          title="Section header"
          description="PageHeader inside content"
          actions={
            <Button size="sm" variant="secondary">
              Action
            </Button>
          }
        />
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Hook" hint="0 to 2 seconds" required>
            <Input placeholder="You are not a bad friend." />
          </Field>
          <Field label="Email" error="Enter a valid email">
            <Input defaultValue="jeeva@" />
          </Field>
          <Field label="Beat 1">
            <Textarea placeholder="A catch-up call runs 30 minutes" />
          </Field>
          <div className="flex flex-col gap-4">
            <SearchInput placeholder="Search everything" />
            <Field label="Mode">
              <Select defaultValue="m1">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="m1">M1 Founder</SelectItem>
                  <SelectItem value="m2">M2 AI people</SelectItem>
                  <SelectItem value="m3">M3 Motion</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Checkbox id="kit-check" defaultChecked />
                <Label htmlFor="kit-check">Claim check passed</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="kit-switch" defaultChecked />
                <Label htmlFor="kit-switch">Auto publish</Label>
              </div>
            </div>
          </div>
        </div>
        <KeyValueList className="grid grid-cols-3">
          <KeyValue label="Owner" value="Elan" />
          <KeyValue label="This month" value="36 pieces · 214 installs" />
          <KeyValue label="Next step" value="Intro call · Thu" />
        </KeyValueList>
      </Panel>

      <Panel title="Tabs, menu, dialog, toasts">
        <Tabs defaultValue="reel">
          <TabsList>
            <TabsTrigger value="reel">Reel</TabsTrigger>
            <TabsTrigger value="posters">Posters</TabsTrigger>
            <TabsTrigger value="captions">Captions</TabsTrigger>
          </TabsList>
          <TabsContent value="reel" className="text-sm text-muted">
            Reel tab content
          </TabsContent>
          <TabsContent value="posters" className="text-sm text-muted">
            Posters tab content
          </TabsContent>
          <TabsContent value="captions" className="text-sm text-muted">
            Captions tab content
          </TabsContent>
        </Tabs>
        <div className="flex flex-wrap gap-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary">Open menu</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem>Star</DropdownMenuItem>
              <DropdownMenuItem>Park</DropdownMenuItem>
              <DropdownMenuItem destructive>Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="dark" onClick={() => setConfirmOpen(true)}>
            Request changes
          </Button>
          <Button
            variant="ghost"
            onClick={() => toast.success('Saved', { description: 'Brief frozen.' })}
          >
            Success toast
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              toast.error('Something went wrong', { description: 'Please try again.' })
            }
          >
            Error toast
          </Button>
        </div>
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title="Request changes?"
          description="It goes back to the brief with your note."
          confirmLabel="Request changes"
          onConfirm={() => new Promise((r) => setTimeout(r, 600))}
        />
      </Panel>

      <Panel title="Data table" flush className="pb-2">
        <DataTable
          caption="Channels for REEL-031"
          rows={ROWS}
          getRowId={(r) => r.id}
          onRowClick={(r) => toast(`${r.channel} clicked`)}
          columns={[
            {
              id: 'channel',
              header: 'Channel',
              cell: (r) => <span className="font-semibold">{r.channel}</span>,
            },
            { id: 'format', header: 'Format', cell: (r) => r.format },
            { id: 'when', header: 'When (audience time)', cell: (r) => r.when },
            {
              id: 'how',
              header: 'How',
              align: 'right',
              cell: (r) => <StatusChip tone={r.tone}>{r.how}</StatusChip>,
            },
          ]}
        />
      </Panel>

      <Panel
        title="Data table · Figma look, rows stagger in"
        description="Publish frame 242:1131: sunken header strip, rows ease in one after another."
      >
        <DataTable
          look="figma"
          stagger
          caption="Channels for REEL-031 (Figma look)"
          rows={ROWS}
          getRowId={(r) => r.id}
          onRowClick={(r) => toast(`${r.channel} clicked`)}
          columns={[
            {
              id: 'channel',
              header: 'Channel',
              cell: (r) => <span className="font-semibold">{r.channel}</span>,
            },
            { id: 'format', header: 'Format', cell: (r) => r.format },
            { id: 'when', header: 'When (audience time)', cell: (r) => r.when },
            {
              id: 'how',
              header: 'How',
              align: 'right',
              cell: (r) => <StatusChip tone={r.tone}>{r.how}</StatusChip>,
            },
          ]}
        />
      </Panel>

      <div className="grid gap-6 xl:grid-cols-2">
        <EmptyState
          title="Being built"
          description="This screen is being built."
          action={<Button variant="secondary">Back home</Button>}
        />
        <ErrorState
          error={
            new ApiError({
              status: 503,
              code: 'HTTP_503',
              title: 'Service not available',
              detail: 'Please try again in a moment.',
            })
          }
          onRetry={() => toast('Retrying')}
        />
      </div>
    </Page>
  );
}
