import { useCallback, useState } from "react";
import ConfirmDialog from "../components/ConfirmDialog";

export type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  details?: string[];
};

export function useConfirmDialog() {
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (value: boolean) => void }) | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...options, resolve });
    });
  }, []);

  function close(result: boolean) {
    if (!pending) return;
    pending.resolve(result);
    setPending(null);
  }

  const dialog = pending ? (
    <ConfirmDialog
      title={pending.title}
      message={pending.message}
      confirmLabel={pending.confirmLabel}
      cancelLabel={pending.cancelLabel}
      danger={pending.danger}
      details={pending.details}
      onCancel={() => close(false)}
      onConfirm={() => close(true)}
    />
  ) : null;

  return { confirm, dialog };
}
