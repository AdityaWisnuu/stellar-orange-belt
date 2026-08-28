import "./style.css";
import {
  rpc,
  TransactionBuilder,
  Networks,
  Contract,
  nativeToScVal,
  scValToNative,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import {
  StellarWalletsKit,
  Networks as KitNetworks,
} from "@creit.tech/stellar-wallets-kit";
import { FreighterModule } from "@creit.tech/stellar-wallets-kit/modules/freighter";
import { AlbedoModule } from "@creit.tech/stellar-wallets-kit/modules/albedo";
import { xBullModule } from "@creit.tech/stellar-wallets-kit/modules/xbull";
import { LobstrModule } from "@creit.tech/stellar-wallets-kit/modules/lobstr";
import { HanaModule } from "@creit.tech/stellar-wallets-kit/modules/hana";
import { RabetModule } from "@creit.tech/stellar-wallets-kit/modules/rabet";

// Kontrak KIRIM di testnet (lihat README)
const CONTRACT_ID = "CC7WCFBM2CRUW36KTJZB67SJTSX3XHXCO7J2IJDILETKP4OFQHBT6XIZ";
const READ_SOURCE = "GAJG2CTQGG5WAOQNEEYJNRMXFZ3BHLAGACFCTOGXQQ44UZDUCBX4WJHV";
const RPC_URL = "https://soroban-testnet.stellar.org";
const EXPLORER = "https://stellar.expert/explorer/testnet";
const LEDGER_SECONDS = 5;
const POLL_MS = 6000;
const TTL_OPTIONS = [
  { label: "1 hour", ledgers: 720 },
  { label: "1 day", ledgers: 17280 },
  { label: "3 days", ledgers: 51840 },
  { label: "7 days", ledgers: 120960 },
];
const STATUS = ["Pending", "Claimed", "Refunded"];

const server = new rpc.Server(RPC_URL);
const contract = new Contract(CONTRACT_ID);

StellarWalletsKit.init({
  network: KitNetworks.TESTNET,
  modules: [
    new FreighterModule(),
    new xBullModule(),
    new AlbedoModule(),
    new LobstrModule(),
    new HanaModule(),
    new RabetModule(),
  ],
});

let address = null;
let walletName = null;
let firstRender = true;
let latestLedger = 0;
let lookupId = new URLSearchParams(location.search).get("id");
let lookupResult = null;
const displayed = { count: 0 };

const fmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const fmtXlm = (stroops) => fmt.format(Number(stroops) / 1e7);
const short = (a) => `${a.slice(0, 4)}…${a.slice(-4)}`;

// ---------- chain helpers ----------
async function simulate(op) {
  const account = await server.getAccount(READ_SOURCE);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(op)
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim)) throw new Error("simulation failed");
  return scValToNative(sim.result.retval);
}

async function invoke(op, statusFn) {
  statusFn("Building transaction…");
  const account = await server.getAccount(address);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(op)
    .setTimeout(60)
    .build();

  statusFn("Simulating & preparing…");
  const prepared = await server.prepareTransaction(tx);

  statusFn("Waiting for wallet signature…");
  const { signedTxXdr } = await StellarWalletsKit.signTransaction(prepared.toXDR(), {
    address,
    networkPassphrase: Networks.TESTNET,
  });

  statusFn("Submitting…");
  const sent = await server.sendTransaction(
    TransactionBuilder.fromXDR(signedTxXdr, Networks.TESTNET)
  );
  if (sent.status === "ERROR") throw new Error(`submit error: ${JSON.stringify(sent.errorResult)}`);

  let result = await server.getTransaction(sent.hash);
  for (let i = 0; i < 20 && result.status === "NOT_FOUND"; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    result = await server.getTransaction(sent.hash);
  }
  if (result.status !== "SUCCESS") throw new Error(`tx ${result.status}`);
  return { hash: sent.hash, retval: result.returnValue ? scValToNative(result.returnValue) : null };
}

function statusOf(t) {
  return typeof t.status === "number" ? STATUS[t.status] ?? String(t.status) : String(t.status);
}

function expiryText(t) {
  if (!latestLedger) return "";
  const diff = Number(t.expiry_ledger) - latestLedger;
  if (diff <= 0) return "expired";
  const secs = diff * LEDGER_SECONDS;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 48 ? `≈${Math.round(h / 24)} days left` : h > 0 ? `≈${h}h ${m}m left` : `≈${m}m left`;
}

