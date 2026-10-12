import { Toaster as SonnerToaster, type ToasterProps } from 'sonner';

/** App toaster in the house style. Use `toast` from 'sonner' to show one. */
export function Toaster(props: ToasterProps) {
  return (
    <SonnerToaster
      position="bottom-right"
      closeButton
      toastOptions={{
        classNames: {
          toast: 'group font-sans rounded-tile border border-hairline bg-surface-card text-ink shadow-popover',
          title: 'text-sm font-semibold',
          description: 'text-13 text-muted',
          actionButton: 'rounded-pill bg-joy text-ink font-semibold',
          cancelButton: 'rounded-pill bg-surface-sunken text-ink',
          error: 'border-danger/40',
          success: 'border-care/40',
        },
      }}
      {...props}
    />
  );
}

export { toast } from 'sonner';
