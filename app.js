'use strict';

// ============================================================
//  BillPro — Main Application
// ============================================================

/* global DB, supabase, SUPABASE_URL, SUPABASE_ANON_KEY */

// ── Helpers ──────────────────────────────────────────────────
const f2  = n => '₹' + parseFloat(n).toFixed(2);
const esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ICONS = {
  Grains:'🌾', Dairy:'🥛', Beverages:'🧃',
  Snacks:'🍪', Vegetables:'🥬', Care:'🧴', Others:'📦',
};

const DEFAULT_CATS = ['Grains', 'Dairy', 'Beverages', 'Snacks', 'Vegetables', 'Care', 'Others'];
const UNIT_OPTIONS = ['pcs', 'kg', 'ton', 'quintal', 'g', 'L', 'ml', 'pack', 'box', 'dozen', 'bag'];
const CATEGORY_STORAGE_KEY = 'billpro.customCategories';
const HIDDEN_CATEGORY_STORAGE_KEY = 'billpro.hiddenCategories';
const OWNER_EMAIL = 'rajkodmalwar.in@gmail.com';
const SESSION_TIMEOUT_MS = 60 * 60 * 1000;
const ACTIVITY_EVENTS = ['click', 'keydown', 'touchstart', 'mousemove', 'scroll'];

// ── State ─────────────────────────────────────────────────────
let stocks      = [];
let bills       = [];
let cart        = [];
let activeCat   = 'All';
let editId      = null;
let nextBillNum = 1;
let customCats  = loadStringArray(CATEGORY_STORAGE_KEY);
let hiddenCats  = loadStringArray(HIDDEN_CATEGORY_STORAGE_KEY);
let dialogResolver = null;
let dialogInputMode = false;
let authClient = null;
let authPendingEmail = OWNER_EMAIL;
let appReady = false;
let inactivityTimer = null;
let activityBound = false;
let clockTimer = null;
let lastInactiveLogout = false;

// ── Bootstrap ─────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', bootstrap);

async function bootstrap() {
  registerSW();
  setupAuthUI();

  try {
    authClient = createAuthClient();
  } catch (err) {
    showError(err.message);
    setAuthMsg(err.message, true);
    setLoader(false);
    showAuthGate();
    return;
  }

  authClient.auth.onAuthStateChange(async (_event, session) => {
    if (!session) {
      stopInactivityTimer();
      return;
    }

    if (!isAllowedSession(session)) {
      await authClient.auth.signOut();
      setAuthMsg('This account is not allowed for this app.', true);
      showAuthGate();
      return;
    }

    startInactivityTimer();
  });

  try {
    const { data, error } = await authClient.auth.getSession();
    if (error) throw error;

    if (!data.session) {
      showAuthGate();
      setLoader(false);
      return;
    }

    if (!isAllowedSession(data.session)) {
      await authClient.auth.signOut();
      setAuthMsg('Only owner email can access this app.', true);
      showAuthGate();
      setLoader(false);
      return;
    }

    await startAuthorizedApp();
  } catch (err) {
    showError(err.message);
    setAuthMsg('Could not restore session. Please login again.', true);
    showAuthGate();
    setLoader(false);
  }
}

async function startAuthorizedApp() {
  hideAuthGate();
  startInactivityTimer();

  if (!appReady) {
    await initAppData();
    appReady = true;
  }
}

async function initAppData() {
  setLoader(true);
  try {
    [stocks, bills, nextBillNum] = await Promise.all([
      DB.loadStocks(),
      DB.loadBills(),
      DB.getNextBillNumber(),
    ]);
    hideError();
    renderCats();
    renderGrid();
    recalc();
    tick();
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = setInterval(tick, 1000);
  } catch (err) {
    showError(err.message);
  } finally {
    setLoader(false);
  }
}

function createAuthClient() {
  if (typeof supabase === 'undefined') {
    throw new Error('Supabase SDK not loaded. Check your internet connection.');
  }
  if (SUPABASE_URL.includes('YOUR-PROJECT') || SUPABASE_ANON_KEY.includes('YOUR-ANON')) {
    throw new Error('Open config.js and fill in your Supabase URL and anon key.');
  }
  return supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

function setupAuthUI() {
  const emailInput = document.getElementById('authEmail');
  const ownerHint = document.getElementById('authOwnerEmail');

  emailInput.value = OWNER_EMAIL;
  ownerHint.textContent = OWNER_EMAIL;
  document.getElementById('otpInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') verifyOtpLogin();
  });
}

function isAllowedSession(session) {
  const email = session?.user?.email || '';
  return email.toLowerCase() === OWNER_EMAIL;
}

function showAuthGate() {
  document.getElementById('authGate').classList.add('open');
  document.getElementById('appRoot').classList.add('is-hidden');
}