// ---------- events feed ----------
const seenEvents = new Set();
const feed = [];

async function pollEvents() {
  try {
    const latest = await server.getLatestLedger();
    latestLedger = latest.sequence;
    const res = await server.getEvents({
      startLedger: Math.max(latest.sequence - 6000, 1),
      filters: [{ type: "contract", contractIds: [CONTRACT_ID] }],
      limit: 100,
    });
    let fresh = 0;
    for (const ev of res.events ?? []) {
      if (seenEvents.has(ev.id)) continue;
      seenEvents.add(ev.id);
      try {
        const topics = ev.topic.map((t) => scValToNative(t));
        if (topics[0] !== "kirim") continue;
        const data = scValToNative(ev.value);
        feed.unshift({
          id: ev.id,
          action: topics[1],
          transferId: Number(topics[2]),
          data,
          txHash: ev.txHash,
        });
        fresh++;
      } catch (e) {
        console.warn("skip event", e);
      }
    }
    if (fresh > 0) renderFeed(true);
    document.querySelector("#sync-dot")?.classList.add("live");
  } catch (e) {
    console.warn("event poll failed", e);
    document.querySelector("#sync-dot")?.classList.remove("live");
  }
}

// ---------- UI ----------
const app = document.querySelector("#app");

function render() {
  app.innerHTML = `
    <div class="wrap ${firstRender ? "reveal" : ""}">
      <header class="masthead">
        <p class="kicker">Stellar Dojo · Journey to Mastery · <b>Level 3 — Orange Belt</b></p>
        <h1>Kirim <span class="jar" id="jar">🧧</span></h1>
        <div class="beltline" role="presentation"></div>
        <p class="lede">Send money across borders on Stellar. Funds lock inside a <a href="${EXPLORER}/contract/${CONTRACT_ID}" target="_blank" rel="noreferrer">Soroban escrow</a> — the recipient claims them before expiry, or the sender takes them back after.</p>
      </header>

      <section class="stats" aria-label="On-chain totals">
        <div class="stat"><output id="stat-count">0</output><label>transfers on-chain</label></div>
        <div class="stat">
          <output><a href="${EXPLORER}/contract/${CONTRACT_ID}" target="_blank" rel="noreferrer">${short(CONTRACT_ID)}</a></output>
          <label>escrow contract</label>
        </div>
        <div class="stat"><output>testnet</output><label>network</label></div>
      </section>

      <div class="stage">
        <div>
          <section class="panel">
            <h2>Wallet</h2>
            ${
              address
                ? `<p class="addr" title="${address}">${short(address)} <span class="muted small">· ${walletName}</span></p>
                   <button id="disconnect" class="ghost">Disconnect</button>`
                : `<p class="muted">Freighter, xBull, Albedo, Lobstr, Hana, Rabet — pick any.</p>
                   <button id="connect">Connect wallet</button>`
            }
          </section>

          <section class="panel">
            <h2>Send money</h2>
            <form id="send-form">
              <label><span>Recipient · public key</span>
                <input id="send-dest" required pattern="G[A-Z2-7]{55}" placeholder="G…" />
              </label>
              <label><span>Amount · XLM</span>
                <input id="send-amount" required type="number" min="0.0000001" step="any" value="25" />
              </label>
              <label><span>Note for the recipient</span>
                <input id="send-memo" maxlength="100" placeholder="buat keluarga di rumah" />
              </label>
              <label><span>Claim window</span>
                <select id="send-ttl" style="background:var(--ink-2);color:var(--paper);border:1px solid var(--line);padding:0.75rem 0.85rem;font:inherit">
                  ${TTL_OPTIONS.map((o, i) => `<option value="${o.ledgers}" ${i === 1 ? "selected" : ""}>${o.label}</option>`).join("")}
                </select>
              </label>
              <button ${address ? "" : "disabled"}>Lock into escrow</button>
            </form>
            <p class="status" id="send-status" role="status"></p>
          </section>
        </div>

        <div>
          <section class="panel">
            <h2>Claim a transfer</h2>
            <form id="lookup-form">
              <label><span>Transfer ID</span>
                <input id="lookup-id" required type="number" min="0" step="1" value="${lookupId ?? ""}" placeholder="0" />
              </label>
              <button class="ghost" type="submit">Look up</button>
            </form>
            <div id="lookup-detail"></div>
            <p class="status" id="action-status" role="status"></p>
          </section>

          <section class="panel">
            <div class="feedhead">
              <h2>Live activity</h2>
              <span id="sync-dot" title="polling on-chain events"></span>
            </div>
            <ul id="feed"><li class="muted">Listening for on-chain events…</li></ul>
          </section>
        </div>
      </div>

      <footer class="belts">
        <i style="--b:#f2f0e9" class="on"></i>
        <i style="--b:#ffd42d" class="on"></i>
        <i style="--b:#ff8c1a" class="on"></i>
        <i style="--b:#57d364"></i>
        <i style="--b:#4aa3ff"></i>
        <i style="--b:#666"></i>
        <span>orange belt · built by <a href="https://github.com/AdityaWisnuu/stellar-orange-belt" style="color:var(--paper)">AdityaWisnuu</a></span>
      </footer>
    </div>
  `;
  firstRender = false;
  wire();
  refreshStats();
  renderFeed();
  if (lookupId !== null) loadTransfer(Number(lookupId));
}

