// ========== THEME TOGGLE ==========
function initTheme() {
    const saved = localStorage.getItem('subhub-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = saved || 'light';
    document.documentElement.setAttribute('data-theme', theme);
}
function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('subhub-theme', next); } catch(e) {}
}
initTheme();

// ========== FIREBASE CONFIG ==========
const firebaseConfig = {
  apiKey: "AIzaSyA_o-TYvRGsEi-goWEny7iO75SfTD-wNXw",
  authDomain: "subhub26-5659d.firebaseapp.com",
  projectId: "subhub26-5659d",
  storageBucket: "subhub26-5659d.firebasestorage.app",
  messagingSenderId: "930508961641",
  appId: "1:930508961641:web:daac7eb58c5f1774fbeff8",
  measurementId: "G-GZ9V7XT6V1"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Admin emails (can view all orders)
const ADMIN_EMAILS = [
  "amazawilliam@gmail.com",
  "admin@subhub.com"
];

const USD_RATE = 1420;
function toUsd(ngn) {
    return (Number(ngn) / USD_RATE).toFixed(2);
}
function priceLabel(ngn) {
    const n = Number(ngn) || 0;
    return '₦' + n.toLocaleString() + ' <span class="usd-tag">$' + toUsd(n) + '</span>';
}
function setPriceEl(id, ngn) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = priceLabel(ngn);
}

// ========== SAFE STORAGE (cart only) ==========
function safeGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
}
function safeSet(key, val) {
    try { localStorage.setItem(key, val); } catch (e) {}
}

// ========== PROMO CODE SYSTEM ==========
// Weekend Special: Sat 5:00pm → Mon 12:00am (Africa/Lagos)
// Midweek Special: Wed 12:00am → Thu 12:00am (Africa/Lagos)
// Codes rotate every week (deterministic from week number)
let appliedPromo = false;
let appliedPromoCode = null;
let promoBannerDismissed = false;

function getLagosDate(base = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Africa/Lagos',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false, weekday: 'short'
    }).formatToParts(base);
    const map = {};
    parts.forEach(p => { if (p.type !== 'literal') map[p.type] = p.value; });
    const hour = parseInt(map.hour === '24' ? '0' : map.hour, 10);
    const minute = parseInt(map.minute, 10);
    const second = parseInt(map.second, 10);
    const month = parseInt(map.month, 10) - 1;
    const day = parseInt(map.day, 10);
    const year = parseInt(map.year, 10);
    // Local-like Date for day-of-week math (not absolute UTC)
    const d = new Date(year, month, day, hour, minute, second);
    const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    d._watDay = weekdayMap[map.weekday] ?? d.getDay();
    d._watHour = hour;
    d._watMinute = minute;
    return d;
}

function getISOWeekId(d) {
    // d is Lagos wall-clock date
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    return date.getUTCFullYear() + '-W' + String(week).padStart(2, '0');
}

function hashCode(seed) {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) {
        h ^= seed.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36).toUpperCase().padStart(6, '0').slice(0, 6);
}

function weekendCodeForDate(lagosDate) {
    // Anchor to the Saturday that starts this weekend window
    const day = lagosDate._watDay;
    const anchor = new Date(lagosDate.getFullYear(), lagosDate.getMonth(), lagosDate.getDate());
    if (day === 0) anchor.setDate(anchor.getDate() - 1); // Sunday → previous Sat
    if (day === 1) anchor.setDate(anchor.getDate() - 2); // Monday early → previous Sat
    return 'WKN' + hashCode('subhub-weekend-' + getISOWeekId(anchor)).slice(0, 5);
}

function midweekCodeForDate(lagosDate) {
    const anchor = new Date(lagosDate.getFullYear(), lagosDate.getMonth(), lagosDate.getDate());
    // If somehow edge, still use that calendar week's Wed
    return 'MID' + hashCode('subhub-midweek-' + getISOWeekId(anchor)).slice(0, 5);
}

/** @returns {{ active: boolean, type: 'weekend'|'midweek'|null, name: string, code: string|null, endsHint: string }} */
function getActivePromo() {
    try {
        const wat = getLagosDate();
        const day = wat._watDay;
        const hour = wat._watHour;
        const minute = wat._watMinute;
        const mins = hour * 60 + minute;

        // Weekend: Sat 17:00 inclusive → Mon 00:00 exclusive
        const isWeekend =
            (day === 6 && mins >= 17 * 60) || // Sat from 5pm
            (day === 0); // all Sunday
            // Monday 00:00+ is day===1 → not included

        if (isWeekend) {
            return {
                active: true,
                type: 'weekend',
                name: 'Weekend Special',
                code: weekendCodeForDate(wat),
                rate: 0.05,
                endsHint: 'Ends Monday 12:00am'
            };
        }

        // Midweek: Wed 00:00 inclusive → Thu 00:00 exclusive (= all Wednesday)
        if (day === 3) {
            return {
                active: true,
                type: 'midweek',
                name: 'Midweek Special',
                code: midweekCodeForDate(wat),
                rate: 0.03,
                endsHint: 'Ends Thursday 12:00am'
            };
        }

        return { active: false, type: null, name: '', code: null, rate: 0, endsHint: '' };
    } catch (e) {
        console.warn('getActivePromo', e);
        return { active: false, type: null, name: '', code: null, endsHint: '' };
    }
}

function isPromoActive() {
    return getActivePromo().active;
}

function getCurrentPromoCode() {
    const p = getActivePromo();
    return p.active ? p.code : null;
}

function applyPromo() {
    const input = document.getElementById('promo-input');
    const msg = document.getElementById('promo-message');
    if (!input || !msg) return;

    const code = input.value.trim().toUpperCase();
    const promo = getActivePromo();

    if (!promo.active) {
        msg.className = 'text-xs mt-2 text-red-400';
        msg.textContent = 'No promo is active right now. Weekend: Sat 5pm–Mon 12am · Midweek: all day Wednesday.';
        msg.classList.remove('hidden');
        appliedPromo = false;
        appliedPromoCode = null;
        updateCartUI();
        return;
    }

    if (code === promo.code) {
        appliedPromo = true;
        appliedPromoCode = promo.code;
        msg.className = 'text-xs mt-2 text-emerald-400';
        const pct = Math.round((promo.rate || 0) * 100);
        msg.innerHTML = '<i class="fa-solid fa-check-circle mr-1"></i> ' + pct + '% ' + promo.name + ' applied!';
        msg.classList.remove('hidden');
        input.disabled = true;
        updateCartUI();
    } else if (code === '') {
        msg.className = 'text-xs mt-2 text-zinc-500';
        msg.textContent = 'Enter a promo code';
        msg.classList.remove('hidden');
    } else {
        appliedPromo = false;
        appliedPromoCode = null;
        msg.className = 'text-xs mt-2 text-red-400';
        msg.textContent = 'Invalid or expired promo code';
        msg.classList.remove('hidden');
        updateCartUI();
    }
}

function getCartTotals() {
    let subtotal = 0;
    cart.forEach(item => subtotal += item.price);
    const promo = getActivePromo();
    const rate = (promo.rate != null) ? promo.rate : 0;
    const discount = (appliedPromo && promo.active && appliedPromoCode === promo.code)
        ? Math.round(subtotal * rate) : 0;
    const total = subtotal - discount;
    return { subtotal, discount, total };
}

function showPromoBanner() {
    const banner = document.getElementById('promo-banner');
    if (!banner) return;
    const promo = getActivePromo();
    if (promo.active && !promoBannerDismissed) {
        const nameEl = document.getElementById('promo-banner-name');
        const codeEl = document.getElementById('promo-banner-code');
        const hintEl = document.getElementById('promo-banner-hint');
        if (nameEl) nameEl.textContent = promo.name + ' is live!';
        if (codeEl) codeEl.textContent = promo.code;
        if (hintEl) {
            const pct = Math.round((promo.rate || 0) * 100);
            hintEl.textContent = pct + '% off · ' + promo.endsHint + ' · Tap code to copy';
        }
        banner.classList.remove('hidden');
    } else {
        banner.classList.add('hidden');
    }
}

function dismissPromoBanner() {
    promoBannerDismissed = true;
    const banner = document.getElementById('promo-banner');
    if (banner) banner.classList.add('hidden');
}

async function copyPromoCode() {
    const promo = getActivePromo();
    if (!promo.active || !promo.code) return;
    try {
        await navigator.clipboard.writeText(promo.code);
    } catch (e) {
        // fallback
        const ta = document.createElement('textarea');
        ta.value = promo.code;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (err) {}
        document.body.removeChild(ta);
    }
    // Prefill cart promo input
    const input = document.getElementById('promo-input');
    if (input) {
        input.value = promo.code;
        input.disabled = false;
    }
    const toast = document.getElementById('promo-copy-toast');
    if (toast) {
        toast.textContent = 'Code copied: ' + promo.code;
        toast.classList.remove('hidden');
        setTimeout(() => toast.classList.add('hidden'), 2000);
    }
    // Auto-apply
    applyPromo();
}

// ========== CART ==========
let cart = [];
try {
    const saved = safeGet('subhub_cart');
    if (saved) cart = JSON.parse(saved);
} catch (e) { cart = []; }

