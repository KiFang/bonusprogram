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
  openLink?(url: string): void;
  openInvoice?(url: string, cb: (status: "paid" | "cancelled" | "failed" | "pending") => void): void;
  isVersionAtLeast?(v: string): boolean;
};

declare global {
  interface Window {
    Telegram?: { WebApp?: WebApp };
  }
}

export const tg: WebApp | undefined = window.Telegram?.WebApp;
export const inTelegram = import.meta.env.VITE_DEMO === "1" || !!tg?.initData;

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

/** Подтверждение внутри страницы — вне Telegram (демо), где системных окон может не быть. */
function pageConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.className = "page-confirm";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    const box = document.createElement("div");
    box.className = "page-confirm-box";
    const text = document.createElement("div");
    text.textContent = message;
    const row = document.createElement("div");
    row.className = "row2";
    const no = document.createElement("button");
    no.className = "btn";
    no.textContent = "Отмена";
    const yes = document.createElement("button");
    yes.className = "btn btn-primary";
    yes.textContent = "OK";
    const done = (v: boolean) => { wrap.remove(); resolve(v); };
    no.onclick = () => done(false);
    yes.onclick = () => done(true);
    row.append(no, yes);
    box.append(text, row);
    wrap.append(box);
    document.body.append(wrap);
    yes.focus();
  });
}

/**
 * Подтверждение через окно Telegram. Если предыдущее окно ещё закрывается, Telegram бросает
 * WebAppPopupOpened — тогда пробуем ещё раз чуть позже, а не молча обрываем действие.
 */
export function confirmDialog(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!tg?.showConfirm || !tg.isVersionAtLeast?.("6.2") || !tg.initData) return pageConfirm(message).then(resolve);
    const open = (attempt: number) => {
      try {
        tg!.showConfirm!(message, (ok) => resolve(!!ok));
      } catch {
        if (attempt < 5) window.setTimeout(() => open(attempt + 1), 150);
        else pageConfirm(message).then(resolve);
      }
    };
    open(0);
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

/** Открыть счёт Telegram Stars. Возвращает статус оплаты. */
export function openInvoice(url: string): Promise<"paid" | "cancelled" | "failed" | "pending"> {
  return new Promise((resolve) => {
    if (!tg?.openInvoice) return resolve("failed");
    tg.openInvoice(url, resolve);
  });
}

export function openExternal(url: string) {
  if (tg?.openLink) tg.openLink(url);
  else window.open(url, "_blank", "noopener");
}

/** Поделиться ссылкой через выбор чата Telegram. */
export function shareLink(url: string, text: string) {
  const share = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  if (tg?.openTelegramLink) tg.openTelegramLink(share);
  else window.open(share, "_blank", "noopener");
}