function renderFeed(flash = false) {
  const el = document.querySelector("#feed");
  if (!el) return;
  if (!feed.length) {
    el.innerHTML = `<li class="muted">No activity in the recent window yet.</li>`;
    return;
  }
  const icon = { sent: "📤", claimed: "✅", refunded: "↩️" };
  el.innerHTML = feed
    .map((ev, i) => {
      const amount = ev.action === "sent" ? ev.data[2] : ev.data[1];
      return `
      <li class="${flash && i === 0 ? "flash" : ""}">
        <span class="amt">${icon[ev.action] ?? ""} ${fmtXlm(amount)} XLM</span> ${ev.action} · transfer #${ev.transferId}<br />
        <a class="small" href="${EXPLORER}/tx/${ev.txHash}" target="_blank" rel="noreferrer">tx ↗</a>
      </li>`;
    })
    .join("");
}

function renderLookup() {
  const el = document.querySelector("#lookup-detail");
  if (!el) return;
  if (!lookupResult) {
    el.innerHTML = "";
    return;
  }
  const t = lookupResult.t;
  const id = lookupResult.id;
  const st = statusOf(t);
  const expired = latestLedger > Number(t.expiry_ledger);
  const isRecipient = address === t.recipient;
  const isSender = address === t.sender;
  const canClaim = st === "Pending" && !expired && isRecipient;
  const canRefund = st === "Pending" && expired && isSender;
  el.innerHTML = `
    <p class="addr" style="display:block">
      <strong>#${id}</strong> · ${fmtXlm(t.amount)} XLM · <b>${st}</b> ${st === "Pending" ? `· ${expiryText(t)}` : ""}<br />
      <span class="small muted">from</span> ${short(t.sender)} <span class="small muted">to</span> ${short(t.recipient)}<br />
      ${t.memo ? `<q>${t.memo}</q>` : ""}
    </p>
    ${canClaim ? `<button id="claim-btn">Claim ${fmtXlm(t.amount)} XLM</button>` : ""}
    ${canRefund ? `<button id="refund-btn">Refund to sender</button>` : ""}
    ${st === "Pending" && !address ? `<p class="muted small">Connect the recipient wallet to claim${expired ? ", or the sender wallet to refund" : ""}.</p>` : ""}
    ${st === "Pending" && address && !canClaim && !canRefund ? `<p class="muted small">${expired ? "Expired — only the sender can refund." : "Only the recipient can claim before expiry."}</p>` : ""}
  `;
  const setStatus = (msg, isError = false) => {
    const s = document.querySelector("#action-status");
    s.innerHTML = msg;
    s.className = `status ${isError ? "error" : "ok"}`;
  };
  document.querySelector("#claim-btn")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    try {
      const { hash } = await invoke(contract.call("claim", nativeToScVal(BigInt(id), { type: "u64" })), setStatus);
      setStatus(`✅ Claimed! <a href="${EXPLORER}/tx/${hash}" target="_blank" rel="noreferrer">View on explorer</a>`);
      await loadTransfer(id);
      pollEvents();
    } catch (err) {
      setStatus(`Failed: ${err.message}`, true);
      e.target.disabled = false;
    }
  });
  document.querySelector("#refund-btn")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    try {
      const { hash } = await invoke(contract.call("refund", nativeToScVal(BigInt(id), { type: "u64" })), setStatus);
      setStatus(`↩️ Refunded. <a href="${EXPLORER}/tx/${hash}" target="_blank" rel="noreferrer">View on explorer</a>`);
      await loadTransfer(id);
      pollEvents();
    } catch (err) {
      setStatus(`Failed: ${err.message}`, true);
      e.target.disabled = false;
    }
  });
}