function saveCart() {
    safeSet('subhub_cart', JSON.stringify(cart));
    updateCartUI();
}

function updateCartUI() {
    const countEl = document.getElementById('cart-count');
    const itemsEl = document.getElementById('cart-items');
    const totalEl = document.getElementById('cart-total');
    const subtotalEl = document.getElementById('cart-subtotal');
    const discountEl = document.getElementById('cart-discount');
    const discountRow = document.getElementById('cart-discount-row');

    if (!countEl) return;

    if (cart.length === 0) {
        countEl.classList.add('hidden');
        if (itemsEl) itemsEl.innerHTML = `<div class="text-center py-12 text-zinc-500"><i class="fa-solid fa-cart-shopping text-4xl mb-3 opacity-40"></i><p>Your cart is empty</p><p class="text-xs mt-1">Add services from the catalog</p></div>`;
        if (totalEl) totalEl.textContent = '₦0';
        if (subtotalEl) subtotalEl.textContent = '₦0';
        if (discountRow) discountRow.classList.add('hidden');
        appliedPromo = false;
        const input = document.getElementById('promo-input');
        if (input) { input.disabled = false; input.value = ''; }
        const msg = document.getElementById('promo-message');
        if (msg) msg.classList.add('hidden');
        return;
    }

    countEl.classList.remove('hidden');
    countEl.textContent = cart.length;
    countEl.classList.add('cart-badge');

    if (itemsEl) {
        itemsEl.innerHTML = cart.map((item, index) => {
            return `<div class="bg-zinc-800 border border-zinc-700 rounded-xl p-4 flex justify-between items-start gap-3">
                <div class="flex-1 min-w-0">
                    <div class="font-medium truncate">${item.name}</div>
                    <div class="text-xs text-zinc-400">${item.option}${item.note ? ' · ' + item.note : ''}</div>
                    <div class="text-emerald-400 font-semibold mt-1">₦${item.price.toLocaleString()} <span class="usd-tag">$${toUsd(item.price)}</span></div>
                </div>
                <button onclick="removeFromCart(${index})" class="text-zinc-500 hover:text-red-400 p-1"><i class="fa-solid fa-trash text-sm"></i></button>
            </div>`;
        }).join('');
    }

    // Re-validate promo if window expired
    if (appliedPromo && !isPromoActive()) {
        appliedPromo = false;
        appliedPromoCode = null;
        const msg = document.getElementById('promo-message');
        if (msg) {
            msg.className = 'text-xs mt-2 text-red-400';
            msg.textContent = 'Promo period has ended.';
            msg.classList.remove('hidden');
        }
        const input = document.getElementById('promo-input');
        if (input) input.disabled = false;
    }

    const { subtotal, discount, total } = getCartTotals();

    if (subtotalEl) subtotalEl.innerHTML = '₦' + subtotal.toLocaleString() + ' <span class="usd-tag">$' + toUsd(subtotal) + '</span>';
    if (totalEl) totalEl.innerHTML = '₦' + total.toLocaleString() + ' <span class="usd-tag">$' + toUsd(total) + '</span>';

    if (discountRow && discountEl) {
        if (discount > 0) {
            discountRow.classList.remove('hidden');
            discountEl.textContent = '−₦' + discount.toLocaleString();
        } else {
            discountRow.classList.add('hidden');
        }
    }
}

function addToCart(name, option, price, note) {
    cart.push({ name, option, price, note: note || null });
    saveCart();
    const btn = event.target;
    const original = btn.innerHTML;
    btn.innerHTML = '✓ Added';
    btn.classList.add('bg-emerald-700');
    setTimeout(() => { btn.innerHTML = original; btn.classList.remove('bg-emerald-700'); }, 900);
}

function removeFromCart(index) { cart.splice(index, 1); saveCart(); }
function clearCart() {
    cart = [];
    appliedPromo = false;
    appliedPromoCode = null;
    const input = document.getElementById('promo-input');
    if (input) { input.disabled = false; input.value = ''; }
    const msg = document.getElementById('promo-message');
    if (msg) msg.classList.add('hidden');
    saveCart();
}

function toggleCart() {
    const sidebar = document.getElementById('cart-sidebar');
    sidebar.classList.toggle('hidden');
    if (!sidebar.classList.contains('hidden')) updateCartUI();
}

function generateOrderId() {
    const num = Math.floor(10000000 + Math.random() * 90000000);
    return 'SUBHUB-' + num;
}

function formatOrderDate() {
    return new Date().toLocaleString('en-US', {
        timeZone: 'Africa/Lagos',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    });
}

function estimateExpiryFromOption(option) {
    const d = new Date();
    const text = (option || '').toLowerCase();
    if (text.includes('3 year') || text.includes('3 years')) d.setFullYear(d.getFullYear() + 3);
    else if (text.includes('1 year') || text.includes('12 month') || text.includes('12 months')) d.setFullYear(d.getFullYear() + 1);
    else if (text.includes('6 month') || text.includes('6 months')) d.setMonth(d.getMonth() + 6);
    else if (text.includes('3 month') || text.includes('3 months')) d.setMonth(d.getMonth() + 3);
    else if (text.includes('30 day') || text.includes('1 month') || text.includes('1 months')) d.setMonth(d.getMonth() + 1);
    else if (text.includes('14 day')) d.setDate(d.getDate() + 14);
    else if (text.includes('7 day')) d.setDate(d.getDate() + 7);
    else d.setMonth(d.getMonth() + 1); // default 1 month
    return d.toISOString().split('T')[0];
}

