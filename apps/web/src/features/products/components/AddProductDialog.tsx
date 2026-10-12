import type * as React from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { z } from 'zod';
import { createProductRequestSchema } from '@growth-desk/contract';
import { Button } from '@/components/atoms/Button';
import { Input } from '@/components/atoms/Input';
import { Field } from '@/components/molecules/Field';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { isApiError } from '@/lib/api';
import { useCreateProduct } from '../api';
import { slugify, toastArgs } from '../format';
import { PersonSelect } from './PersonSelect';

type FormIn = z.input<typeof createProductRequestSchema>;
type FormOut = z.output<typeof createProductRequestSchema>;

const DEFAULTS: FormIn = {
  name: '',
  slug: '',
  repoUrl: '',
  siteUrl: '',
  color: '#ff9a00',
  ownerId: null,
  backupId: null,
  status: 'draft',
};

export function AddProductDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const create = useCreateProduct();
  const navigate = useNavigate();
  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(createProductRequestSchema),
    defaultValues: DEFAULTS,
  });
  const { register, handleSubmit, control, formState, setValue, setError } = form;

  const onSubmit = handleSubmit(async (values) => {
    try {
      const product = await create.mutateAsync(values);
      toast.success(`${product.name} added`, {
        description: 'Fill the kit, then ask the owner to sign it.',
      });
      onOpenChange(false);
      navigate(`/products/${product.id}/kit`);
    } catch (error) {
      if (isApiError(error) && error.code === 'SLUG_TAKEN') {
        setError('slug', { message: 'Another product already uses this slug' });
        return;
      }
      if (isApiError(error) && error.errors.length > 0) {
        for (const e of error.errors) {
          const key = e.path.replace(/^body\./, '') as keyof FormIn;
          if (key in DEFAULTS) setError(key, { message: e.message });
        }
        return;
      }
      toast.error(...toastArgs(error));
    }
  });

  return (
    <Dialog open={open} onOpenChange={(o) => (create.isPending ? undefined : onOpenChange(o))}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a product</DialogTitle>
          <DialogDescription>
            Point Growth Desk at the product repo. You fill the kit next; the owner signs it.
          </DialogDescription>
        </DialogHeader>
        <form
          id="add-product"
          onSubmit={(e) => void onSubmit(e)}
          className="flex flex-col gap-4"
          noValidate
        >
          <Field label="Name" required error={formState.errors.name}>
            <Input
              placeholder="Humini Send"
              autoFocus
              {...register('name', {
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                  if (!formState.dirtyFields.slug) setValue('slug', slugify(e.target.value));
                },
              })}
            />
          </Field>
          <Field
            label="Slug"
            required
            hint="Used in links. Lower case letters, numbers and dashes."
            error={formState.errors.slug}
          >
            <Input placeholder="humini-send" {...register('slug')} />
          </Field>
          <Field
            label="Repo URL"
            hint="GitHub repo with docs/specs. Used by Refresh from repo."
            error={formState.errors.repoUrl}
          >
            <Input
              placeholder="https://github.com/humini-ecosystem/humini-send"
              {...register('repoUrl')}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Owner"
              hint="Signs the kit and the claims gate."
              error={formState.errors.ownerId}
            >
              <Controller
                control={control}
                name="ownerId"
                render={({ field }) => (
                  <PersonSelect
                    value={field.value}
                    onChange={field.onChange}
                    noneLabel="To confirm"
                  />
                )}
              />
            </Field>
            <Field
              label="Backup"
              hint="Decides when the owner is away."
              error={formState.errors.backupId}
            >
              <Controller
                control={control}
                name="backupId"
                render={({ field }) => (
                  <PersonSelect value={field.value} onChange={field.onChange} noneLabel="To name" />
                )}
              />
            </Field>
          </div>
          <Field
            label="Colour"
            hint="Dot colour in lists and the product switcher."
            error={formState.errors.color}
          >
            <Input type="color" className="h-11 w-24 p-1" {...register('color')} />
          </Field>
        </form>
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={create.isPending}
          >
            Cancel
          </Button>
          <Button type="submit" form="add-product" loading={create.isPending}>
            Add product
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