async function loadTransfer(id) {
  const el = document.querySelector("#lookup-detail");
  try {
    if (el) el.innerHTML = `<p class="muted small">Loading transfer #${id}…</p>`;
    if (!latestLedger) latestLedger = (await server.getLatestLedger()).sequence;
    const t = await simulate(contract.call("get_transfer", nativeToScVal(BigInt(id), { type: "u64" })));
    lookupResult = { id, t };
    renderLookup();
  } catch {
    lookupResult = null;
    if (el) el.innerHTML = `<p class="status error">Transfer #${id} not found.</p>`;
  }
}

async function refreshStats() {
  try {
    const count = Number(await simulate(contract.call("count")));
    const el = document.querySelector("#stat-count");
    if (el && count !== displayed.count) {
      const from = displayed.count;
      displayed.count = count;
      const t0 = performance.now();
      const tick = (t) => {
        const p = Math.min((t - t0) / 700, 1);
        el.textContent = Math.round(from + (count - from) * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(tick);
        else el.classList.add("lit");
      };
      requestAnimationFrame(tick);
    }
  } catch (e) {
    console.warn("stats failed", e);
  }
}

function wire() {
  document.querySelector("#connect")?.addEventListener("click", async () => {
    try {
      const res = await StellarWalletsKit.authModal();
      address = res.address;
      walletName = StellarWalletsKit.selectedModule?.productName ?? "wallet";
      render();
    } catch (e) {
      console.warn("connect cancelled", e);
    }
  });

  document.querySelector("#disconnect")?.addEventListener("click", async () => {
    await StellarWalletsKit.disconnect().catch(() => {});
    address = null;
    walletName = null;
    render();
  });

  document.querySelector("#lookup-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    lookupId = document.querySelector("#lookup-id").value;
    history.replaceState(null, "", `?id=${lookupId}`);
    loadTransfer(Number(lookupId));
  });

  document.querySelector("#send-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    const setStatus = (msg, isError = false) => {
      const s = document.querySelector("#send-status");
      s.innerHTML = msg;
      s.className = `status ${isError ? "error" : "ok"}`;
    };
    try {
      const dest = document.querySelector("#send-dest").value.trim();
      const xlm = document.querySelector("#send-amount").value;
      const memo = document.querySelector("#send-memo").value.trim() || "—";
      const ttl = Number(document.querySelector("#send-ttl").value);
      const stroops = BigInt(Math.round(parseFloat(xlm) * 1e7));

      const { hash, retval } = await invoke(
        contract.call(
          "send",
          nativeToScVal(address, { type: "address" }),
          nativeToScVal(dest, { type: "address" }),
          nativeToScVal(stroops, { type: "i128" }),
          nativeToScVal(memo, { type: "string" }),
          nativeToScVal(ttl, { type: "u32" })
        ),
        setStatus
      );
      const id = Number(retval);
      const claimLink = `${location.origin}${location.pathname}?id=${id}`;
      setStatus(
        `📤 Locked as transfer <strong>#${id}</strong> · <a href="${EXPLORER}/tx/${hash}" target="_blank" rel="noreferrer">tx ↗</a><br />
         Share this claim link: <a href="${claimLink}">${claimLink}</a>`
      );
      shakeJar();
      refreshStats();
      pollEvents();
    } catch (err) {
      setStatus(`Failed: ${err.message}`, true);
    } finally {
      btn.disabled = false;
    }
  });
}

function shakeJar() {
  const jar = document.querySelector("#jar");
  if (!jar) return;
  jar.classList.remove("shake");
  void jar.offsetWidth;
  jar.classList.add("shake");
}

render();
pollEvents();
setInterval(pollEvents, POLL_MS);
setInterval(refreshStats, POLL_MS * 2);
