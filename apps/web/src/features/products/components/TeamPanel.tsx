import { Copy, UserPlus } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { toast } from 'sonner';
import {
  PRODUCT_ROLES,
  ROLES,
  type ProductDetail,
  type ProductRole,
  type ProductSummary,
  type Role,
  type TeamMember,
} from '@growth-desk/contract';
import { Avatar } from '@/components/atoms/Avatar';
import { Button } from '@/components/atoms/Button';
import { Input } from '@/components/atoms/Input';
import { StatusChip } from '@/components/atoms/StatusChip';
import { ErrorState } from '@/components/molecules/ErrorState';
import { Field } from '@/components/molecules/Field';
import { Panel } from '@/components/organisms/Panel';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { useSessionStore } from '@/stores/session';
import { productKeys, useCreateUser, useProducts, useTeam, useUpdateUser } from '../api';
import { toastArgs } from '../format';

const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  editor: 'Editor',
  member: 'Member',
  viewer: 'Viewer',
};

const PRODUCT_ROLE_LABELS: Record<ProductRole, string> = {
  owner: 'Owner',
  backup: 'Backup',
  maker: 'Maker',
  reviewer: 'Reviewer',
};

/** "Brand approver · founder voice" style line under a name. */
function personLine(p: TeamMember): string {
  const bits: string[] = [];
  if (p.isBrandApprover) bits.push('Brand approver');
  if (p.title) bits.push(p.title);
  const owns = p.memberships.filter((m) => m.productRole === 'owner').map((m) => m.productName);
  if (owns.length > 0 && !p.title?.toLowerCase().includes('owner'))
    bits.push(`Owner · ${owns.join(', ')}`);
  if (p.backupFor.length > 0)
    bits.push(`Backup for ${p.backupFor.map((b) => b.productName).join(', ')}`);
  if (!p.isActive) bits.push('Turned off');
  return bits.join(' · ') || ROLE_LABELS[p.role];
}

