import * as React from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTeam } from '../api';

const NONE = '__none__';

export interface PersonSelectProps {
  id?: string;
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  /** Text for "nobody", for example "To confirm". */
  noneLabel?: string;
  disabled?: boolean;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}

/** Pick an active person from the team (owner, backup). Works inside `Field`. */
export const PersonSelect = React.forwardRef<HTMLButtonElement, PersonSelectProps>(
  ({ id, value, onChange, noneLabel = 'Nobody yet', disabled, ...aria }, ref) => {
    const team = useTeam();
    const people = team.data?.items ?? [];
    return (
      <Select
        value={value ?? NONE}
        onValueChange={(v) => onChange(v === NONE ? null : v)}
        disabled={disabled || team.isPending}
      >
        <SelectTrigger ref={ref} id={id} {...aria}>
          <SelectValue placeholder={team.isPending ? 'Loading people…' : noneLabel} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{noneLabel}</SelectItem>
          {people.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
              {p.title ? ` · ${p.title}` : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  },
);
PersonSelect.displayName = 'PersonSelect';
