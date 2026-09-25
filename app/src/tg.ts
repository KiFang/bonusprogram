// Минимальная обёртка над Telegram.WebApp.

type Btn = {
  show(): void;
  hide(): void;
  onClick(cb: () => void): void;
  offClick(cb: () => void): void;
};

type WebApp = {
  initData: string;
  initDataUnsafe: { start_param?: string; user?: { first_name: string } };
  ready(): void;
  expand(): void;
  close(): void;
  setHeaderColor(c: string): void;
  setBackgroundColor(c: string): void;
  BackButton: Btn;
  HapticFeedback?: { notificationOccurred(t: "success" | "error" | "warning"): void; selectionChanged(): void };
  showScanQrPopup?(p: { text?: string }, cb: (text: string) => boolean | void): void;
  closeScanQrPopup?(): void;
  showConfirm?(message: string, cb: (ok: boolean) => void): void;
  openTelegramLink?(url: string): void;
  isVersionAtLeast?(v: string): boolean;
};

declare global {
  interface Window {
    Telegram?: { WebApp?: WebApp };
  }
}

export const tg: WebApp | undefined = window.Telegram?.WebApp;
export const inTelegram = !!tg?.initData;

export function initTelegram() {
  if (!tg) return;
  tg.ready();
  tg.expand();
  try {
    tg.setHeaderColor("#0B0A0D");
    tg.setBackgroundColor("#0B0A0D");
  } catch {
    // старые клиенты
  }
}

export function haptic(type: "success" | "error" | "warning") {
  try {
    tg?.HapticFeedback?.notificationOccurred(type);
  } catch {
    // нет поддержки
  }
}

export function confirmDialog(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (tg?.showConfirm && tg.isVersionAtLeast?.("6.2")) tg.showConfirm(message, resolve);
    else resolve(window.confirm(message));
  });
}

export function canScanQr() {
  return !!tg?.showScanQrPopup && !!tg.isVersionAtLeast?.("6.4");
}

export function scanQr(text: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (!canScanQr()) return resolve(null);
    tg!.showScanQrPopup!({ text }, (value) => {
      resolve(value);
      return true;
    });
  });
}