function hideAuthGate() {
  document.getElementById('authGate').classList.remove('open');
  document.getElementById('appRoot').classList.remove('is-hidden');
  setAuthMsg('', false);
}

function setAuthMsg(msg, isError = false) {
  const el = document.getElementById('authMsg');
  el.textContent = msg;
  el.className = 'auth-msg' + (isError ? ' err' : '');
}

async function sendOtpLogin() {
  const btn = document.getElementById('sendOtpBtn');
  const email = document.getElementById('authEmail').value.trim().toLowerCase();
  if (!email) {
    setAuthMsg('Please enter email.', true);
    return;
  }
  if (email !== OWNER_EMAIL) {
    setAuthMsg('Access denied. Only owner email can login.', true);
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Sending...';

  try {
    const { error } = await authClient.auth.signInWithOtp({ email });
    if (error) throw error;

    authPendingEmail = email;
    document.getElementById('otpRow').style.display = 'block';
    setAuthMsg('OTP sent. Check your email and enter the 6-digit code.');
  } catch (err) {
    setAuthMsg('Could not send OTP: ' + err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send OTP';
  }
}

async function verifyOtpLogin() {
  const btn = document.getElementById('verifyOtpBtn');
  const token = document.getElementById('otpInput').value.trim();
  if (!token) {
    setAuthMsg('Enter OTP to continue.', true);
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Verifying...';

  try {
    const { data, error } = await authClient.auth.verifyOtp({
      email: authPendingEmail,
      token,
      type: 'email',
    });
    if (error) throw error;
    if (!isAllowedSession(data.session)) {
      await authClient.auth.signOut();
      throw new Error('Only owner email can access this app.');
    }

    await startAuthorizedApp();
    document.getElementById('otpInput').value = '';
    document.getElementById('otpRow').style.display = 'none';
  } catch (err) {
    setAuthMsg('Login failed: ' + err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Verify OTP';
  }
}

function bindActivityEvents() {
  if (activityBound) return;
  ACTIVITY_EVENTS.forEach(evt => {
    document.addEventListener(evt, resetInactivityTimer, { passive: true });
  });
  activityBound = true;
}

function startInactivityTimer() {
  bindActivityEvents();
  resetInactivityTimer();
}

function resetInactivityTimer() {
  if (document.getElementById('authGate').classList.contains('open')) return;
  stopInactivityTimer();
  inactivityTimer = setTimeout(() => {
    lastInactiveLogout = true;
    logoutUser(true);
  }, SESSION_TIMEOUT_MS);
}

function stopInactivityTimer() {
  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
    inactivityTimer = null;
  }
}

async function logoutUser(inactive = false) {
  stopInactivityTimer();

  if (authClient) {
    await authClient.auth.signOut();
  }

  stocks = [];
  bills = [];
  cart = [];
  activeCat = 'All';
  appReady = false;

  renderCats();
  renderGrid();
  renderCart();
  recalc();

  document.getElementById('otpInput').value = '';
  document.getElementById('otpRow').style.display = 'none';
  showAuthGate();
  setAuthMsg(inactive ? 'Session expired after 1 hour of inactivity. Login again.' : 'Logged out successfully.');
  lastInactiveLogout = false;
}

function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .catch(e => console.warn('SW registration failed:', e));
  }
}

function loadStringArray(key) {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(raw)
      ? raw.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim())
      : [];
  } catch {
    return [];
  }
}

function saveStringArray(key, list) {
  localStorage.setItem(key, JSON.stringify([...new Set(list)]));
}

function showDialog({ title, message, confirmText = 'Confirm', cancelText = 'Cancel', danger = false, input = null }) {
  const modal = document.getElementById('modalDialog');
  const titleEl = document.getElementById('dialogTitle');
  const msgEl = document.getElementById('dialogMessage');
  const inputWrap = document.getElementById('dialogInputWrap');
  const inputEl = document.getElementById('dialogInput');
  const cancelEl = document.getElementById('dialogCancelBtn');
  const confirmEl = document.getElementById('dialogConfirmBtn');

  titleEl.textContent = title;
  msgEl.textContent = message;
  cancelEl.textContent = cancelText;
  confirmEl.textContent = confirmText;
  confirmEl.classList.toggle('btn-danger', !!danger);

  dialogInputMode = input !== null;
  if (dialogInputMode) {
    inputWrap.style.display = 'block';
    inputEl.value = input || '';
    setTimeout(() => inputEl.focus(), 20);
  } else {
    inputWrap.style.display = 'none';
  }

  modal.classList.add('open');

  return new Promise(resolve => {
    dialogResolver = resolve;
  });
}

function dialogCancel() {
  closeModal('modalDialog');
  if (dialogResolver) {
    dialogResolver(null);
    dialogResolver = null;
  }
}

