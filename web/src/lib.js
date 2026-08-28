// Helper murni KIRIM — dipisah dari main.js supaya bisa diuji unit tanpa browser.

export const STATUS = ["Pending", "Claimed", "Refunded"];
export const LEDGER_SECONDS = 5;

const fmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export function fmtXlm(stroops) {
  return fmt.format(Number(stroops) / 1e7);
}

export function short(a) {
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

export function statusOf(t) {
  return typeof t.status === "number" ? STATUS[t.status] ?? String(t.status) : String(t.status);
}

// Terjemahkan kode error kontrak jadi pesan yang bisa dimengerti manusia.
export const CONTRACT_ERRORS = {
  1: "Amount must be greater than zero.",
  2: "Claim window must be between 1 minute and 30 days.",
  3: "That transfer doesn't exist.",
  4: "This transfer was already claimed or refunded.",
  5: "This transfer has expired — only the sender can refund it now.",
  6: "Not expired yet — the recipient can still claim it.",
};

export function friendlyError(err) {
  const m = String(err?.message ?? err).match(/Error\(Contract, #(\d+)\)/);
  if (m && CONTRACT_ERRORS[m[1]]) return CONTRACT_ERRORS[m[1]];
  if (/insufficient|underfunded|balance/i.test(String(err?.message)))
    return "Not enough XLM in the wallet for this transfer.";
  return err.message;
}

export function expiryText(t, latestLedger) {
  if (!latestLedger) return "";
  const diff = Number(t.expiry_ledger) - latestLedger;
  if (diff <= 0) return "expired";
  const secs = diff * LEDGER_SECONDS;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 48 ? `≈${Math.round(h / 24)} days left` : h > 0 ? `≈${h}h ${m}m left` : `≈${m}m left`;
}