/** Team and roles (Figma 242:1642, bottom panel). Admins open a person to change them. */
export function TeamPanel() {
  const team = useTeam();
  const isAdmin = useSessionStore((s) => s.user?.role === 'admin');
  const [selected, setSelected] = React.useState<TeamMember | null>(null);
  const [inviting, setInviting] = React.useState(false);

  return (
    <Panel
      title="Team and roles"
      description={
        isAdmin ? 'Open a person to change their role, products and backups.' : undefined
      }
      actions={
        isAdmin ? (
          <Button
            variant="secondary"
            size="sm"
            leftIcon={UserPlus}
            onClick={() => setInviting(true)}
          >
            Invite person
          </Button>
        ) : null
      }
    >
      {team.isPending ? (
        <div className="flex flex-wrap gap-6" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-10 w-48" />
          ))}
        </div>
      ) : team.isError ? (
        <ErrorState error={team.error} onRetry={() => void team.refetch()} />
      ) : (
        <ul className="flex flex-wrap gap-x-6 gap-y-4">
          {team.data.items.map((p) => {
            const body = (
              <>
                <Avatar name={p.name} initials={p.initials} />
                <span className="flex min-w-0 flex-col text-left">
                  <span className="truncate text-13 font-semibold text-ink">{p.name}</span>
                  <span className="truncate text-xs text-muted">{personLine(p)}</span>
                </span>
              </>
            );
            return (
              <li key={p.id}>
                {isAdmin ? (
                  <button
                    type="button"
                    onClick={() => setSelected(p)}
                    className="focus-ring flex items-center gap-2.5 rounded-tile p-1 hover:bg-surface-sunken"
                    aria-label={`Change ${p.name}`}
                  >
                    {body}
                  </button>
                ) : (
                  <div className="flex items-center gap-2.5 p-1">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {selected ? <PersonDialog person={selected} onClose={() => setSelected(null)} /> : null}
      {inviting ? <InviteDialog open onOpenChange={setInviting} /> : null}
    </Panel>
  );
}

/* ---------- Invite ---------- */

function InviteDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const create = useCreateUser();
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [title, setTitle] = React.useState('');
  const [role, setRole] = React.useState<Role>('member');
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [created, setCreated] = React.useState<{
    name: string;
    email: string;
    tempPassword: string;
  } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'Enter a name';
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) next.email = 'Enter a valid email';
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    try {
      const res = await create.mutateAsync({ name, email, title: title || null, role });
      setCreated({ name: res.user.name, email: res.user.email, tempPassword: res.tempPassword });
      toast.success(`${res.user.name} invited`);
    } catch (error) {
      toast.error(...toastArgs(error));
    }
  }

  async function copy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.tempPassword);
      toast.success('Password copied');
    } catch {
      toast.error('Could not copy. Select the password and copy it by hand.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (create.isPending ? undefined : onOpenChange(o))}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{created ? 'Share the temporary password' : 'Invite a person'}</DialogTitle>
          <DialogDescription>
            {created
              ? 'This password is shown only once. Send it to the person in a private message.'
              : 'Growth Desk creates the account with a temporary password.'}
          </DialogDescription>
        </DialogHeader>
        {created ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-ink">
              {created.name} · {created.email}
            </p>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={created.tempPassword}
                aria-label="Temporary password"
                className="font-mono"
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button variant="secondary" size="sm" leftIcon={Copy} onClick={() => void copy()}>
                Copy
              </Button>
            </div>
          </div>
        ) : (
          <form
            id="invite-person"
            onSubmit={(e) => void submit(e)}
            className="flex flex-col gap-4"
            noValidate
          >
            <Field label="Name" required error={errors.name}>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                autoFocus
              />
            </Field>
            <Field label="Email" required error={errors.email}>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={200}
              />
            </Field>
            <Field label="What they do" hint="For example: Motion · automation admin">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
            </Field>
            <Field label="Role">
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </form>
        )}
        <DialogFooter>
          {created ? (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          ) : (
            <>
              <Button
                variant="secondary"
                onClick={() => onOpenChange(false)}
                disabled={create.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" form="invite-person" loading={create.isPending}>
                Invite
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Change a person ---------- */

type RoleMap = Record<string, ProductRole[]>;

function rolesByProduct(p: TeamMember): RoleMap {
  const map: RoleMap = {};
  for (const m of p.memberships) (map[m.productId] ??= []).push(m.productRole);
  return map;
}

function PersonDialog({ person, onClose }: { person: TeamMember; onClose: () => void }) {
  const qc = useQueryClient();
  const products = useProducts();
  const updateUser = useUpdateUser();
  const me = useSessionStore((s) => s.user);
  const [role, setRole] = React.useState<Role>(person.role);
  const [brand, setBrand] = React.useState(person.isBrandApprover);
  const [active, setActive] = React.useState(person.isActive);
  const [roles, setRoles] = React.useState<RoleMap>(() => rolesByProduct(person));
  const [backupFor, setBackupFor] = React.useState<Set<string>>(
    () => new Set(person.backupFor.map((b) => b.productId)),
  );
  const [saving, setSaving] = React.useState(false);
  const isSelf = me?.id === person.id;

  function toggleRole(productId: string, r: ProductRole, on: boolean) {
    setRoles((old) => {
      const cur = new Set(old[productId] ?? []);
      if (on) cur.add(r);
      else cur.delete(r);
      return { ...old, [productId]: [...cur] };
    });
  }

  async function saveProduct(product: ProductSummary) {
    const id = product.id;
    const wantBackup = backupFor.has(id);
    const wasBackup = product.backup?.id === person.id;
    // 1. Named backup first (the server keeps the backup membership in step).
    if (wantBackup !== wasBackup) {
      await api(`/products/${id}`, {
        method: 'PATCH',
        body: { backupId: wantBackup ? person.id : null },
      });
    }
    // 2. Then this person's roles, keeping everyone else as they are.
    const before = new Set(rolesByProduct(person)[id] ?? []);
    const want = new Set(roles[id] ?? []);
    if (wantBackup) want.add('backup');
    if (!wantBackup && wasBackup) want.delete('backup');
    const changed = before.size !== want.size || [...want].some((r) => !before.has(r));
    if (!changed) return wantBackup !== wasBackup;
    const detail = await qc.fetchQuery({
      queryKey: productKeys.detail(id),
      queryFn: () => api<ProductDetail>(`/products/${id}`),
      staleTime: 0,
    });
    const others = detail.members
      .filter((m) => m.user.id !== person.id)
      .map((m) => ({ userId: m.user.id, productRole: m.productRole }));
    const mine = [...want].map((productRole) => ({ userId: person.id, productRole }));
    await api(`/products/${id}/members`, {
      method: 'PUT',
      body: { members: [...others, ...mine] },
    });
    return true;
  }

  async function save() {
    setSaving(true);
    try {
      const patch: Record<string, unknown> = {};
      if (role !== person.role) patch.role = role;
      if (brand !== person.isBrandApprover) patch.isBrandApprover = brand;
      if (active !== person.isActive) patch.isActive = active;
      if (Object.keys(patch).length > 0)
        await updateUser.mutateAsync({ id: person.id, body: patch });
      let productsChanged = false;
      for (const product of products.data?.items ?? []) {
        if (await saveProduct(product)) productsChanged = true;
      }
      if (productsChanged) {
        await Promise.all([
          qc.invalidateQueries({ queryKey: productKeys.all }),
          qc.invalidateQueries({ queryKey: productKeys.team }),
        ]);
      }
      toast.success(`${person.name} saved`);
      onClose();
    } catch (error) {
      await qc.invalidateQueries({ queryKey: productKeys.team });
      toast.error(...toastArgs(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => (!o && !saving ? onClose() : undefined)}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{person.name}</DialogTitle>
          <DialogDescription>{person.email}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Role" hint={isSelf ? 'You cannot change your own role.' : undefined}>
              <Select value={role} onValueChange={(v) => setRole(v as Role)} disabled={isSelf}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="flex flex-col gap-3 pt-6">
              <label className="flex items-center gap-2 text-sm text-ink">
                <Switch checked={brand} onCheckedChange={setBrand} aria-label="Brand approver" />
                Brand approver
              </label>
              <label className="flex items-center gap-2 text-sm text-ink">
                <Switch
                  checked={active}
                  onCheckedChange={setActive}
                  disabled={isSelf}
                  aria-label="Active"
                />
                Active
              </label>
            </div>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-semibold text-ink">Products</legend>
            {products.isPending ? (
              <Skeleton className="h-16" />
            ) : (
              <table className="w-full text-13">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="py-1 font-semibold">Product</th>
                    {PRODUCT_ROLES.map((r) => (
                      <th key={r} className="py-1 text-center font-semibold">
                        {PRODUCT_ROLE_LABELS[r]}
                      </th>
                    ))}
                    <th className="py-1 text-center font-semibold">Named backup</th>
                  </tr>
                </thead>
                <tbody>
                  {(products.data?.items ?? []).map((p) => {
                    const isNamedOwner = p.owner?.id === person.id;
                    return (
                      <tr key={p.id} className="border-t border-hairline">
                        <td className="py-2 font-medium text-ink">{p.name}</td>
                        {PRODUCT_ROLES.map((r) => {
                          const checked =
                            (roles[p.id] ?? []).includes(r) ||
                            (r === 'backup' && backupFor.has(p.id));
                          const locked =
                            (r === 'owner' && isNamedOwner) ||
                            (r === 'backup' && backupFor.has(p.id));
                          return (
                            <td key={r} className="py-2 text-center">
                              <Checkbox
                                checked={checked}
                                disabled={locked}
                                onCheckedChange={(v) => toggleRole(p.id, r, v === true)}
                                aria-label={`${PRODUCT_ROLE_LABELS[r]} on ${p.name}`}
                              />
                            </td>
                          );
                        })}
                        <td className="py-2 text-center">
                          <Checkbox
                            checked={backupFor.has(p.id)}
                            disabled={isNamedOwner}
                            onCheckedChange={(v) =>
                              setBackupFor((old) => {
                                const next = new Set(old);
                                if (v === true) next.add(p.id);
                                else next.delete(p.id);
                                return next;
                              })
                            }
                            aria-label={`Named backup for ${p.name}`}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <p className="text-xs text-muted">
              The named owner is changed on the product kit or in Settings. A named backup replaces
              the current one.
            </p>
            {person.backupFor.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {person.backupFor.map((b) => (
                  <StatusChip key={b.productId} tone="care">
                    Backup for {b.productName}
                  </StatusChip>
                ))}
              </div>
            ) : null}
          </fieldset>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={saving}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