function dialogConfirm() {
  const inputEl = document.getElementById('dialogInput');
  const value = dialogInputMode ? inputEl.value : true;
  closeModal('modalDialog');
  if (dialogResolver) {
    dialogResolver(value);
    dialogResolver = null;
  }
}

function normalizeCategoryName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ');
}

function hasCategoryInsensitive(name, list) {
  const n = name.toLowerCase();
  return list.some(x => x.toLowerCase() === n);
}

// ── Loader / Error ────────────────────────────────────────────
function setLoader(visible) {
  document.getElementById('appLoader').style.display = visible ? 'flex' : 'none';
}

function showError(msg) {
  document.getElementById('errorMsg').textContent = msg;
  document.getElementById('errorBanner').style.display = 'flex';
}

function hideError() {
  document.getElementById('errorBanner').style.display = 'none';
}

// ── Clock ─────────────────────────────────────────────────────
function tick() {
  const n = new Date();
  document.getElementById('clk').textContent =
    n.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  document.getElementById('dtag').textContent =
    n.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  document.getElementById('cartDate').textContent =
    n.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

// ── Page Navigation ───────────────────────────────────────────
function goPage(p, el) {
  document.querySelectorAll('.page').forEach(x => x.classList.remove('on'));
  document.querySelectorAll('.npill').forEach(x => x.classList.remove('on'));
  document.getElementById('page-' + p).classList.add('on');
  el.classList.add('on');

  if (p === 'admin') {
    // Reset admin to dashboard whenever switching back
    document.querySelectorAll('.admin-section').forEach(x => x.classList.remove('on'));
    document.getElementById('sec-dashboard').classList.add('on');
    document.querySelectorAll('.sidebar-item').forEach(x => x.classList.remove('on'));
    document.querySelector('.sidebar-item').classList.add('on');
    renderAdmin('dashboard');
  }
}

// ── Category Strip ────────────────────────────────────────────
function getCats() {
  const stockCats = stocks.map(s => s.cat).filter(Boolean);
  const baseCats = DEFAULT_CATS.filter(c => !hiddenCats.includes(c));
  const allCats = [...new Set([...baseCats, ...customCats, ...stockCats])];
  return ['All', ...allCats];
}

function getEditableCats() {
  return getCats().filter(c => c !== 'All');
}

function populateCategoryOptions(selected = '') {
  const sel = document.getElementById('fCat');
  if (!sel) return;
  const cats = getEditableCats();
  if (!cats.length) cats.push('Others');

  sel.innerHTML = cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  if (selected && !cats.includes(selected)) {
    sel.insertAdjacentHTML('beforeend', `<option value="${esc(selected)}">${esc(selected)}</option>`);
  }
  sel.value = selected && [...cats, selected].includes(selected) ? selected : cats[0];
}

function populateUnitOptions(selected = 'pcs') {
  const sel = document.getElementById('fUnit');
  if (!sel) return;

  sel.innerHTML = UNIT_OPTIONS.map(u => `<option value="${esc(u)}">${esc(u)}</option>`).join('');
  if (selected && !UNIT_OPTIONS.includes(selected)) {
    sel.insertAdjacentHTML('beforeend', `<option value="${esc(selected)}">${esc(selected)}</option>`);
  }
  sel.value = selected && [...UNIT_OPTIONS, selected].includes(selected) ? selected : 'pcs';
}

function renderCats() {
  document.getElementById('catStrip').innerHTML = getCats()
    .map(c => `<button class="cat-btn${c === activeCat ? ' on' : ''}" onclick="setCat('${esc(c)}')">${esc(c)}</button>`)
    .join('');
}

function setCat(c) {
  activeCat = c;
  renderCats();
  renderGrid();
}

// ── Product Grid ──────────────────────────────────────────────
function filterGrid() { renderGrid(); }

function renderGrid() {
  const q  = document.getElementById('searchInput').value.toLowerCase();
  const el = document.getElementById('prodGrid');
  const list = stocks.filter(s =>
    (activeCat === 'All' || s.cat === activeCat) &&
    (s.name.toLowerCase().includes(q) || s.cat.toLowerCase().includes(q))
  );

  if (!list.length) {
    el.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:50px;color:var(--ink4);font-weight:700;font-size:15px">No products found</div>';
    return;
  }

  el.innerHTML = list.map(s => {
    const lo = s.qty > 0 && s.qty <= s.low;
    const oo = s.qty === 0;
    const ci = cart.find(x => x.id === s.id);
    return `<div class="prod-card${oo ? ' oos' : ''}${ci ? ' in-cart' : ''}" onclick="${oo ? '' : `addToCart(${s.id})`}">
      ${lo && !oo ? '<span class="prod-badge b-low">Low</span>' : ''}
      ${oo       ? '<span class="prod-badge b-out">Out</span>' : ''}
      ${ci       ? `<span class="prod-cart-qty">${ci.qty}</span>` : ''}
      <div class="prod-icon">${ICONS[s.cat] || '📦'}</div>
      <div class="prod-name">${esc(s.name)}</div>
      <div class="prod-cat">${esc(s.cat)} · ${esc(s.unit)}</div>
      <div class="prod-price">${f2(s.price)}</div>
      <div class="prod-stock">Stock: ${s.qty}</div>
    </div>`;
  }).join('');
}

// ── Cart ──────────────────────────────────────────────────────
function addToCart(id) {
  const s = stocks.find(x => x.id === id);
  if (!s || s.qty === 0) return;
  const ci = cart.find(x => x.id === id);
  if (ci) {
    if (ci.qty >= s.qty) return;
    ci.qty++;
  } else {
    cart.push({ id, name: s.name, price: s.price, cost: s.cost, qty: 1 });
  }
  renderCart();
  renderGrid();
}

function changeQty(id, d) {
  const ci = cart.find(x => x.id === id);
  const s  = stocks.find(x => x.id === id);
  if (!ci) return;
  ci.qty += d;
  if (ci.qty <= 0) {
    cart = cart.filter(x => x.id !== id);
  } else if (s && ci.qty > s.qty) {
    ci.qty = s.qty;
  }
  renderCart();
  renderGrid();
}

function removeItem(id) {
  cart = cart.filter(x => x.id !== id);
  renderCart();
  renderGrid();
}

function renderCart() {
  const el = document.getElementById('cartList');

  if (!cart.length) {
    el.innerHTML = `<div class="cart-empty">
      <div class="empty-ring">
        <svg viewBox="0 0 24 24" style="width:28px;height:28px;fill:none;stroke:var(--line2);stroke-width:1.5">
          <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
          <line x1="3" y1="6" x2="21" y2="6"/>
          <path d="M16 10a4 4 0 01-8 0"/>
        </svg>
      </div>
      <div class="empty-text">Tap a product to add</div>
    </div>`;
    recalc();
    return;
  }

  el.innerHTML = cart.map(ci => `<div class="cart-item">
    <div class="ci-bar"></div>
    <div class="ci-info">
      <div class="ci-name">${esc(ci.name)}</div>
      <div class="ci-unit">${f2(ci.price)} each</div>
    </div>
    <div class="ci-qty">
      <button class="qty-btn" onclick="changeQty(${ci.id},-1)">−</button>
      <span class="qty-num">${ci.qty}</span>
      <button class="qty-btn" onclick="changeQty(${ci.id},1)">+</button>
    </div>
    <span class="ci-amount">${f2(ci.price * ci.qty)}</span>
    <button class="del-btn" onclick="removeItem(${ci.id})">✕</button>
  </div>`).join('');

  recalc();
}

function recalc() {
  const sub  = cart.reduce((a, c) => a + c.price * c.qty, 0);
  const disc = Math.min(100, Math.max(0, parseFloat(document.getElementById('discInput').value) || 0));
  const da   = sub * disc / 100;
  const tot  = sub - da;
  document.getElementById('fSubtotal').textContent = f2(sub);
  document.getElementById('fDisc').textContent     = '−' + f2(da);
  document.getElementById('fTotal').textContent    = f2(tot);
  document.getElementById('cartCount').textContent = cart.reduce((a, c) => a + c.qty, 0) + ' items';
  document.getElementById('genBtn').disabled       = cart.length === 0;
}

// ── Checkout ──────────────────────────────────────────────────
async function checkout() {
  const btn  = document.getElementById('genBtn');
  const sub  = cart.reduce((a, c) => a + c.price * c.qty, 0);
  const disc = Math.min(100, Math.max(0, parseFloat(document.getElementById('discInput').value) || 0));
  const da   = sub * disc / 100;
  const tot  = sub - da;
  const profit = cart.reduce((a, c) => a + (c.price - c.cost) * c.qty, 0) - da;

  const bn   = 'INV-' + String(nextBillNum).padStart(4, '0');
  const bill = { id: bn, time: new Date(), items: [...cart], sub, disc, da, tot, profit };

  btn.disabled    = true;
  btn.textContent = 'Saving…';

  try {
    await DB.insertBill(bill);

    // Update stock quantities in DB
    await Promise.all(cart.map(ci => {
      const s = stocks.find(x => x.id === ci.id);
      return DB.updateStock(ci.id, {
        qty:  s.qty  - ci.qty,
        sold: (s.sold || 0) + ci.qty,
      });
    }));

    // Sync local state
    cart.forEach(ci => {
      const s = stocks.find(x => x.id === ci.id);
      if (s) { s.qty -= ci.qty; s.sold = (s.sold || 0) + ci.qty; }
    });

    bills.unshift(bill);
    nextBillNum++;
    showReceipt(bill);
  } catch (err) {
    btn.disabled    = false;
    btn.textContent = 'Generate Bill →';
    alert('Error saving bill: ' + err.message);
  }
}

function showReceipt(b) {
  document.getElementById('receiptContent').innerHTML = `<div class="receipt">
    <div class="receipt-header">
      <div class="receipt-brand">BillPro</div>
      <div style="font-size:12px;color:var(--ink4)">${b.time.toLocaleString('en-IN')}</div>
      <div style="font-size:14px;font-weight:800;color:var(--prime);margin-top:3px">${esc(b.id)}</div>
    </div>
    ${b.items.map(i => `<div class="receipt-row">
      <span>${esc(i.name)} × ${i.qty}</span>
      <span style="color:var(--prime);font-weight:700">${f2(i.price * i.qty)}</span>
    </div>`).join('')}
    <hr class="receipt-dash">
    <div class="receipt-row"><span>Subtotal</span><span>${f2(b.sub)}</span></div>
    ${b.disc ? `<div class="receipt-row"><span>Discount (${b.disc}%)</span><span style="color:var(--amber)">−${f2(b.da)}</span></div>` : ''}
    <hr class="receipt-dash">
    <div class="receipt-total"><span>TOTAL</span><span>${f2(b.tot)}</span></div>
    <div style="text-align:center;margin-top:14px;font-size:12px;color:var(--ink4);font-weight:600">Thank you — please visit again!</div>
  </div>`;
  document.getElementById('modalReceipt').classList.add('open');
}

function newBill() {
  cart = [];
  renderCart();
  renderGrid();
  document.getElementById('discInput').value   = '';
  document.getElementById('genBtn').textContent = 'Generate Bill →';
  closeModal('modalReceipt');
}

// ── Admin ─────────────────────────────────────────────────────
function adminNav(s, el) {
  document.querySelectorAll('.sidebar-item').forEach(x => x.classList.remove('on'));
  el.classList.add('on');
  document.querySelectorAll('.admin-section').forEach(x => x.classList.remove('on'));
  document.getElementById('sec-' + s).classList.add('on');
  renderAdmin(s);
}

function renderAdmin(s) {
  const today      = new Date();
  const todayStr   = today.toDateString();
  const todayBills = bills.filter(b => b.time.toDateString() === todayStr);
  const low        = stocks.filter(x => x.qty > 0 && x.qty <= x.low).length;
  const oos        = stocks.filter(x => x.qty === 0).length;

  if (s === 'dashboard') {
    // Build 7-day profit arrays
    const dayLabels = [];
    const dayProfit = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      dayLabels.push(i === 0 ? 'Today' : d.toLocaleDateString('en-IN', { weekday: 'short' }));
      dayProfit.push(
        bills.filter(b => b.time.toDateString() === d.toDateString())
             .reduce((a, b2) => a + b2.profit, 0)
      );
    }
    const maxP = Math.max(...dayProfit, 1);

    document.getElementById('sec-dashboard').innerHTML = `
      <div class="sec-header">
        <div><div class="sec-title">Dashboard</div><div class="sec-sub">Today at a glance</div></div>
      </div>
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-label">Today Revenue</div>
          <div class="stat-value">${f2(todayBills.reduce((a, b2) => a + b2.tot, 0))}</div>
          <div class="stat-change pos">↑ ${todayBills.length} bill${todayBills.length !== 1 ? 's' : ''} today</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Today Profit</div>
          <div class="stat-value" style="color:var(--green)">${f2(todayBills.reduce((a, b2) => a + b2.profit, 0))}</div>
          <div class="stat-change pos">↑ Net earnings</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Low Stock</div>
          <div class="stat-value" style="color:var(--amber)">${low}</div>
          <div class="stat-change" style="color:var(--amber)">Need reorder</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Out of Stock</div>
          <div class="stat-value" style="color:var(--red)">${oos}</div>
          <div class="stat-change neg">Unavailable now</div>
        </div>
      </div>
      <div class="chart-card">
        <div class="chart-label">7-Day Profit Trend</div>
        <div class="bars">
          ${dayProfit.map((v, i) => `
          <div class="bar-col">
            <div class="bar-val">₹${(v / 1000).toFixed(1)}k</div>
            <div class="bar${i === 6 ? ' today' : ''}" style="height:${Math.max((v / maxP) * 100, 5)}px"></div>
            <div class="bar-label">${dayLabels[i]}</div>
          </div>`).join('')}
        </div>
      </div>
      <div class="sec-header"><div class="sec-title">Top Selling Products</div></div>
      <table class="data-table">
        <tr><th>Product</th><th>Units Sold</th><th>Revenue</th><th>Status</th></tr>
        ${[...stocks].sort((a, b2) => (b2.sold || 0) - (a.sold || 0)).slice(0, 5).map(s => `
        <tr>
          <td style="color:var(--ink);font-weight:800">${esc(s.name)}</td>
          <td>${s.sold || 0} ${esc(s.unit)}</td>
          <td style="color:var(--prime);font-weight:800">${f2(s.price * (s.sold || 0))}</td>
          <td><span class="pill ${s.qty === 0 ? 'p-red' : s.qty <= s.low ? 'p-amber' : 'p-green'}">${s.qty === 0 ? 'Out' : s.qty <= s.low ? 'Low' : 'Good'}</span></td>
        </tr>`).join('')}
      </table>`;
  }

  if (s === 'stocks') {
    const categoryStats = getEditableCats().map(c => ({
      name: c,
      count: stocks.filter(x => x.cat === c).length,
    }));

    document.getElementById('sec-stocks').innerHTML = `
      <div class="sec-header">
        <div>
          <div class="sec-title">Stock Management</div>
          <div class="sec-sub">${stocks.length} product${stocks.length !== 1 ? 's' : ''} tracked</div>
        </div>
        <button class="add-btn" onclick="openAddModal()">+ Add Stock</button>
      </div>
      <div class="cat-admin-card">
        <div class="cat-admin-head">
          <div class="cat-admin-title">Categories</div>
          <div class="cat-admin-sub">Create new category or delete existing one</div>
        </div>
        <div class="cat-admin-actions">
          <input class="form-input" id="newCatName" placeholder="New category name">
          <button class="add-btn" onclick="createCategory()">+ Add Category</button>
        </div>
        <div class="cat-admin-list">
          ${categoryStats.map(c => `
            <div class="cat-chip">
              <span>${esc(c.name)} (${c.count})</span>
              ${c.name === 'Others' ? '' : `<button class="cat-chip-btn" data-cat="${esc(c.name)}" onclick="renameCategoryFromBtn(this)" title="Rename category">✎</button>`}
              ${c.name === 'Others' ? '' : `<button class="cat-chip-btn del" data-cat="${esc(c.name)}" onclick="deleteCategoryFromBtn(this)" title="Delete category">✕</button>`}
            </div>
          `).join('') || '<div class="cat-empty">No categories yet</div>'}
        </div>
      </div>
      <table class="data-table">
        <tr><th>Product</th><th>Category</th><th>Cost Price</th><th>Sell Price</th><th>Quantity</th><th>Margin</th><th>Actions</th></tr>
        ${stocks.map(s => {
          const m = s.price > 0 ? ((s.price - s.cost) / s.price * 100).toFixed(1) : '0.0';
          return `<tr>
            <td style="color:var(--ink);font-weight:800">${esc(s.name)}</td>
            <td><span class="pill p-purple">${esc(s.cat)}</span></td>
            <td>${f2(s.cost)}</td>
            <td style="color:var(--prime);font-weight:800">${f2(s.price)}</td>
            <td><span class="pill ${s.qty === 0 ? 'p-red' : s.qty <= s.low ? 'p-amber' : 'p-green'}">${s.qty} ${esc(s.unit)}</span></td>
            <td>${m}%</td>
            <td>
              <div class="row-actions">
                <button class="edit-btn" onclick="editStock(${s.id})">Edit</button>
                <button class="delete-btn" onclick="deleteStock(${s.id})">Delete</button>
              </div>
            </td>
          </tr>`;
        }).join('')}
      </table>`;
  }

  if (s === 'profit') {
    const tC = stocks.reduce((a, x) => a + x.cost  * (x.sold || 0), 0);
    const tR = stocks.reduce((a, x) => a + x.price * (x.sold || 0), 0);
    const gp = tR - tC;

    document.getElementById('sec-profit').innerHTML = `
      <div class="sec-header"><div class="sec-title">Profit Analysis</div></div>
      <div class="stat-grid">
        <div class="stat-card"><div class="stat-label">Total Revenue</div><div class="stat-value">${f2(tR)}</div></div>
        <div class="stat-card"><div class="stat-label">Total Cost</div><div class="stat-value">${f2(tC)}</div></div>
        <div class="stat-card"><div class="stat-label">Gross Profit</div><div class="stat-value" style="color:var(--green)">${f2(gp)}</div></div>
        <div class="stat-card"><div class="stat-label">Average Margin</div><div class="stat-value">${tR > 0 ? (gp / tR * 100).toFixed(1) : '0.0'}%</div></div>
      </div>
      <div class="sec-header" style="margin-top:4px"><div class="sec-title">Product-wise Margins</div></div>
      <table class="data-table">
        <tr><th>Product</th><th>Cost</th><th>Sell</th><th>Margin %</th><th>Profit Earned</th></tr>
        ${[...stocks].sort((a, b2) => {
          const ma = a.price > 0 ? (a.price - a.cost) / a.price : 0;
          const mb = b2.price > 0 ? (b2.price - b2.cost) / b2.price : 0;
          return mb - ma;
        }).map(s => {
          const m = s.price > 0 ? (s.price - s.cost) / s.price * 100 : 0;
          return `<tr>
            <td style="color:var(--ink);font-weight:800">${esc(s.name)}</td>
            <td>${f2(s.cost)}</td>
            <td style="color:var(--prime)">${f2(s.price)}</td>
            <td>
              <div>${m.toFixed(1)}%</div>
              <div class="margin-bar"><div class="margin-fill" style="width:${m}%"></div></div>
            </td>
            <td style="color:var(--green-d);font-weight:800">${f2((s.price - s.cost) * (s.sold || 0))}</td>
          </tr>`;
        }).join('')}
      </table>`;
  }

  if (s === 'bills') {
    document.getElementById('sec-bills').innerHTML = `
      <div class="sec-header">
        <div class="sec-title">Bill History</div>
        <div class="sec-sub">${bills.length} total bill${bills.length !== 1 ? 's' : ''}</div>
      </div>
      <table class="data-table">
        <tr><th>Bill No</th><th>Date &amp; Time</th><th>Items</th><th>Discount</th><th>Total</th><th>Profit</th></tr>
        ${bills.length
          ? bills.map(b => `<tr>
              <td style="color:var(--prime);font-weight:900;font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:.5px">${esc(b.id)}</td>
              <td>${b.time.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' })} · ${b.time.toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' })}</td>
              <td>${b.items.reduce((a, i) => a + i.qty, 0)}</td>
              <td>${b.disc ? b.disc + '%' : '—'}</td>
              <td style="font-weight:800;color:var(--ink)">${f2(b.tot)}</td>
              <td style="color:var(--green-d);font-weight:800">${f2(b.profit)}</td>
            </tr>`).join('')
          : '<tr><td colspan="6" style="text-align:center;color:var(--ink4);padding:40px;font-size:15px;font-weight:700">No bills yet — generate your first bill from Billing</td></tr>'
        }
      </table>`;
  }
}

