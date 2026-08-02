/**
 * TON Connect wallet linking (§14 stub). Real TON Connect protocol via
 * `@tonconnect/ui` — not a fake text box — but strictly address capture:
 * no `ton_proof` verification server-side, no transactions, no payouts. See
 * DECISIONS.md for exactly what that stub boundary means and why.
 *
 * "Gram" here refers to the June 2026 Toncoin→Gram ticker/branding rebrand
 * (the network/protocol itself is still TON — "TON Connect" is unaffected).
 */
import { TonConnectUI, toUserFriendlyAddress, type Wallet } from "@tonconnect/ui";

let tonConnectUI: TonConnectUI | null = null;

function getUI(): TonConnectUI {
  if (!tonConnectUI) {
    tonConnectUI = new TonConnectUI({
      manifestUrl: `${window.location.origin}/api/tonconnect-manifest.json`,
    });
  }
  return tonConnectUI;
}

export function walletToAddress(wallet: Wallet | null): string | null {
  return wallet ? toUserFriendlyAddress(wallet.account.address) : null;
}

/** Current connected address, if any — reflects whatever session TonConnect already restored on load. */
export function currentWalletAddress(): string | null {
  const ui = getUI();
  return ui.account ? toUserFriendlyAddress(ui.account.address) : null;
}

/** Fires once immediately with the restored session's state (or null), then on every connect/disconnect. */
export function onWalletChange(callback: (address: string | null) => void): () => void {
  const ui = getUI();
  return ui.onStatusChange(
    (wallet) => callback(walletToAddress(wallet)),
    (err) => console.error("TON Connect error", err),
  );
}

export function openWalletConnectModal(): Promise<void> {
  return getUI().openModal();
}

export function disconnectWallet(): Promise<void> {
  return getUI().disconnect();
}
