import { useCallback, useRef, useState } from "react";

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface PendingConfirm extends ConfirmRequest {
  resolve: (confirmed: boolean) => void;
}

function ConfirmDialogView({
  request,
  onClose,
}: {
  request: PendingConfirm;
  onClose: (confirmed: boolean) => void;
}) {
  return (
    <div className="modal-overlay" onClick={() => onClose(false)}>
      <div
        className="modal modal--confirm"
        role="alertdialog"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <h2 id="confirm-dialog-title">{request.title}</h2>
          <button type="button" className="icon-btn" onClick={() => onClose(false)} aria-label="关闭">
            ✕
          </button>
        </div>
        <div className="modal__body">
          <p id="confirm-dialog-message" className="modal__message">
            {request.message}
          </p>
        </div>
        <div className="modal__footer">
          <button type="button" className="btn btn--ghost" onClick={() => onClose(false)}>
            {request.cancelLabel ?? "取消"}
          </button>
          <button
            type="button"
            className={`btn ${request.danger ? "btn--danger" : "btn--primary"}`}
            onClick={() => onClose(true)}
          >
            {request.confirmLabel ?? "确认"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function useConfirmDialog() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const pendingRef = useRef<PendingConfirm | null>(null);

  const close = useCallback((confirmed: boolean) => {
    const current = pendingRef.current;
    if (!current) return;
    pendingRef.current = null;
    setPending(null);
    current.resolve(confirmed);
  }, []);

  const confirm = useCallback((request: ConfirmRequest) => {
    return new Promise<boolean>((resolve) => {
      const next: PendingConfirm = { ...request, resolve };
      pendingRef.current = next;
      setPending(next);
    });
  }, []);

  const dialog = pending ? <ConfirmDialogView request={pending} onClose={close} /> : null;

  return { requestConfirm: confirm, dialog };
}