// ── Stock Modal ───────────────────────────────────────────────
function openAddModal() {
  editId = null;
  document.getElementById('modalTitle').textContent = 'Add New Stock';
  ['fName', 'fCost', 'fSell', 'fQty', 'fLow'].forEach(id => { document.getElementById(id).value = ''; });
  populateCategoryOptions(getEditableCats()[0] || 'Others');
  populateUnitOptions('pcs');
  document.getElementById('modalAdd').classList.add('open');
}

function editStock(id) {
  const s = stocks.find(x => x.id === id);
  if (!s) return;
  editId = id;
  document.getElementById('modalTitle').textContent = 'Edit Stock';
  document.getElementById('fName').value = s.name;
  populateCategoryOptions(s.cat);
  populateUnitOptions(s.unit);
  document.getElementById('fCost').value = s.cost;
  document.getElementById('fSell').value = s.price;
  document.getElementById('fQty').value  = s.qty;
  document.getElementById('fLow').value  = s.low;
  document.getElementById('modalAdd').classList.add('open');
}

function createCategory() {
  const input = document.getElementById('newCatName');
  if (!input) return;

  const cat = normalizeCategoryName(input.value);
  if (!cat) return;

  const allCats = getEditableCats();
  if (hasCategoryInsensitive(cat, allCats)) {
    alert('Category already exists.');
    return;
  }

  customCats.push(cat);
  hiddenCats = hiddenCats.filter(x => x.toLowerCase() !== cat.toLowerCase());
  saveStringArray(CATEGORY_STORAGE_KEY, customCats);
  saveStringArray(HIDDEN_CATEGORY_STORAGE_KEY, hiddenCats);

  input.value = '';
  renderCats();
  renderGrid();
  renderAdmin('stocks');
}

