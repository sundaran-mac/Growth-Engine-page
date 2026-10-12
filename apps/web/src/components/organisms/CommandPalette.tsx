import { Cube, SignOut } from '@phosphor-icons/react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { ALL_NAV_ENTRIES } from '@/app/nav';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { Icon } from '@/components/atoms/Icon';
import { ProductDot } from '@/components/molecules/ProductDot';
import { useLogout } from '@/lib/auth';
import { useSelectedProduct } from '@/lib/use-selected-product';
import { useUiStore } from '@/stores/ui';

/** Cmd+K / Ctrl+K palette: go to a screen, switch product, sign out. */
export function CommandPalette() {
  const open = useUiStore((s) => s.commandOpen);
  const setOpen = useUiStore((s) => s.setCommandOpen);
  const toggle = useUiStore((s) => s.toggleCommand);
  const navigate = useNavigate();
  const logout = useLogout();
  const { products, productId, setProductId } = useSelectedProduct();

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        toggle();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search everything" />
      <CommandList>
        <CommandEmpty>Nothing found.</CommandEmpty>
        <CommandGroup heading="Go to">
          {ALL_NAV_ENTRIES.map((entry) => (
            <CommandItem key={entry.to} value={`go ${entry.label}`} onSelect={() => run(() => navigate(entry.to))}>
              <Icon icon={entry.icon} size={18} />
              {entry.label}
            </CommandItem>
          ))}
        </CommandGroup>
        {products.length > 0 ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Switch product">
              {products.map((p) => (
                <CommandItem key={p.id} value={`product ${p.name}`} onSelect={() => run(() => setProductId(p.id))}>
                  <ProductDot color={p.color} />
                  {p.name}
                  {p.id === productId ? <span className="ml-auto text-xs text-muted">Current</span> : null}
                </CommandItem>
              ))}
              <CommandItem value="all products" onSelect={() => run(() => navigate('/products'))}>
                <Icon icon={Cube} size={18} />
                All products
              </CommandItem>
            </CommandGroup>
          </>
        ) : null}
        <CommandSeparator />
        <CommandGroup heading="Account">
          <CommandItem
            value="sign out"
            onSelect={() => run(() => logout.mutate(undefined, { onSettled: () => navigate('/login', { replace: true }) }))}
          >
            <Icon icon={SignOut} size={18} />
            Sign out
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