async function autoAddSubscriptionsFromOrder(items, orderId) {
    if (!currentUser || !items || !items.length) return;
    try {
        const userRef = db.collection('users').doc(currentUser.uid);
        await userRef.set({
            name: currentUser.displayName || (currentUser.email || '').split('@')[0],
            email: currentUser.email,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        for (const item of items) {
            await userRef.collection('subscriptions').add({
                name: item.name,
                plan: item.option,
                expiry: estimateExpiryFromOption(item.option),
                status: 'pending',
                orderId: orderId || null,
                orderLinked: true,
                added: firebase.firestore.FieldValue.serverTimestamp()
            });
        }
        await loadUserSubscriptions();
    } catch (e) {
        console.error('Auto-add subscriptions failed', e);
    }
}

async function saveOrderToFirestore(order) {
    const payload = {
        orderId: order.orderId,
        items: order.items || [],
        subtotal: Number(order.subtotal) || 0,
        discount: Number(order.discount) || 0,
        promoCode: order.promoCode || null,
        total: Number(order.total) || 0,
        status: order.status || 'pending',
        customerEmail: order.customerEmail || null,
        customerName: order.customerName || null,
        customerUid: order.customerUid || null,
        dateStr: order.dateStr || '',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    try {
        try { await db.enableNetwork(); } catch (e) {}
        await db.collection('orders').doc(String(order.orderId)).set(payload);
        if (currentUser && order.items && order.items.length) {
            autoAddSubscriptionsFromOrder(order.items, order.orderId);
        }
        console.log('Order saved:', order.orderId);
        createNotification({
            toRole: 'admin',
            title: 'New order',
            body: (order.orderId || '') + ' — ₦' + Number(order.total || 0).toLocaleString(),
            type: 'order'
        });
        if (currentUser) {
            createNotification({
                toUid: currentUser.uid,
                title: 'Order sent',
                body: 'Your order ' + (order.orderId || '') + ' is pending confirmation.',
                type: 'order'
            });
        }
        return true;
    } catch (e) {
        console.error('Failed to save order', e.code, e.message, e);
        try {
            await db.collection('orders').add(payload);
            console.log('Order saved via add()');
            if (currentUser && order.items && order.items.length) {
                autoAddSubscriptionsFromOrder(order.items, order.orderId);
            }
            return true;
        } catch (e2) {
            console.error('Order save retry failed', e2.code, e2.message);
            alert('Order opened on WhatsApp, but was NOT saved to the dashboard.\n\nFirebase error: ' + (e2.code || e.code || 'unknown') + '\n' + (e2.message || e.message || '') + '\n\nPublish Firestore rules, then try again.');
            return false;
        }
    }
}


function getCustomerName() {
    if (currentUser) {
        return (currentUser.displayName || '').trim()
            || (currentUser.email || '').split('@')[0]
            || 'Customer';
    }
    return 'Guest';
}

function checkoutWhatsApp() {
    if (cart.length === 0) { alert('Your cart is empty.'); return; }
    requireAccountForOrder(() => checkoutWhatsAppNow());
}
function checkoutWhatsAppNow() {
    if (cart.length === 0) { alert('Your cart is empty.'); return; }
    const customerName = getCustomerName();
    if (!customerName) return;

    const { subtotal, discount, total } = getCartTotals();
    const orderId = generateOrderId();
    const orderDate = formatOrderDate();

    const items = cart.map(item => ({
        name: item.name,
        option: item.option,
        price: item.price,
        note: item.note || null
    }));

    let message = 'Hello SubHub 👋\nI would like to order the following:\n\n';
    items.forEach((item, i) => {
        message += `${i+1}. ${item.name} (${item.option}) — ₦${item.price.toLocaleString()} ($${toUsd(item.price)})\n`;
        if (item.note) message += `   X account: ${item.note}\n`;
    });

    message += `\nSubtotal: ₦${subtotal.toLocaleString()}`;
    if (discount > 0) {
        const promo = getActivePromo();
        const pct = Math.round((promo.rate || 0) * 100) || 3;
        message += `\nPromo Code: ${appliedPromoCode || getCurrentPromoCode() || ''}`;
        message += `\nDiscount (${pct}%): −₦${discount.toLocaleString()}`;
    }
    message += `\nTotal: ₦${total.toLocaleString()} ($${toUsd(total)})`;
    message += `\n\n👤 Name: ${customerName}`;
    if (currentUser && currentUser.email) message += `\n📧 Email: ${currentUser.email}`;
    message += `\n\n🆔 Order ID: ${orderId}`;
    message += `\n📅 Date: ${orderDate}`;
    message += `\n\nPlease confirm availability and payment details.`;

    // Open WhatsApp FIRST (must stay in user click — don't await Firestore)
    window.open(`https://wa.me/2348132983965?text=${encodeURIComponent(message)}`, '_blank');

    // Save order in background
    saveOrderToFirestore({
        orderId,
        items,
        subtotal,
        discount: discount || 0,
        promoCode: discount > 0 ? (appliedPromoCode || getCurrentPromoCode()) : null,
        total,
        status: 'pending',
        customerEmail: currentUser ? currentUser.email : null,
        customerName: customerName,
        customerUid: currentUser ? currentUser.uid : null,
        dateStr: orderDate
    });
}

// ========== AUTH STATE ==========
let currentUser = null;
let userSubs = [];

auth.onAuthStateChanged((user) => {
    currentUser = user;
    updateUserArea();
    if (user) {
        loadUserSubscriptions();
        startNotificationListener();
        runPendingOrderIfReady();
    } else {
        userSubs = [];
        stopNotificationListener();
    }
});

function updateUserArea() {
    const area = document.getElementById('user-area');
    if (!area) return;

    const mDash = document.getElementById('mobile-nav-dashboard');
    const mLogin = document.getElementById('mobile-nav-login');
    const mSignup = document.getElementById('mobile-nav-signup');
    const mLogout = document.getElementById('mobile-nav-logout');
    const navDash = document.getElementById('nav-dashboard');

    if (currentUser) {
        const name = currentUser.displayName || currentUser.email.split('@')[0];
        area.innerHTML = `
            <button onclick="showDashboard()" class="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-blue-700 hover:bg-blue-600 text-white transition-all" title="My Dashboard">
                <i class="fa-solid fa-gauge-high text-sm"></i>
                <span class="text-sm font-medium">${name.split(' ')[0]}</span>
            </button>
            <button onclick="logoutUser()" class="text-xs px-2.5 sm:px-3 py-2 rounded-xl border border-zinc-700 hover:bg-zinc-800 text-zinc-400">Logout</button>
        `;
        if (navDash) navDash.classList.remove('hidden');
        if (mDash) mDash.classList.remove('hidden');
        if (mLogin) mLogin.classList.add('hidden');
        if (mSignup) mSignup.classList.add('hidden');
        if (mLogout) mLogout.classList.remove('hidden');
        const heroSignup = document.getElementById('hero-signup-btn');
        if (heroSignup) heroSignup.classList.add('hidden');
        const notifBtn = document.getElementById('notif-btn');
        if (notifBtn) notifBtn.classList.remove('hidden');
    } else {
        area.innerHTML = `
            <button onclick="showLogin()" class="text-sm px-3 sm:px-4 py-2 rounded-xl border border-zinc-700 hover:bg-zinc-900 font-medium transition-all">Log In</button>
            <button onclick="showSignup()" class="text-sm px-3 sm:px-4 py-2 rounded-xl bg-white text-zinc-950 font-semibold hover:bg-zinc-100 transition-all">Sign Up</button>
        `;
        if (navDash) navDash.classList.add('hidden');
        if (mDash) mDash.classList.add('hidden');
        if (mLogin) mLogin.classList.remove('hidden');
        if (mSignup) mSignup.classList.remove('hidden');
        if (mLogout) mLogout.classList.add('hidden');
        const heroSignup = document.getElementById('hero-signup-btn');
        if (heroSignup) heroSignup.classList.remove('hidden');
        const notifBtn = document.getElementById('notif-btn');
        if (notifBtn) notifBtn.classList.add('hidden');
        hideNotifPanel();
    }
}

function togglePassword(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const icon = btn.querySelector('i');
    if (input.type === 'password') {
        input.type = 'text';
        if (icon) { icon.classList.remove('fa-eye'); icon.classList.add('fa-eye-slash'); }
    } else {
        input.type = 'password';
        if (icon) { icon.classList.remove('fa-eye-slash'); icon.classList.add('fa-eye'); }
    }
}

function showSignupSuccess(email) {
    const modal = document.getElementById('signup-success-modal');
    const emailEl = document.getElementById('signup-success-email');
    if (emailEl) emailEl.textContent = email || '';
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
}

function hideSignupSuccess() {
    const modal = document.getElementById('signup-success-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

async function goToLoginAfterSignup() {
    hideSignupSuccess();
    try { await auth.signOut(); } catch (e) {}
    showLogin();
}

function showLogin() {
    document.getElementById('login-modal').classList.remove('hidden');
    document.getElementById('login-modal').classList.add('flex');
    document.body.classList.add('modal-open');
}
function hideLogin() {
    document.getElementById('login-modal').classList.add('hidden');
    document.getElementById('login-modal').classList.remove('flex');
    document.body.classList.remove('modal-open');
}
function showSignup() {
    document.getElementById('signup-modal').classList.remove('hidden');
    document.getElementById('signup-modal').classList.add('flex');
    document.body.classList.add('modal-open');
}
function hideSignup() {
    document.getElementById('signup-modal').classList.add('hidden');
    document.getElementById('signup-modal').classList.remove('flex');
    document.body.classList.remove('modal-open');
}

let pendingOrderFn = null;

function requireAccountForOrder(fn) {
    if (currentUser) { fn(); return; }
    pendingOrderFn = fn;
    const modal = document.getElementById('order-signup-modal');
    if (!modal) { fn(); return; }
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.body.classList.add('modal-open');
}

function hideOrderSignupPrompt() {
    const modal = document.getElementById('order-signup-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    document.body.classList.remove('modal-open');
}

function chooseSignupForOrder() {
    hideOrderSignupPrompt();
    showSignup();
}

function chooseLoginForOrder() {
    hideOrderSignupPrompt();
    showLogin();
}

function continueGuestOrder() {
    const fn = pendingOrderFn;
    pendingOrderFn = null;
    hideOrderSignupPrompt();
    if (fn) fn();
}

function runPendingOrderIfReady() {
    if (!pendingOrderFn || !currentUser) return false;
    const fn = pendingOrderFn;
    pendingOrderFn = null;
    hideOrderSignupPrompt();
    fn();
    return true;
}
function showResetPassword() {
    const modal = document.getElementById('reset-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    const loginEmail = document.getElementById('login-email');
    const resetEmail = document.getElementById('reset-email');
    if (loginEmail && resetEmail && loginEmail.value) resetEmail.value = loginEmail.value;
    const msg = document.getElementById('reset-msg');
    if (msg) msg.classList.add('hidden');
}
function hideResetPassword() {
    const modal = document.getElementById('reset-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}
let resetCooldownTimer = null;
let resetCooldownLeft = 0;

function startResetCooldown(btn) {
    resetCooldownLeft = 60;
    if (btn) {
        btn.disabled = true;
        btn.classList.add('opacity-60', 'cursor-not-allowed');
    }
    if (resetCooldownTimer) clearInterval(resetCooldownTimer);
    resetCooldownTimer = setInterval(() => {
        resetCooldownLeft -= 1;
        if (btn) btn.textContent = resetCooldownLeft > 0 ? ('Wait ' + resetCooldownLeft + 's') : 'Send Reset Link';
        if (resetCooldownLeft <= 0) {
            clearInterval(resetCooldownTimer);
            resetCooldownTimer = null;
            if (btn) {
                btn.disabled = false;
                btn.classList.remove('opacity-60', 'cursor-not-allowed');
                btn.textContent = 'Send Reset Link';
            }
        }
    }, 1000);
}

async function resetPassword() {
    const email = (document.getElementById('reset-email') || {}).value.trim().toLowerCase();
    const msg = document.getElementById('reset-msg');
    const btn = document.querySelector('#reset-modal button[onclick="resetPassword()"]');

    if (resetCooldownLeft > 0) {
        if (msg) {
            msg.className = 'text-xs text-center mt-3 text-amber-400';
            msg.textContent = 'Please wait ' + resetCooldownLeft + 's before requesting another link.';
            msg.classList.remove('hidden');
        }
        return;
    }

    if (!email) {
        if (msg) {
            msg.className = 'text-xs text-center mt-3 text-red-400';
            msg.textContent = 'Please enter your email address.';
            msg.classList.remove('hidden');
        }
        return;
    }
    try {
        await auth.sendPasswordResetEmail(email);
        startResetCooldown(btn);
        if (msg) {
            msg.className = 'text-xs text-center mt-3 text-emerald-400';
            msg.textContent = 'Reset link sent! Check your email (and spam folder). You can request another link in 60 seconds.';
            msg.classList.remove('hidden');
        }
    } catch (err) {
        console.error(err);
        let t = 'Could not send reset email. Try again.';
        if (err.code === 'auth/user-not-found') t = 'No account found with that email.';
        if (err.code === 'auth/invalid-email') t = 'Please enter a valid email address.';
        if (err.code === 'auth/too-many-requests') t = 'Too many attempts. Please wait and try again.';
        if (msg) {
            msg.className = 'text-xs text-center mt-3 text-red-400';
            msg.textContent = t;
            msg.classList.remove('hidden');
        }
    }
}

async function signupUser() {
    const name = document.getElementById('signup-name').value.trim();
    const email = document.getElementById('signup-email').value.trim().toLowerCase();
    const password = document.getElementById('signup-password').value;

    if (!name || !email || !password) {
        alert('Please fill in all fields.');
        return;
    }
    if (password.length < 6) {
        alert('Password must be at least 6 characters.');
        return;
    }

    try {
        const cred = await auth.createUserWithEmailAndPassword(email, password);
        await cred.user.updateProfile({ displayName: name });

        // Save user profile to Firestore
        await db.collection('users').doc(cred.user.uid).set({
            name: name,
            email: email,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            isAdmin: false
        });

        // Send registration / verification email
        try {
            await cred.user.sendEmailVerification();
        } catch (mailErr) {
            console.warn('Verification email failed', mailErr);
        }

        createNotification({
            toUid: cred.user.uid,
            title: 'Welcome to SubHub',
            body: 'Your account is ready. Log in to track orders and expiry dates.',
            type: 'system'
        });
        createNotification({
            toRole: 'admin',
            title: 'New signup',
            body: name + ' (' + email + ') created an account.',
            type: 'signup'
        });
        hideSignup();
        // Sign out so user is prompted to log in intentionally
        try { await auth.signOut(); } catch (e) {}
        showSignupSuccess(email);
    } catch (err) {
        console.error(err);
        if (err.code === 'auth/email-already-in-use') {
            alert('This email is already registered. Please log in.');
        } else {
            alert('Error: ' + err.message);
        }
    }
}

async function loginUser() {
    const email = document.getElementById('login-email').value.trim().toLowerCase();
    const password = document.getElementById('login-password').value;

    if (!email || !password) {
        alert('Please enter email and password.');
        return;
    }

    try {
        await auth.signInWithEmailAndPassword(email, password);
        hideLogin();
        if (!runPendingOrderIfReady()) showDashboard();
    } catch (err) {
        console.error(err);
        if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
            alert('Wrong email or password.');
        } else {
            alert('Error: ' + err.message);
        }
    }
}


async function ensureUserProfile(user) {
    if (!user) return;
    try {
        const ref = db.collection('users').doc(user.uid);
        const snap = await ref.get();
        if (!snap.exists) {
            await ref.set({
                name: user.displayName || (user.email || '').split('@')[0] || 'User',
                email: user.email || '',
                photoURL: user.photoURL || null,
                provider: (user.providerData && user.providerData[0] && user.providerData[0].providerId) || 'password',
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                isAdmin: false
            });
            createNotification({
                toUid: user.uid,
                title: 'Welcome to SubHub',
                body: 'Your account is ready. Track orders from your dashboard.',
                type: 'system'
            });
            createNotification({
                toRole: 'admin',
                title: 'New signup',
                body: (user.email || 'A user') + ' signed in with Google.',
                type: 'signup'
            });
        } else {
            await ref.set({
                name: user.displayName || snap.data().name || '',
                email: user.email || snap.data().email || '',
                photoURL: user.photoURL || snap.data().photoURL || null,
                lastLoginAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        }
    } catch (e) {
        console.warn('ensureUserProfile', e);
    }
}

async function loginWithGoogle() {
    try {
        const provider = new firebase.auth.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        const result = await auth.signInWithPopup(provider);
        await ensureUserProfile(result.user);
        hideLogin();
        hideSignup();
        document.body.classList.remove('modal-open');
        if (!runPendingOrderIfReady()) showDashboard();
    } catch (err) {
        console.error(err);
        if (err.code === 'auth/popup-closed-by-user') return;
        if (err.code === 'auth/popup-blocked') {
            alert('Popup was blocked. Allow popups for this site, or try again.');
            return;
        }
        if (err.code === 'auth/operation-not-allowed') {
            alert('Google sign-in is not enabled yet.\n\nIn Firebase Console → Authentication → Sign-in method → enable Google.');
            return;
        }
        if (err.code === 'auth/unauthorized-domain') {
            alert('This domain is not authorized.\n\nFirebase → Authentication → Settings → Authorized domains\nAdd: subhub26.com.ng and www.subhub26.com.ng');
            return;
        }
        alert('Google sign-in failed: ' + (err.message || err.code || 'unknown error'));
    }
}

async function logoutUser() {
    await auth.signOut();
    hideDashboard();
}

// ========== DASHBOARD & SUBSCRIPTIONS ==========
async function loadUserSubscriptions() {
    if (!currentUser) return;
    try {
        const snap = await db.collection('users').doc(currentUser.uid)
            .collection('subscriptions')
            .get();

        userSubs = [];
        snap.forEach(doc => {
            userSubs.push({ id: doc.id, ...doc.data() });
        });
        // Sort client-side by expiry
        userSubs.sort((a, b) => {
            const da = a.expiry ? new Date(a.expiry).getTime() : 0;
            const db_ = b.expiry ? new Date(b.expiry).getTime() : 0;
            return da - db_;
        });
    } catch (e) {
        console.error('Error loading subscriptions', e);
        userSubs = [];
        // Common cause: Firestore rules expired (test mode lasts 30 days)
        if (e && (e.code === 'permission-denied' || String(e.message).includes('permission'))) {
            console.warn('Firestore permission denied — update your security rules in Firebase Console.');
        }
    }
}

function isAdmin() {
    if (!currentUser || !currentUser.email) return false;
    return ADMIN_EMAILS.includes(currentUser.email.toLowerCase());
}

let allOrders = [];

async function showDashboard() {
    if (!currentUser) {
        showLogin();
        return;
    }

    const view = document.getElementById('dashboard-view');
    view.classList.remove('hidden');
    document.body.classList.add('modal-open');

    const name = currentUser.displayName || currentUser.email.split('@')[0];
    const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

    // Show UI immediately (don't wait for network)
    document.getElementById('dashboard-user-info').innerHTML = `
        <div class="w-12 h-12 bg-blue-700 rounded-xl flex items-center justify-center text-lg font-bold">
            ${initials}
        </div>
        <div class="flex-1">
            <div class="font-semibold">${name}</div>
            <div class="text-sm text-zinc-400">${currentUser.email}</div>
            <div id="admin-stats-slot" class="text-xs text-zinc-500 mt-1">Loading…</div>
        </div>
    `;
    const list = document.getElementById('subscriptions-list');
    if (list) list.innerHTML = `<div class="text-center py-8 text-zinc-500 text-sm">Loading subscriptions…</div>`;

    const ordersPanel = document.getElementById('admin-orders-panel');
    if (isAdmin()) {
        if (ordersPanel) ordersPanel.classList.remove('hidden');
        loadAdminOrders();
        // Admin signup count in background
        db.collection('users').get().then(usersSnap => {
            const slot = document.getElementById('admin-stats-slot');
            if (slot) slot.innerHTML = `<span class="text-indigo-300 font-semibold">${usersSnap.size} total signups</span>`;
        }).catch(() => {
            const slot = document.getElementById('admin-stats-slot');
            if (slot) slot.textContent = '';
        });
    } else {
        if (ordersPanel) ordersPanel.classList.add('hidden');
        const slot = document.getElementById('admin-stats-slot');
        if (slot) slot.textContent = '';
    }

    await loadUserSubscriptions();
    renderSubscriptions();
}

async function loadAdminOrders() {
    const list = document.getElementById('admin-orders-list');
    if (!list || !isAdmin()) return;
    list.innerHTML = `<div class="text-center py-8 text-zinc-500 text-sm">Loading orders…</div>`;
    try {
        const snap = await db.collection('orders').orderBy('createdAt', 'desc').limit(100).get();
        allOrders = [];
        snap.forEach(doc => allOrders.push({ id: doc.id, ...doc.data() }));
        renderAdminOrders();
    } catch (e) {
        console.error(e);
        // Fallback without orderBy
        try {
            const snap = await db.collection('orders').limit(100).get();
            allOrders = [];
            snap.forEach(doc => allOrders.push({ id: doc.id, ...doc.data() }));
            allOrders.sort((a, b) => {
                const ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
                const tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
                return tb - ta;
            });
            renderAdminOrders();
        } catch (e2) {
            list.innerHTML = `<div class="text-center py-8 text-red-400 text-sm">Could not load orders. Check Firestore rules.</div>`;
        }
    }
}

function statusBadge(status) {
    const map = {
        pending: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
        paid: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
        completed: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
        cancelled: 'bg-red-500/15 text-red-300 border-red-500/30'
    };
    const cls = map[status] || map.pending;
    return `<span class="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border ${cls}">${status || 'pending'}</span>`;
}

function renderAdminOrders() {
    const list = document.getElementById('admin-orders-list');
    const stats = document.getElementById('admin-orders-stats');
    const filter = (document.getElementById('orders-filter') || {}).value || 'all';
    if (!list) return;

    const filtered = filter === 'all' ? allOrders : allOrders.filter(o => (o.status || 'pending') === filter);

    if (stats) {
        const counts = { pending: 0, paid: 0, completed: 0, cancelled: 0 };
        allOrders.forEach(o => { counts[o.status || 'pending'] = (counts[o.status || 'pending'] || 0) + 1; });
        stats.innerHTML = `
            <div class="bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-center">
                <div class="text-xl font-bold">${allOrders.length}</div>
                <div class="text-[11px] text-zinc-500">Total</div>
            </div>
            <div class="bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-center">
                <div class="text-xl font-bold text-amber-400">${counts.pending}</div>
                <div class="text-[11px] text-zinc-500">Pending</div>
            </div>
            <div class="bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-center">
                <div class="text-xl font-bold text-sky-400">${counts.paid}</div>
                <div class="text-[11px] text-zinc-500">Paid</div>
            </div>
            <div class="bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-center">
                <div class="text-xl font-bold text-emerald-400">${counts.completed}</div>
                <div class="text-[11px] text-zinc-500">Completed</div>
            </div>`;
    }

    if (filtered.length === 0) {
        list.innerHTML = `<div class="text-center py-8 text-zinc-500 text-sm">No orders found.</div>`;
        return;
    }

    list.innerHTML = filtered.map(o => {
        const itemsHtml = (o.items || []).map(it =>
            `<div class="text-xs text-zinc-400">• ${escapeHtml(it.name)} (${escapeHtml(it.option)}) — ₦${Number(it.price).toLocaleString()}${it.note ? `<div class="text-blue-500 font-medium mt-0.5">X: ${escapeHtml(it.note)}</div>` : ''}</div>`
        ).join('');
        const customer = o.customerName || o.customerEmail || 'Guest';
        return `
        <div class="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
            <div class="flex flex-wrap items-start justify-between gap-2 mb-2">
                <div>
                    <div class="font-mono text-sm font-semibold text-emerald-400">${escapeHtml(o.orderId || o.id)}</div>
                    <div class="text-[11px] text-zinc-500 mt-0.5">${escapeHtml(o.dateStr || '')}</div>
                </div>
                ${statusBadge(o.status || 'pending')}
            </div>
            <div class="space-y-0.5 mb-3">${itemsHtml}</div>
            <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
                <div>
                    <span class="text-zinc-500 text-xs">Customer:</span>
                    <span class="font-medium ml-1">${escapeHtml(customer)}</span>
                    ${o.customerEmail ? `<span class="text-zinc-500 text-xs ml-1">(${escapeHtml(o.customerEmail)})</span>` : ''}
                </div>
                <div class="font-bold">₦${Number(o.total || 0).toLocaleString()}</div>
            </div>
            <div class="mt-3 flex flex-wrap gap-2">
                <button onclick="updateOrderStatus('${o.orderId || o.id}', 'pending')" class="text-[11px] px-2.5 py-1 rounded-lg border border-zinc-700 hover:bg-zinc-800">Pending</button>
                <button onclick="updateOrderStatus('${o.orderId || o.id}', 'paid')" class="text-[11px] px-2.5 py-1 rounded-lg border border-sky-700/50 text-sky-300 hover:bg-sky-900/30">Paid</button>
                <button onclick="updateOrderStatus('${o.orderId || o.id}', 'completed')" class="text-[11px] px-2.5 py-1 rounded-lg border border-emerald-700/50 text-emerald-300 hover:bg-emerald-900/30">Completed</button>
                <button onclick="updateOrderStatus('${o.orderId || o.id}', 'cancelled')" class="text-[11px] px-2.5 py-1 rounded-lg border border-red-700/50 text-red-300 hover:bg-red-900/30">Cancel</button>
            </div>
        </div>`;
    }).join('');
}

async function updateOrderStatus(orderId, status) {
    if (!isAdmin()) return;
    try {
        await db.collection('orders').doc(orderId).update({
            status,
            statusUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        const target = allOrders.find(x => (x.orderId || x.id) === orderId);
        if (target && target.customerUid) {
            const label = status === 'completed' ? 'Order completed' :
                          status === 'cancelled' ? 'Order cancelled' : 'Order updated';
            createNotification({
                toUid: target.customerUid,
                title: label,
                body: (target.orderId || orderId) + ' is now ' + status + '.',
                type: 'order'
            });
        }

        const o = allOrders.find(x => (x.orderId || x.id) === orderId);
        if (o) o.status = status;

        // Sync to customer's dashboard subscriptions (same orderId)
        const customerUid = o && o.customerUid;
        if (customerUid) {
            // Map order status → subscription status
            let subStatus = 'pending';
            if (status === 'completed' || status === 'paid') subStatus = 'completed';
            if (status === 'cancelled') subStatus = 'cancelled';
            if (status === 'pending') subStatus = 'pending';

            try {
                const subsSnap = await db.collection('users').doc(customerUid)
                    .collection('subscriptions')
                    .where('orderId', '==', orderId)
                    .get();

                const batch = db.batch();
                subsSnap.forEach(doc => {
                    batch.update(doc.ref, { status: subStatus });
                });
                if (!subsSnap.empty) await batch.commit();
            } catch (syncErr) {
                console.error('Could not sync user subscriptions', syncErr);
                // Still OK — order status was saved
            }
        }

        renderAdminOrders();
    } catch (e) {
        console.error(e);
        alert('Could not update order status. Check Firestore rules.\n' + (e.code || e.message || ''));
    }
}

function hideDashboard() {
    document.getElementById('dashboard-view').classList.add('hidden');
    document.body.classList.remove('modal-open');
}

function renderSubscriptions() {
    const list = document.getElementById('subscriptions-list');
    if (!list) return;

    if (userSubs.length === 0) {
        list.innerHTML = `
            <div class="bg-zinc-900 border border-zinc-800 rounded-2xl p-10 text-center">
                <i class="fa-solid fa-inbox text-5xl text-zinc-600 mb-4"></i>
                <div class="font-semibold text-lg">No subscriptions yet</div>
                <p class="text-zinc-400 text-sm mt-2 max-w-sm mx-auto">When you order while logged in, items appear here automatically. You can also add them manually.</p>
                <button onclick="showAddSubModal()" class="mt-5 px-6 py-2.5 bg-blue-700 hover:bg-blue-600 text-white text-sm font-semibold rounded-xl">Add Subscription</button>
            </div>`;
        return;
    }

    list.innerHTML = userSubs.map((sub) => {
        const expiry = new Date(sub.expiry);
        const now = new Date();
        const daysLeft = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
        const isExpired = daysLeft < 0;
        const subStatus = sub.status || 'active';
        let statusColor = 'text-emerald-400';
        let statusText = 'Active';

        if (subStatus === 'pending') {
            statusColor = 'text-amber-400';
            statusText = 'Pending activation';
        } else if (subStatus === 'cancelled') {
            statusColor = 'text-red-400';
            statusText = 'Cancelled';
        } else if (isExpired) {
            statusColor = 'text-red-400';
            statusText = 'Expired — renew now';
        } else if (daysLeft <= 7) {
            statusColor = 'text-red-400';
            statusText = '⚠️ Expires in ' + daysLeft + ' day(s)';
        } else if (daysLeft <= 30) {
            statusColor = 'text-amber-400';
            statusText = 'Expires in ' + daysLeft + ' day(s)';
        } else if (subStatus === 'completed' || subStatus === 'active') {
            statusColor = 'text-emerald-400';
            statusText = 'Active';
        }
        const barWidth = isExpired ? 0 : Math.min(100, Math.max(5, (daysLeft / 30) * 100));

        return `
            <div class="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
                <div class="flex justify-between items-start gap-4">
                    <div>
                        <div class="font-semibold text-lg">${escapeHtml(sub.name)}</div>
                        <div class="text-sm text-zinc-400">${escapeHtml(sub.plan || '')}</div>
                    </div>
                    <div class="text-right">
                        <div class="text-xs text-zinc-500">Expires</div>
                        <div class="font-mono text-sm">${isNaN(expiry.getTime()) ? '—' : expiry.toLocaleDateString()}</div>
                    </div>
                </div>
                <div class="my-4 h-2 bg-zinc-800 rounded-full overflow-hidden">
                    <div class="h-full ${isExpired ? 'bg-red-500' : subStatus === 'pending' ? 'bg-amber-500' : 'bg-emerald-500'} rounded-full transition-all" style="width:${barWidth}%"></div>
                </div>
                <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span class="${statusColor} font-medium">${statusText}${!isExpired && subStatus !== 'pending' ? ` • ${daysLeft} days left` : ''}</span>
                    <div class="flex flex-wrap gap-2">
                        ${subStatus === 'pending' ? `<button onclick="markSubStatus('${sub.id}', 'completed')" class="text-xs px-2.5 py-1 rounded-lg border border-emerald-700/50 text-emerald-300 hover:bg-emerald-900/30">Mark activated</button>` : ''}
                        ${subStatus === 'completed' || subStatus === 'active' ? `<button onclick="markSubStatus('${sub.id}', 'pending')" class="text-xs text-zinc-500 hover:text-zinc-300">Mark pending</button>` : ''}
                        <a href="https://wa.link/71id1z" target="_blank" class="text-emerald-400 hover:text-emerald-300 text-xs font-medium flex items-center gap-1">
                            <i class="fa-brands fa-whatsapp"></i> Support
                        </a>
                        <button onclick="removeSubscription('${sub.id}')" class="text-zinc-500 hover:text-red-400 text-xs">Remove</button>
                    </div>
                </div>
            </div>`;
    }).join('');
}

async function markSubStatus(id, status) {
    if (!currentUser) return;
    try {
        await db.collection('users').doc(currentUser.uid)
            .collection('subscriptions').doc(id).update({ status });
        await loadUserSubscriptions();
        renderSubscriptions();
    } catch (e) {
        console.error(e);
        alert('Could not update status: ' + (e.code || e.message));
    }
}

function showAddSubModal() {
    if (!currentUser) {
        hideAddSubModal();
        alert('Please log in or create an account first to save your subscriptions.');
        showLogin();
        return;
    }
    document.getElementById('add-sub-modal').classList.remove('hidden');
    document.getElementById('add-sub-modal').classList.add('flex');
    const d = new Date();
    d.setDate(d.getDate() + 30);
    document.getElementById('add-sub-expiry').value = d.toISOString().split('T')[0];
}
function hideAddSubModal() {
    document.getElementById('add-sub-modal').classList.add('hidden');
    document.getElementById('add-sub-modal').classList.remove('flex');
}

async function addSubscription() {
    if (!currentUser) {
        alert('Your session expired. Please log in again.');
        showLogin();
        return;
    }

    const name = document.getElementById('add-sub-name').value.trim();
    const plan = document.getElementById('add-sub-plan').value.trim();
    const expiry = document.getElementById('add-sub-expiry').value;

    if (!name || !plan || !expiry) {
        alert('Please fill all fields.');
        return;
    }

    try {
        const userRef = db.collection('users').doc(currentUser.uid);
        await userRef.set({
            name: currentUser.displayName || currentUser.email.split('@')[0],
            email: currentUser.email,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        await userRef.collection('subscriptions').add({
            name,
            plan,
            expiry,
            status: 'completed',
            added: firebase.firestore.FieldValue.serverTimestamp()
        });

        document.getElementById('add-sub-name').value = '';
        document.getElementById('add-sub-plan').value = '';
        hideAddSubModal();
        await loadUserSubscriptions();
        renderSubscriptions();
    } catch (err) {
        console.error('addSubscription error', err);
        alert('Could not save subscription.\n\nError: ' + (err.code || '') + ' ' + (err.message || 'unknown') + '\n\nIf this says permission-denied, re-publish Firestore rules.');
    }
}

async function removeSubscription(id) {
    if (!currentUser) return;
    if (!confirm('Remove this subscription from your dashboard?')) return;

    try {
        await db.collection('users').doc(currentUser.uid)
            .collection('subscriptions').doc(id).delete();
        await loadUserSubscriptions();
        renderSubscriptions();
    } catch (err) {
        console.error(err);
        alert('Could not remove subscription.');
    }
}

// ========== PRICE UPDATERS ==========
function updateGrokPrice() {
    const val = document.getElementById('grok-select').value;
    setPriceEl('grok-price', val.split('|')[0]);
}
function updateTgPrice() {
    const val = document.getElementById('tg-select').value;
    setPriceEl('tg-price', val.split('|')[0]);
}
function updateCanvaPrice() {
    const val = document.getElementById('canva-select').value;
    setPriceEl('canva-price', val.split('|')[0]);
}
function addCanvaToCart() {
    const [price, option] = document.getElementById('canva-select').value.split('|');
    addToCart('Canva Pro Shared', option, Number(price));
}
function orderCanvaWhatsApp() {
    const [price, option] = document.getElementById('canva-select').value.split('|');
    orderWhatsApp('Canva Pro Shared', option, Number(price));
}
function scrollProof(dir) {
    const el = document.getElementById('proof-carousel');
    if (!el) return;
    el.scrollBy({ left: dir * 300, behavior: 'smooth' });
}
function updateStarsPrice() {
    const val = document.getElementById('stars-select').value;
    setPriceEl('stars-price', val.split('|')[0]);
}

function calcCustomStarsPrice(amount) {
    const n = Number(amount);
    if (!n || n < 1) return null;
    const packages = {
        50: 1800, 75: 2400, 100: 3000, 150: 4000, 250: 7000,
        350: 9500, 500: 13500, 750: 19000, 1000: 25000, 1500: 37000, 2500: 60000
    };
    if (packages[n]) return packages[n];
    if (n <= 349) return Math.round(n * 36);  // up to 349
    return Math.round(n * 30);                 // 351+
}

function updateCustomStarsPrice() {
    const input = document.getElementById('stars-custom');
    const el = document.getElementById('stars-custom-price');
    if (!input || !el) return;
    const amount = Number(input.value);
    if (!amount || amount < 1) {
        el.textContent = 'Enter amount';
        el.className = 'text-lg font-bold tabular-nums text-zinc-500 mb-1';
        return;
    }
    const price = calcCustomStarsPrice(amount);
    el.innerHTML = '₦' + price.toLocaleString() + ' <span class="usd-tag">$' + toUsd(price) + '</span>  ·  ⭐ ' + amount.toLocaleString();
    el.className = 'text-lg font-bold tabular-nums text-amber-400 mb-1';
}

function updateXPrice() {
    const val = document.getElementById('x-select').value;
    setPriceEl('x-price', val.split('|')[0]);
}
function updateVpnPrice(key) {
    const val = document.getElementById(key + '-select').value;
    setPriceEl(key + '-price', val.split('|')[0]);
}

// ========== ORDER HELPERS ==========
function orderWhatsApp(name, option, price, note) {
    requireAccountForOrder(() => orderWhatsAppNow(name, option, price, note));
}
function orderWhatsAppNow(name, option, price, note) {
    const customerName = getCustomerName();
    if (!customerName) return;
    const orderId = generateOrderId();
    const orderDate = formatOrderDate();
    const noteLine = note ? `\n   X account: ${note}` : '';
    const emailLine = currentUser && currentUser.email ? `\n📧 Email: ${currentUser.email}` : '';

    const message = `Hello SubHub 👋\nI would like to order the following:\n\n1. ${name} (${option}) — ₦${price.toLocaleString()} ($${toUsd(price)})${noteLine}\n\nTotal: ₦${price.toLocaleString()} ($${toUsd(price)})\n\n👤 Name: ${customerName}${emailLine}\n\n🆔 Order ID: ${orderId}\n📅 Date: ${orderDate}\n\nPlease confirm availability and payment details.`;

    // Open WhatsApp FIRST so mobile browsers don't block it
    window.open(`https://wa.me/2348132983965?text=${encodeURIComponent(message)}`, '_blank');

    // Save in background
    saveOrderToFirestore({
        orderId,
        items: [{ name, option, price, note: note || null }],
        subtotal: price,
        discount: 0,
        promoCode: null,
        total: price,
        status: 'pending',
        customerEmail: currentUser ? currentUser.email : null,
        customerName: customerName,
        customerUid: currentUser ? currentUser.uid : null,
        dateStr: orderDate
    });
}
function addGrokToCart() {
    const [price, option] = document.getElementById('grok-select').value.split('|');
    addToCart('Grok AI Pro', option, Number(price));
}
function orderGrokWhatsApp() {
    const [price, option] = document.getElementById('grok-select').value.split('|');
    orderWhatsApp('Grok AI Pro', option, Number(price));
}
function addTgToCart() {
    const [price, option] = document.getElementById('tg-select').value.split('|');
    addToCart('Telegram Premium', option, Number(price));
}
function orderTgWhatsApp() {
    const [price, option] = document.getElementById('tg-select').value.split('|');
    orderWhatsApp('Telegram Premium', option, Number(price));
}
function addStarsToCart() {
    const [price, option] = document.getElementById('stars-select').value.split('|');
    addToCart('Telegram Stars', option, Number(price));
}
function orderStarsWhatsApp() {
    const [price, option] = document.getElementById('stars-select').value.split('|');
    orderWhatsApp('Telegram Stars', option, Number(price));
}
function addCustomStarsToCart() {
    const amount = Number(document.getElementById('stars-custom').value);
    if (!amount || amount < 1) { alert('Enter a valid star amount.'); return; }
    const price = calcCustomStarsPrice(amount);
    addToCart('Telegram Stars', amount.toLocaleString() + ' Stars (Custom)', price);
}
function orderCustomStarsWhatsApp() {
    const amount = Number(document.getElementById('stars-custom').value);
    if (!amount || amount < 1) { alert('Enter a valid star amount.'); return; }
    const price = calcCustomStarsPrice(amount);
    orderWhatsApp('Telegram Stars', amount.toLocaleString() + ' Stars (Custom)', price);
}
function getXHandle() {
    const raw = ((document.getElementById('x-username') || {}).value || '').trim();
    if (!raw) {
        alert('Enter the X username or profile link first.\nExample: @yourxusername or x.com/yourxusername');
        const el = document.getElementById('x-username');
        if (el) el.focus();
        return null;
    }
    let handle = raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
    handle = handle.replace(/^(x\.com|twitter\.com)\//i, '');
    handle = handle.split('/')[0].split('?')[0].replace(/^@/, '');
    if (!handle || handle.length < 2) {
        alert('That X username does not look valid. Use @username or x.com/username');
        return null;
    }
    return '@' + handle;
}
function addXToCart() {
    const handle = getXHandle();
    if (!handle) return;
    const [price, option] = document.getElementById('x-select').value.split('|');
    addToCart('X Premium (Normal)', option, Number(price), handle);
}
function orderXWhatsApp() {
    const handle = getXHandle();
    if (!handle) return;
    const [price, option] = document.getElementById('x-select').value.split('|');
    orderWhatsApp('X Premium (Normal)', option, Number(price), handle);
}
function addVpnToCart(name, key) {
    const [price, option] = document.getElementById(key + '-select').value.split('|');
    addToCart(name, option, Number(price));
}
function orderVpnWhatsApp(name, key) {
    const [price, option] = document.getElementById(key + '-select').value.split('|');
    orderWhatsApp(name, option, Number(price));
}

// ========== REVIEWS ==========
let selectedRating = 0;

function setReviewRating(n) {
    selectedRating = n;
    document.querySelectorAll('.review-star').forEach(btn => {
        const v = Number(btn.getAttribute('data-v'));
        btn.classList.toggle('text-amber-400', v <= n);
        btn.classList.toggle('text-zinc-600', v > n);
    });
    const label = document.getElementById('review-rating-label');
    if (label) label.textContent = n + ' / 5';
}

function starsHtml(n) {
    let s = '';
    for (let i = 1; i <= 5; i++) {
        s += `<span class="${i <= n ? 'text-amber-400' : 'text-zinc-600'}">★</span>`;
    }
    return s;
}

async function loadReviews() {
    const list = document.getElementById('reviews-list');
    if (!list) return;
    try {
        const snap = await db.collection('reviews').orderBy('createdAt', 'desc').limit(30).get();
        if (snap.empty) {
            list.innerHTML = `<div class="text-center py-10 text-zinc-500 text-sm">No reviews yet. Be the first!</div>`;
            return;
        }
        list.innerHTML = snap.docs.map(doc => {
            const r = doc.data();
            const date = r.createdAt && r.createdAt.toDate ? r.createdAt.toDate().toLocaleDateString() : '';
            return `<div class="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
                <div class="flex items-center justify-between gap-3 mb-2">
                    <div class="font-semibold">${escapeHtml(r.name || 'Customer')}</div>
                    <div class="text-sm">${starsHtml(r.rating || 5)}</div>
                </div>
                <p class="text-sm text-zinc-400 leading-relaxed">${escapeHtml(r.comment || '')}</p>
                ${date ? `<div class="text-[11px] text-zinc-600 mt-3">${date}</div>` : ''}
            </div>`;
        }).join('');
    } catch (e) {
        console.error('Reviews load error', e);
        // Fallback without orderBy if index missing
        try {
            const snap = await db.collection('reviews').limit(30).get();
            const items = [];
            snap.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
            items.sort((a, b) => {
                const ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
                const tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
                return tb - ta;
            });
            if (items.length === 0) {
                list.innerHTML = `<div class="text-center py-10 text-zinc-500 text-sm">No reviews yet. Be the first!</div>`;
                return;
            }
            list.innerHTML = items.map(r => {
                const date = r.createdAt && r.createdAt.toDate ? r.createdAt.toDate().toLocaleDateString() : '';
                return `<div class="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
                    <div class="flex items-center justify-between gap-3 mb-2">
                        <div class="font-semibold">${escapeHtml(r.name || 'Customer')}</div>
                        <div class="text-sm">${starsHtml(r.rating || 5)}</div>
                    </div>
                    <p class="text-sm text-zinc-400 leading-relaxed">${escapeHtml(r.comment || '')}</p>
                    ${date ? `<div class="text-[11px] text-zinc-600 mt-3">${date}</div>` : ''}
                </div>`;
            }).join('');
        } catch (e2) {
            list.innerHTML = `<div class="text-center py-10 text-zinc-500 text-sm">Reviews unavailable right now.</div>`;
        }
    }
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

async function submitReview() {
    const name = (document.getElementById('review-name') || {}).value.trim() || 'Customer';
    const comment = (document.getElementById('review-comment') || {}).value.trim();
    const msg = document.getElementById('review-msg');

    if (!selectedRating) {
        if (msg) { msg.className = 'text-xs text-center text-red-400'; msg.textContent = 'Please select a star rating.'; msg.classList.remove('hidden'); }
        return;
    }
    if (!comment || comment.length < 5) {
        if (msg) { msg.className = 'text-xs text-center text-red-400'; msg.textContent = 'Please write a short review (at least 5 characters).'; msg.classList.remove('hidden'); }
        return;
    }

    try {
        await db.collection('reviews').add({
            name: name.slice(0, 40),
            rating: Number(selectedRating),
            comment: comment.slice(0, 400),
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        document.getElementById('review-name').value = '';
        document.getElementById('review-comment').value = '';
        setReviewRating(0);
        selectedRating = 0;
        if (msg) { msg.className = 'text-xs text-center text-emerald-400'; msg.textContent = 'Thank you! Your review is live.'; msg.classList.remove('hidden'); }
        await loadReviews();
        createNotification({
            toRole: 'admin',
            title: 'New review',
            body: name + ' left a ' + selectedRating + '-star review.',
            type: 'review'
        });
    } catch (e) {
        console.error('submitReview error', e);
        if (msg) {
            msg.className = 'text-xs text-center text-red-400';
            msg.textContent = 'Could not submit: ' + (e.code || e.message || 'error') + '. Check Firestore rules.';
            msg.classList.remove('hidden');
        }
    }
}


// ========== NOTIFICATIONS ==========
let notifUnsubs = [];
let notifItems = [];

async function createNotification(data) {
    if (!db) return;
    try {
        await db.collection('notifications').add({
            toUid: data.toUid || null,
            toRole: data.toRole || null,
            title: data.title || 'SubHub',
            body: data.body || '',
            type: data.type || 'system',
            read: false,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    } catch (e) {
        console.warn('Notification not saved', e);
    }
}

function stopNotificationListener() {
    notifUnsubs.forEach(fn => { try { fn(); } catch (e) {} });
    notifUnsubs = [];
    notifItems = [];
    renderNotifications();
}

function startNotificationListener() {
    stopNotificationListener();
    if (!currentUser || !db) return;
    const merge = (docs, tag) => {
        const incoming = docs.map(d => ({ id: d.id, ...d.data(), _tag: tag }));
        notifItems = notifItems.filter(n => n._tag !== tag).concat(incoming);
        notifItems.sort((a, b) => {
            const ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
            const tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
            return tb - ta;
        });
        renderNotifications();
    };
    try {
        const u = db.collection('notifications').where('toUid', '==', currentUser.uid)
            .onSnapshot(snap => merge(snap.docs, 'user'), err => console.warn('notif user', err));
        notifUnsubs.push(u);
    } catch (e) { console.warn(e); }
    if (isAdmin()) {
        try {
            const a = db.collection('notifications').where('toRole', '==', 'admin')
                .onSnapshot(snap => merge(snap.docs, 'admin'), err => console.warn('notif admin', err));
            notifUnsubs.push(a);
        } catch (e) { console.warn(e); }
    }
}

function renderNotifications() {
    const badge = document.getElementById('notif-badge');
    const list = document.getElementById('notif-list');
    const unread = notifItems.filter(n => !n.read).length;
    if (badge) {
        if (unread > 0) {
            badge.textContent = unread > 9 ? '9+' : String(unread);
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }
    if (!list) return;
    if (!notifItems.length) {
        list.innerHTML = '<p class="notif-empty">No notifications yet</p>';
        return;
    }
    list.innerHTML = notifItems.slice(0, 30).map(n => {
        const when = n.createdAt && n.createdAt.toDate ? n.createdAt.toDate().toLocaleString() : '';
        return `<button type="button" class="notif-item ${n.read ? '' : 'unread'}" onclick="openNotification('${n.id}')">
            <strong>${(n.title || 'Update').replace(/</g,'')}</strong>
            <span>${(n.body || '').replace(/</g,'')}</span>
            <em>${when}</em>
        </button>`;
    }).join('');
}

function toggleNotifPanel(e) {
    if (e) e.stopPropagation();
    if (!currentUser) { showLogin(); return; }
    const panel = document.getElementById('notif-panel');
    if (!panel) return;
    panel.classList.toggle('hidden');
}

function hideNotifPanel() {
    const panel = document.getElementById('notif-panel');
    if (panel) panel.classList.add('hidden');
}

async function openNotification(id) {
    const n = notifItems.find(x => x.id === id);
    if (n && !n.read) {
        try { await db.collection('notifications').doc(id).update({ read: true }); } catch (e) {}
        n.read = true;
        renderNotifications();
    }
    hideNotifPanel();
    if (n && (n.type === 'order' || n.type === 'signup')) showDashboard();
}

async function markAllNotifsRead() {
    const unread = notifItems.filter(n => !n.read);
    await Promise.all(unread.map(n => db.collection('notifications').doc(n.id).update({ read: true }).catch(() => {})));
    notifItems.forEach(n => { n.read = true; });
    renderNotifications();
}

document.addEventListener('click', (e) => {
    const panel = document.getElementById('notif-panel');
    const btn = document.getElementById('notif-btn');
    if (!panel || panel.classList.contains('hidden')) return;
    if (panel.contains(e.target) || (btn && btn.contains(e.target))) return;
    hideNotifPanel();
});

// ========== SEARCH ==========
const SERVICE_INDEX = [
    { name: 'X Premium', desc: 'Blue check + Grok access', href: '/x-premium', img: 'images/x.png' },
    { name: 'ChatGPT Pro', desc: 'Full GPT-4o access', href: '/ai', img: 'images/chatgpt.png' },
    { name: 'Grok AI Pro', desc: 'xAI Grok subscription', href: '/ai', img: 'images/Grok.png' },
    { name: 'Gemini Pro', desc: 'Google Gemini Pro', href: '/ai', img: 'images/gemini.png' },
    { name: 'YouTube Premium', desc: 'Ad-free + YouTube Music', href: '/youtube', img: 'images/youtube.png' },
    { name: 'Telegram Premium', desc: 'Premium features on your account', href: '/telegram', img: 'images/Telegram.png' },
    { name: 'Telegram Stars', desc: 'Buy Telegram Stars in Naira', href: '/telegram', img: 'images/Telegram.png' },
    { name: 'NordVPN', desc: '7, 14 and 30 day plans', href: '/vpn', img: 'images/nordvpn.png' },
    { name: 'ExpressVPN', desc: '7, 14 and 30 day plans', href: '/vpn', img: 'images/expressvpn.png' },
    { name: 'Proton VPN', desc: '7, 14 and 30 day plans', href: '/vpn', img: 'images/protonvpn.png' },
    { name: 'IPVanish VPN', desc: '7, 14 and 30 day plans', href: '/vpn', img: 'images/ipvanish.png' },
    { name: 'HMA VPN', desc: '7, 14 and 30 day plans', href: '/vpn', img: 'images/hma.png' },
    { name: 'Netflix Premium', desc: 'Shared and personal plans', href: '/netflix', img: 'images/netflix.png' },
    { name: 'Canva Pro', desc: 'Shared Gmail plan', href: '/editing', img: 'images/canva.png' },
    { name: 'CapCut Pro', desc: 'Personal editing plan', href: '/editing', img: 'images/capcut.png' }
];

function toggleMobileSearch() {
    openServiceSearch();
}

function openServiceSearch() {
    const overlay = document.getElementById('search-overlay');
    if (!overlay) return;
    overlay.classList.remove('hidden');
    document.body.classList.add('menu-open');
    renderServiceSearch('');
    const input = document.getElementById('service-search-input');
    setTimeout(() => { if (input) input.focus(); }, 50);
}

function closeServiceSearch() {
    const overlay = document.getElementById('search-overlay');
    if (overlay) overlay.classList.add('hidden');
    document.body.classList.remove('menu-open');
    const input = document.getElementById('service-search-input');
    if (input) input.value = '';
}

function renderServiceSearch(query) {
    const list = document.getElementById('service-search-list');
    if (!list) return;
    const q = (query || '').trim().toLowerCase();
    const items = SERVICE_INDEX.filter(s =>
        !q || s.name.toLowerCase().includes(q) || s.desc.toLowerCase().includes(q)
    );
    if (!items.length) {
        list.innerHTML = '<p class="search-empty">No matching service</p>';
        return;
    }
    list.innerHTML = items.map(s => `
        <a href="${s.href}" class="search-item" onclick="closeServiceSearch()">
            <img src="${s.img}" alt="">
            <div>
                <strong>${s.name}</strong>
                <span>${s.desc}</span>
            </div>
        </a>
    `).join('');
}

function openMobileMenu() {
    const menu = document.getElementById('mobile-menu');
    const overlay = document.getElementById('mobile-menu-overlay');
    const icon = document.getElementById('menu-toggle-icon');
    if (menu) {
        menu.classList.add('open');
        menu.setAttribute('aria-hidden', 'false');
    }
    if (overlay) overlay.classList.remove('hidden');
    if (icon) {
        icon.classList.remove('fa-bars');
        icon.classList.add('fa-xmark');
    }
    document.body.classList.add('menu-open');
}

function closeMobileMenu() {
    const menu = document.getElementById('mobile-menu');
    const overlay = document.getElementById('mobile-menu-overlay');
    const icon = document.getElementById('menu-toggle-icon');
    if (menu) {
        menu.classList.remove('open');
        menu.setAttribute('aria-hidden', 'true');
    }
    if (overlay) overlay.classList.add('hidden');
    if (icon) {
        icon.classList.remove('fa-xmark');
        icon.classList.add('fa-bars');
    }
    document.body.classList.remove('menu-open');
}

function toggleMobileMenu() {
    const menu = document.getElementById('mobile-menu');
    if (menu && menu.classList.contains('open')) closeMobileMenu();
    else openMobileMenu();
}

function filterServices(query) {
    const q = (query || '').trim().toLowerCase();
    const cards = document.querySelectorAll('.service-card, .popular-card');
    const sections = document.querySelectorAll('#catalog > section');

    cards.forEach(card => {
        const text = card.textContent.toLowerCase();
        const match = !q || text.includes(q);
        card.style.display = match ? '' : 'none';
    });

    // Hide empty catalog sections
    sections.forEach(section => {
        const visibleCards = section.querySelectorAll('.service-card');
        let anyVisible = false;
        visibleCards.forEach(c => {
            if (c.style.display !== 'none') anyVisible = true;
        });
        section.style.display = (!q || anyVisible) ? '' : 'none';
    });

    // If searching, scroll to catalog
    if (q.length >= 2) {
        const catalog = document.getElementById('catalog');
        if (catalog) catalog.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

// ========== FAQ ==========
function toggleFaq(btn) {
    const item = btn.parentElement;
    const wasActive = item.classList.contains('active');
    document.querySelectorAll('.faq-item').forEach(i => i.classList.remove('active'));
    if (!wasActive) item.classList.add('active');
}

// ========== ANIMATIONS ==========
const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) entry.target.classList.add('visible');
    });
}, { threshold: 0.1 });
document.querySelectorAll('.fade-in').forEach(el => observer.observe(el));

window.addEventListener('scroll', () => {
    const btn = document.getElementById('back-to-top');
    if (window.scrollY > 400) btn.classList.add('show');
    else btn.classList.remove('show');
});

// ========== INIT ==========
updateCartUI();
showPromoBanner();
loadReviews();

// Re-check promo window every minute (in case page stays open)
setInterval(() => {
    showPromoBanner();
    if (appliedPromo && !isPromoActive()) {
        appliedPromo = false;
        appliedPromoCode = null;
        updateCartUI();
    }
}, 60000);


// ========== CLEAN URL ROUTER ==========
const PAGE_ROUTES = {
    '/': null,
    '/popular': 'popular',
    '/services': 'catalog',
    '/how-it-works': 'how',
    '/faq': 'faq',
    '/reviews': 'reviews',
    '/x-premium': 'x-premium',
    '/ai': 'ai',
    '/youtube': 'youtube',
    '/telegram': 'telegram',
    '/vpn': 'vpn',
    '/editing': 'editing',
    '/netflix': 'streaming',
    '/streaming': 'streaming'
};

function sectionForPath(pathname) {
    const path = (pathname || '/').replace(/\/+$/, '') || '/';
    return PAGE_ROUTES[path] === undefined ? null : PAGE_ROUTES[path];
}

function goToPath(path, push) {
    const clean = path.startsWith('/') ? path : '/' + path;
    if (push !== false && location.pathname !== clean) {
        history.pushState({ path: clean }, '', clean);
    }
    const id = sectionForPath(clean);
    if (!id) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
    }
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function initRouter() {
    document.addEventListener('click', (e) => {
        const a = e.target.closest('a[href]');
        if (!a) return;
        const href = a.getAttribute('href') || '';
        if (!href.startsWith('/')) return;
        if (a.target === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey) return;
        if (!sectionForPath(href) && href !== '/') return;
        e.preventDefault();
        if (typeof closeMobileMenu === 'function') closeMobileMenu();
        if (typeof closeServiceSearch === 'function') closeServiceSearch();
        goToPath(href, true);
    });
    window.addEventListener('popstate', () => goToPath(location.pathname, false));
    const start = location.pathname.replace(/\/+$/, '') || '/';
    if (start !== '/' && start !== '/index.html') {
        setTimeout(() => goToPath(start === '/index.html' ? '/' : start, false), 80);
    }
}
document.addEventListener('DOMContentLoaded', initRouter);