function renameCategoryFromBtn(btn) {
  if (!btn || !btn.dataset) return;
  renameCategory(btn.dataset.cat || '');
}

async function renameCategory(cat) {
  const oldCat = normalizeCategoryName(cat);
  if (!oldCat || oldCat === 'All' || oldCat === 'Others') return;

  const input = await showDialog({
    title: 'Rename Category',
    message: 'Enter a new category name.',
    confirmText: 'Save',
    cancelText: 'Cancel',
    input: oldCat,
  });
  if (input === null) return;

  const newCat = normalizeCategoryName(input);
  if (!newCat || newCat === oldCat) return;

  const allCats = getEditableCats();
  if (hasCategoryInsensitive(newCat, allCats)) {
    await showDialog({
      title: 'Category Exists',
      message: 'This category name already exists. Please choose another name.',
      confirmText: 'OK',
      cancelText: 'Close',
    });
    return;
  }

  const inUse = stocks.filter(s => s.cat === oldCat);
  if (inUse.length) {
    try {
      await Promise.all(inUse.map(s => DB.updateStock(s.id, { cat: newCat })));
      inUse.forEach(s => { s.cat = newCat; });
    } catch (err) {
      await showDialog({
        title: 'Rename Failed',
        message: 'Could not rename category: ' + err.message,
        confirmText: 'OK',
        cancelText: 'Close',
      });
      return;
    }
  }

  customCats = customCats.filter(x => x.toLowerCase() !== oldCat.toLowerCase());
  customCats.push(newCat);

  hiddenCats = hiddenCats.filter(x => x.toLowerCase() !== newCat.toLowerCase());
  if (DEFAULT_CATS.includes(oldCat) && !hiddenCats.includes(oldCat)) {
    hiddenCats.push(oldCat);
  }

  saveStringArray(CATEGORY_STORAGE_KEY, customCats);
  saveStringArray(HIDDEN_CATEGORY_STORAGE_KEY, hiddenCats);

  if (activeCat === oldCat) activeCat = newCat;
  renderCats();
  renderGrid();
  renderAdmin('stocks');
}

function deleteCategoryFromBtn(btn) {
  if (!btn || !btn.dataset) return;
  deleteCategory(btn.dataset.cat || '');
}

async function deleteCategory(cat) {
  const target = normalizeCategoryName(cat);
  if (!target || target === 'All' || target === 'Others') return;

  const inUse = stocks.filter(s => s.cat === target);
  const ok = await showDialog({
    title: 'Delete Category',
    message: inUse.length
      ? `${target} is used by ${inUse.length} product(s). Move them to Others and delete this category?`
      : `Delete category ${target}? This action cannot be undone.`,
    confirmText: 'Delete',
    cancelText: 'Cancel',
    danger: true,
  });
  if (!ok) return;

  if (inUse.length) {
    try {
      await Promise.all(inUse.map(s => DB.updateStock(s.id, { cat: 'Others' })));
      inUse.forEach(s => { s.cat = 'Others'; });
    } catch (err) {
      await showDialog({
        title: 'Delete Failed',
        message: 'Could not delete category: ' + err.message,
        confirmText: 'OK',
        cancelText: 'Close',
      });
      return;
    }
  }

  customCats = customCats.filter(x => x.toLowerCase() !== target.toLowerCase());
  if (DEFAULT_CATS.includes(target) && !hiddenCats.includes(target)) {
    hiddenCats.push(target);
  }

  saveStringArray(CATEGORY_STORAGE_KEY, customCats);
  saveStringArray(HIDDEN_CATEGORY_STORAGE_KEY, hiddenCats);

  if (activeCat === target) activeCat = 'All';
  renderCats();
  renderGrid();
  renderAdmin('stocks');
}

async function deleteStock(id) {
  const stock = stocks.find(x => x.id === id);
  if (!stock) return;

  const ok = await showDialog({
    title: 'Delete Stock',
    message: `Delete ${stock.name} permanently? This action cannot be undone.`,
    confirmText: 'Delete',
    cancelText: 'Cancel',
    danger: true,
  });
  if (!ok) return;

  try {
    await DB.deleteStock(id);
    stocks = stocks.filter(x => x.id !== id);
    cart = cart.filter(x => x.id !== id);

    if (editId === id) {
      editId = null;
      closeModal('modalAdd');
    }

    renderCart();
    renderCats();
    renderGrid();
    renderAdmin('stocks');
  } catch (err) {
    await showDialog({
      title: 'Delete Failed',
      message: 'Could not delete stock: ' + err.message,
      confirmText: 'OK',
      cancelText: 'Close',
    });
  }
}

async function saveStock() {
  const name  = document.getElementById('fName').value.trim();
  const cat   = document.getElementById('fCat').value;
  const unit  = document.getElementById('fUnit').value;
  const cost  = parseFloat(document.getElementById('fCost').value) || 0;
  const price = parseFloat(document.getElementById('fSell').value) || 0;
  const qty   = parseInt(document.getElementById('fQty').value)    || 0;
  const low   = parseInt(document.getElementById('fLow').value)    || 5;

  if (!name || !price) return;

  const saveBtn = document.querySelector('#modalAdd .btn-save');
  saveBtn.disabled    = true;
  saveBtn.textContent = 'Saving…';

  try {
    if (editId) {
      const updated = await DB.updateStock(editId, { name, cat, unit, cost, price, qty, low });
      const idx = stocks.findIndex(x => x.id === editId);
      if (idx !== -1) stocks[idx] = { ...stocks[idx], ...updated };
    } else {
      const inserted = await DB.insertStock({ name, cat, unit, cost, price, qty, low, sold: 0 });
      stocks.push(inserted);
    }
    closeModal('modalAdd');
    renderCats();
    renderGrid();
    renderAdmin('stocks');
  } catch (err) {
    alert('Error saving: ' + err.message);
  } finally {
    saveBtn.disabled    = false;
    saveBtn.textContent = 'Save Stock';
  }
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}
