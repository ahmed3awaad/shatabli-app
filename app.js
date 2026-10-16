/* Shatabli (شطبلي) — real app, v1.
   Vanilla JS + Supabase. Screens are rendered as HTML strings; every piece of
   user-entered text goes through esc() before it reaches the page. */
'use strict';

const sb = supabase.createClient(window.SHATABLI.url, window.SHATABLI.key, {
  auth: { persistSession: true, autoRefreshToken: true }
});
const COMMISSION = 0.10;
const PILOT_AREA = 'القاهرة الجديدة';

/* ---------- small helpers ---------- */
const nf = new Intl.NumberFormat('ar-EG');
const n = v => nf.format(v);
const money = v => `${n(v)} ج.م`;
const r1 = v => new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Number(v) || 0);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const digits = v => String(v ?? '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
const initials = name => esc(String(name || '؟').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join(' '));
const AVC = ['#F5D88A', '#B9DCE4', '#C9E3C2', '#F2C4B5', '#D6CCF0', '#F0D0E2', '#CFE0F5', '#E8DDB5'];
const avColor = id => AVC[[...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0) % AVC.length];
const avatar = c => c.photo_url
  ? `<img class="av" src="${esc(c.photo_url)}" alt="${esc(c.name)}">`
  : `<div class="av" style="background:${avColor(c.id)}">${initials(c.name)}</div>`;
const ago = iso => {
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return 'دلوقتي';
  if (m < 60) return `من ${n(m)} دقيقة`;
  const h = Math.round(m / 60); if (h < 24) return `من ${n(h)} ساعة`;
  return `من ${n(Math.round(h / 24))} يوم`;
};

/* Look of each trade (photo, icon, colour) — the names come from the database. */
const TRADE = {
  paint: { icon: 'paint', tint: 'rose' }, elec: { icon: 'bolt', tint: 'amber' }, plumb: { icon: 'drop', tint: 'sky' },
  carp: { icon: 'saw', tint: 'orange' }, tile: { icon: 'tiles', tint: 'teal' }, gyps: { icon: 'layers', tint: 'violet' },
  plast: { icon: 'trowel', tint: 'slate' }, alu: { icon: 'window', tint: 'blue' }, helper: { icon: 'hand', tint: 'orange' }
};
const tradeImg = id => TRADE[id] && id !== 'helper' ? `img/${id}.jpg` : 'img/cement.jpg';
const icSafe = (name, c) => ic(typeof P[name] === 'string' ? name : 'tool', c);
const taskImg = id => /^[a-z]{2,20}$/.test(id) ? `img/tasks/${id}.jpg` : 'img/cement.jpg';
const UNITS = ['م²', 'نقطة', 'باب', 'ساعة', 'زيارة'];

const REQ_STATUS = {
  pending: ['wait', 'في انتظار الرد'], accepted: ['go', 'متفق عليه'], done: ['ok', 'تم الشغل'],
  rejected: ['bad', 'اعتذر'], cancelled: ['bad', 'اتلغى']
};
const TINTS = ['rose', 'amber', 'sky', 'orange', 'teal', 'violet', 'slate', 'blue', 'green'];
const tint = v => TINTS.includes(v) ? v : 'blue';
const PILL_IC = { wait: 'wait', go: 'loader', ok: 'okc', bad: 'badc' };
const pill = s => `<span class="pill ${REQ_STATUS[s][0]}">${ic(PILL_IC[REQ_STATUS[s][0]])}${REQ_STATUS[s][1]}</span>`;
const ACTIVE = ['pending', 'accepted'];

/* ---------- state ---------- */
const S = {
  booted: false,
  user: null, profile: null, card: undefined,      // card: craftsman row (null = none yet)
  cats: [], quick: [], tasks: [],
  cache: {},
  ui: { tab: 'home', stack: [], sheet: null, seg: 'now', auth: 'login', signRole: 'customer', draft: null }
};
const pending = {};

async function q(p) { const { data, error } = await p; if (error) throw error; return data; }

/* use(): cached async data for rendering. Returns undefined while loading. */
function use(key, fetcher) {
  if (key in S.cache) return S.cache[key];
  if (!pending[key]) {
    pending[key] = fetcher()
      .then(v => { S.cache[key] = v; })
      .catch(e => { S.cache[key] = { error: e.message || 'حصلت مشكلة' }; })
      .finally(() => { delete pending[key]; render(true); });
  }
  return undefined;
}
function invalidate(...prefixes) {
  for (const k of Object.keys(S.cache)) if (prefixes.some(p => k.startsWith(p))) delete S.cache[k];
}
const loading = (msg = 'بنحمّل…') => `<div class="loading"><div class="spinner"></div>${msg}</div>`;
const failed = d => d && d.error ? `<div class="empty">${esc(d.error)}<br><button class="link" type="button" data-action="retry">جرّب تاني</button></div>` : '';

const cat = id => S.cats.find(c => c.id === id) || { id, name: id };
const quickById = id => S.quick.find(x => String(x.id) === String(id));
const taskById = id => S.tasks.find(t => t.id === id);

/* ---------- data ---------- */
const topCrafters = () => use('crafters:top', () =>
  q(sb.from('craftsmen').select('*').eq('status', 'approved').neq('category', 'helper')
    .order('rating_avg', { ascending: false }).order('jobs_done', { ascending: false }).limit(30)));
const craftersOf = c => use('crafters:cat:' + c, () =>
  q(sb.from('craftsmen').select('*').eq('status', 'approved').eq('category', c)
    .order('rating_avg', { ascending: false }).order('jobs_done', { ascending: false })));
const crafterById = id => use('crafter:' + id, () => q(sb.from('craftsmen').select('*').eq('id', id).maybeSingle()));
const reviewsOf = id => use('reviews:' + id, () =>
  q(sb.from('reviews').select('customer_name,stars,comment,created_at').eq('craftsman_id', id).order('created_at', { ascending: false }).limit(20)));

async function withProfiles(rows, field) {
  const ids = [...new Set(rows.map(r => r[field]))];
  if (!ids.length) return rows;
  const people = await q(sb.from('profiles').select('id,full_name,phone,area').in('id', ids));
  const byId = Object.fromEntries(people.map(p => [p.id, p]));
  return rows.map(r => ({ ...r, person: byId[r[field]] || null }));
}
const myRequests = () => use('req:mine', async () => {
  const rows = await q(sb.from('requests')
    .select('*, craftsmen(id,name,category,photo_url), reviews(id,stars)')
    .eq('customer_id', S.user.id).order('created_at', { ascending: false }).limit(100));
  return withProfiles(rows, 'craftsman_id');
});
const jobRequests = () => use('req:jobs', async () => {
  const rows = await q(sb.from('requests').select('*, reviews(stars,comment)')
    .eq('craftsman_id', S.user.id).order('created_at', { ascending: false }).limit(100));
  return withProfiles(rows, 'customer_id');
});

/* ---------- session ---------- */
async function loadSession(session) {
  S.user = session ? session.user : null;
  S.profile = null; S.card = undefined;
  invalidate('req:', 'admin:');
  if (S.user) {
    try {
      S.profile = await q(sb.from('profiles').select('*').eq('id', S.user.id).maybeSingle());
      if (S.profile && S.profile.role !== 'customer') {
        S.card = await q(sb.from('craftsmen').select('*').eq('id', S.user.id).maybeSingle());
      }
    } catch (e) { toast('مشكلة في تحميل حسابك: ' + e.message); }
  }
  render();
}
const role = () => (S.profile ? S.profile.role : 'guest');
const isWorker = () => role() === 'craftsman';

/* ---------- shared UI ---------- */
function topbar(title, right = '') {
  const back = S.ui.stack.length ? `<button class="iconbtn" type="button" data-action="back" aria-label="رجوع">${ic('back')}</button>` : '';
  return `<div class="topbar">${back}<h1>${title}</h1>${right}</div>`;
}
const refreshBtn = `<button class="iconbtn" type="button" data-action="refresh" aria-label="تحديث">${ic('loader')}</button>`;
function tabbar(tabs) {
  return `<nav class="tabbar">${tabs.map(t => `<button type="button" data-action="tab" data-tab="${t.id}" ${S.ui.tab === t.id && !S.ui.stack.length ? 'aria-current="page"' : ''}>${icSafe(t.icon)}${t.label}${t.badge ? `<span class="badge">${n(t.badge)}</span>` : ''}</button>`).join('')}</nav>`;
}
const stars = k => '★'.repeat(k) + '☆'.repeat(5 - k);
function proCard(c) {
  return `<button class="pro" type="button" data-action="open-crafter" data-id="${c.id}">
    ${avatar(c)}
    <div class="meta">
      <div class="name">${esc(c.name)}</div>
      <div class="small muted">${esc(cat(c.category).name)}${c.area ? ' · ' + esc(c.area) : ''}</div>
      <div class="rate">${c.rating_count ? `<span class="st">★</span>${r1(c.rating_avg)} <span class="muted small">(${n(c.rating_count)} تقييم)</span>` : '<span class="muted small">جديد على شطبلي</span>'}</div>
    </div>
    <div class="price">يبدأ من<b>${money(c.price)}</b>/ ${esc(c.unit)}</div>
  </button>`;
}
const facts = r => `<div class="facts"><span>${ic('clock')}${esc(r.day)}${r.time_slot ? ' · ' + esc(r.time_slot) : ''}</span><span>${ic('pin')}${esc(r.address)}</span></div>`;
const needLogin = what => `<div class="empty">${what}<br><button class="btn sm" type="button" data-action="open-auth" style="margin-top:10px">سجّل دخول أو اعمل حساب</button></div>`;

/* ---------- auth ---------- */
function authScreen() {
  const signup = S.ui.auth === 'signup';
  return `${S.ui.stack.length ? topbar('') : ''}<div class="auth">
    <div class="auth-top"><img src="img/logo-full.jpg" alt="شطبلي، تشطيبات بكل سهولة"></div>
    <form class="auth-body" id="authForm" novalidate>
      <div class="seg lv" role="group"><button type="button" data-action="auth-mode" data-v="login" aria-pressed="${!signup}">تسجيل دخول</button><button type="button" data-action="auth-mode" data-v="signup" aria-pressed="${signup}">حساب جديد</button></div>
      ${signup ? `
        <div class="field">أنا
          <div class="role-pick">
            <button type="button" data-action="sign-role" data-v="customer" aria-pressed="${S.ui.signRole === 'customer'}"><b>عميل</b><small>عايز أطلب خدمة</small></button>
            <button type="button" data-action="sign-role" data-v="craftsman" aria-pressed="${S.ui.signRole === 'craftsman'}"><b>صنايعي أو مساعد</b><small>عايز أشتغل مع شطبلي</small></button>
          </div>
        </div>
        <label class="field">الاسم بالكامل<input id="a-name" autocomplete="name" required maxlength="80"></label>
        <label class="field">رقم الموبايل<input id="a-phone" type="tel" inputmode="tel" autocomplete="tel" required maxlength="20" dir="ltr" placeholder="01xxxxxxxxx"></label>
        <label class="field">المنطقة<input id="a-area" maxlength="60" value="${PILOT_AREA}"></label>` : ''}
      <label class="field">الإيميل<input id="a-email" type="email" autocomplete="email" required dir="ltr"></label>
      <label class="field">كلمة السر<input id="a-pass" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" required minlength="8" dir="ltr"></label>
      <div class="err" id="a-err" role="alert"></div>
      <button class="btn block" type="submit">${signup ? 'اعمل الحساب' : 'دخول'}</button>
      ${signup ? '<p class="center-note">كلمة السر ٨ حروف على الأقل.</p>' : ''}
    </form>
  </div>`;
}

/* ---------- customer: home ---------- */
function liveCard(list) {
  if (!Array.isArray(list)) return '';
  const act = list.filter(r => ACTIVE.includes(r.status));
  if (!act.length) return '';
  const r = act[0], c = r.craftsmen;
  const t = r.kind === 'helper' ? 'hand' : r.kind === 'quick' ? 'bolt2' : (TRADE[c?.category]?.icon || 'tool');
  return `<button class="live" type="button" data-action="tab" data-tab="orders"><span class="live-ic">${ic(t)}</span><span class="live-t"><small>طلبك الجاري</small><b>${esc(c ? c.name : 'طلب')} · ${REQ_STATUS[r.status][1]}</b></span><span class="live-n">${act.length > 1 ? `+${n(act.length - 1)}` : ''}${ic('back')}</span></button>`;
}
function cHome() {
  const h = new Date().getHours(), hello = h < 12 ? 'صباح الخير' : h < 18 ? 'نهارك سعيد' : 'مساء الخير';
  const first = S.profile?.full_name ? '، ' + esc(S.profile.full_name.split(' ')[0]) : '';
  const top = topCrafters();
  const mine = S.user ? myRequests() : null;
  const pop = S.quick.slice(0, 6);
  return `<div class="scroll home">
    <header class="hero">
      <div class="hero-top">
        <img class="hero-logo" src="img/logo.jpg" alt="شطبلي">
        <span class="loc-pill">${ic('pin')}${esc(S.profile?.area || PILOT_AREA)}</span>
        <button class="hero-btn" type="button" data-action="tab" data-tab="orders" aria-label="طلباتي">${ic('bell')}${Array.isArray(mine) && mine.some(r => ACTIVE.includes(r.status)) ? '<i></i>' : ''}</button>
      </div>
      <h2><small>${hello}${first}</small>محتاج إيه في البيت النهارده؟</h2>
      <label class="search">${ic('search')}<input id="q" type="search" placeholder="حنفية، نقل عفش، نقاش…" autocomplete="off"></label>
    </header>
    <div id="qres" class="list" hidden></div>
    <div id="homeBody" class="home-body">
      ${S.user ? liveCard(mine) : `<div class="join">
        <div class="join-t"><b>أهلاً بيك في شطبلي 👋</b><small>اعمل حسابك في دقيقة، واطلب أي خدمة للبيت بسعر واضح.</small></div>
        <div class="join-b"><button class="btn tape sm" type="button" data-action="open-auth" data-v="signup">اعمل حساب</button><button class="btn ghost sm" type="button" data-action="open-auth" data-v="login">عندي حساب</button></div>
      </div>`}
      <div class="lanes">
        <button class="lane lane-main" type="button" data-action="tab" data-tab="services" style="--img:url(img/plumb.jpg)">
          <span class="lane-tag">${ic('bolt2')} سعر ثابت</span>
          <b>صلّح حاجة</b><small>حنفية، كهربا، كالون… وأقرب صنايعي متاح يوصلك</small>
        </button>
        <button class="lane lane-photo" type="button" data-action="open-helper" style="--img:url(img/tasks/move.jpg)"><b>مساعد بالساعة</b><small>نقل عفش، ديكور، مناسبات</small></button>
        <button class="lane lane-photo" type="button" data-action="open-trades" style="--img:url(img/elec.jpg)"><b>صنايعي</b><small>بالتقييمات وآراء العملاء</small></button>
      </div>
      ${pop.length ? `<div class="sec">
        <div class="sec-h"><h2 class="hd">${ic('flame')}الأكثر طلباً</h2><button class="link" type="button" data-action="tab" data-tab="services">الكل</button></div>
        <div class="pops">${pop.map(x => `<button class="pop" type="button" data-action="open-q" data-id="${x.id}"><span class="pop-ph"><img src="${tradeImg(x.category)}" alt="" loading="lazy"><span class="ph-ic tn-${TRADE[x.category]?.tint || 'blue'}">${icSafe(x.icon)}</span></span><span><b>${esc(x.name)}</b><small>${money(x.price)}</small></span></button>`).join('')}</div>
      </div>` : ''}
      ${S.tasks.length ? `<div class="sec">
        <div class="sec-h"><h2 class="hd">${ic('hand')}مساعد شطبلي</h2><button class="link" type="button" data-action="open-helper">الكل</button></div>
        <div class="tasks-row">${S.tasks.map(t => `<button class="tcard" type="button" data-action="open-task" data-id="${t.id}"><img src="${taskImg(t.id)}" alt="" loading="lazy"><span><b>${esc(t.name)}</b><small>من ${money(t.rate)} / ساعة</small></span></button>`).join('')}</div>
      </div>` : ''}
      <div class="sec">
        <div class="sec-h"><h2 class="hd">${ic('users')}صنايعية شطبلي</h2><button class="link" type="button" data-action="open-trades">الكل</button></div>
        ${top === undefined ? loading() : failed(top) || (top.length
          ? `<div class="faces">${top.slice(0, 12).map(c => `<button type="button" class="face" data-action="open-crafter" data-id="${c.id}">${avatar(c)}<span>${esc(c.name.split(' ')[0])}</span><small>${esc(cat(c.category).name)}</small></button>`).join('')}</div>`
          : '<div class="empty">الصنايعية بيتسجّلوا دلوقتي. ارجع قريب!</div>')}
      </div>
      <div class="trust">
        <span><i class="tr-ic tn-green">${ic('shield')}</i><b>صنايعية متراجعين</b></span>
        <span><i class="tr-ic tn-amber">${ic('bolt2')}</i><b>السعر قبل ما تطلب</b></span>
        <span><i class="tr-ic tn-sky">${ic('wallet')}</i><b>بتدفع بعد الشغل</b></span>
      </div>
    </div>
  </div>`;
}

/* ---------- customer: services, trades, helper ---------- */
function cServices() {
  const SVC = { fix: 'bolt2', help: 'hand', trades: 'tool' };
  const sec = (id, title, sub, body) => `<section class="sec svc" id="svc-${id}"><div class="sec-h"><h2 class="hd">${ic(SVC[id])}${title}</h2></div>${sub ? `<p class="muted small" style="margin:-4px 0 0">${sub}</p>` : ''}${body}</section>`;
  return `${topbar('كل الخدمات')}
  <div class="scroll">
    <div class="chips jump" role="group" aria-label="أقسام">${[['fix', 'إصلاحات'], ['help', 'مساعد'], ['trades', 'صنايعية']].map(([id, l]) => `<button class="chip" type="button" data-action="jump" data-v="${id}">${ic(SVC[id])}${l}</button>`).join('')}</div>
    ${sec('fix', 'إصلاحات بسعر ثابت', 'بتعرف السعر قبل ما تطلب، وأقرب صنايعي متاح بيوصلك.', `<div class="card qlist">${S.quick.map(x => `<button type="button" class="qrow" data-action="open-q" data-id="${x.id}"><span class="pop-ic sm tn-${TRADE[x.category]?.tint || 'blue'}">${icSafe(x.icon)}</span><span><b>${esc(x.name)}</b><small>${esc(cat(x.category).name)} · ${esc(x.duration)} تقريباً</small></span><span class="qp">${money(x.price)}</span></button>`).join('')}</div>`)}
    ${sec('help', 'مساعد بالساعة', 'إيد زيادة لأي حاجة في البيت.', `<div class="tgrid">${S.tasks.map(t => `<button class="tcard" type="button" data-action="open-task" data-id="${t.id}"><img src="${taskImg(t.id)}" alt="" loading="lazy"><span><b>${esc(t.name)}</b><small>من ${money(t.rate)} / ساعة</small></span></button>`).join('')}</div>`)}
    ${sec('trades', 'صنايعية', 'قارن التقييمات والأسعار، واطلب معاينة.', tradeGrid())}
  </div>`;
}
const tradeGrid = () => `<div class="cats">${S.cats.filter(c => c.id !== 'helper').map(c => `<button class="cat" type="button" data-action="open-cat" data-id="${c.id}"><span class="ph-w"><img class="ph" src="${tradeImg(c.id)}" alt="" loading="lazy"><span class="ph-ic tn-${TRADE[c.id]?.tint || 'blue'}">${ic(TRADE[c.id]?.icon || 'tool')}</span></span>${esc(c.name)}</button>`).join('')}</div>`;
function cTrades() {
  const top = topCrafters();
  return `${topbar('الصنايعية')}
  <div class="scroll">${tradeGrid()}
    <div class="sec"><div class="sec-h"><h2 class="hd">${ic('star')}الأعلى تقييماً</h2></div>
      ${top === undefined ? loading() : failed(top) || (top.length ? `<div class="list">${top.slice(0, 8).map(proCard).join('')}</div>` : '<div class="empty">لسه مفيش صنايعية متاحين.</div>')}
    </div>
  </div>`;
}
function cCategory(id) {
  const list = craftersOf(id);
  return `${topbar(esc(cat(id).name))}
  <div class="scroll">
    <div class="catcover" style="background-image:url(${tradeImg(id)})">${Array.isArray(list) ? `${n(list.length)} متاحين في قسم ${esc(cat(id).name)}` : esc(cat(id).name)}</div>
    ${list === undefined ? loading() : failed(list) || (list.length ? `<div class="list">${list.map(proCard).join('')}</div>` : '<div class="empty">مفيش صنايعية في القسم ده لسه.<br>بنضيف صنايعية كل يوم.</div>')}
  </div>`;
}
function cCrafter(id) {
  const c = crafterById(id), revs = reviewsOf(id);
  if (c === undefined) return `${topbar('')}<div class="scroll">${loading()}</div>`;
  if (!c || c.error) return `${topbar('')}<div class="scroll">${failed(c) || '<div class="empty">الصنايعي ده مش متاح.</div>'}</div>`;
  return `${topbar('')}
  <div class="scroll">
    <div class="cover" style="background-image:url(${tradeImg(c.category)})"></div>
    <div class="profile-head">
      ${avatar(c)}
      <h2>${esc(c.name)}<span class="pill go">${ic('verified')}متراجع</span></h2>
      <div class="muted small">${esc(cat(c.category).name)}${c.area ? ' · ' + esc(c.area) : ''}${c.years ? ` · ${n(c.years)} سنة خبرة` : ''}</div>
      ${c.available ? '<span class="pill ok">متاح</span>' : '<span class="pill bad">مش متاح حالياً</span>'}
    </div>
    <div class="stats">
      <div class="stat"><b>${c.rating_count ? `<span style="color:var(--tape)">★</span> ${r1(c.rating_avg)}` : '—'}</b><span>${n(c.rating_count)} تقييم</span></div>
      <div class="stat"><b>${n(c.jobs_done)}</b><span>شغلانة خلصت</span></div>
      <div class="stat"><b>${n(c.price)}</b><span>ج.م / ${esc(c.unit)}</span></div>
    </div>
    ${c.about ? `<div class="card sec"><h2 class="hd">${ic('user')}عن الصنايعي</h2><p class="muted" style="margin:0;line-height:1.8;font-size:14px;white-space:pre-line">${esc(c.about)}</p></div>` : ''}
    <div class="card"><h2 class="hd" style="margin-bottom:10px">${ic('msg')}آراء العملاء</h2>
      ${revs === undefined ? loading() : failed(revs) || (revs.length ? revs.map(r => `<div class="review"><div class="top"><span>${esc(r.customer_name || 'عميل')}</span><span class="stars">${stars(r.stars)}</span></div>${r.comment ? `<p>${esc(r.comment)}</p>` : ''}</div>`).join('') : '<p class="muted small" style="margin:0">لسه مفيش تقييمات. كن أول واحد!</p>')}
    </div>
    ${S.user && S.user.id === c.id ? '' : `<div class="sticky-cta"><button class="btn block" type="button" data-action="open-request" data-id="${c.id}" ${c.available ? '' : 'disabled'}>${ic('send')}اطلب ${esc(c.name.split(' ')[0])}</button></div>`}
  </div>`;
}
function cHelper() {
  return `${topbar('مساعد شطبلي')}
  <div class="scroll">
    <div class="qhero">${ic('hand')}<div><b>إيد زيادة لأي حاجة في البيت</b><small>بتختار المهمة وعدد المساعدين والساعات، والسعر بيبان قدامك قبل ما تطلب.</small></div></div>
    <div class="list">${S.tasks.map(t => `<button class="card trow" type="button" data-action="open-task" data-id="${t.id}">
      <img class="trow-ph" src="${taskImg(t.id)}" alt="" loading="lazy">
      <span class="meta"><b>${esc(t.name)}</b><small>${esc(t.description)}</small></span>
      <span class="price">من<b>${money(t.rate)}</b>/ ساعة</span></button>`).join('')}</div>
    <p class="note">السعر لكل مساعد في الساعة، وأقل مدة ساعتين.</p>
  </div>`;
}

/* ---------- sheets (booking forms) ---------- */
const sheetWrap = (id, body) => `<div class="sheet-wrap" data-action="close-sheet"><form class="sheet" id="${id}" novalidate><div class="grab"></div>${body}</form></div>`;
const addrField = idp => `<label class="field">العنوان<input id="${idp}-addr" required maxlength="300" value="${esc(S.profile?.area || '')}" placeholder="المنطقة، الشارع، رقم العمارة والدور"></label>`;
const dayOptions = ['النهارده', 'بكرة', 'بعد بكرة', 'الجمعة', 'السبت'];
function requestSheet(id) {
  const c = S.cache['crafter:' + id];
  if (!c || c.error) return '';
  return sheetWrap('reqForm', `
    <h2>طلب ${esc(c.name)} (${esc(cat(c.category).name)})</h2>
    <label class="field">محتاج إيه بالظبط؟<textarea id="r-desc" required maxlength="1000" placeholder="مثلاً: دهان شقة ٩٠ متر، معجون وبلاستيك لونين"></textarea></label>
    <div class="grid2">
      <label class="field">اليوم<select id="r-day">${dayOptions.slice(1).map(d => `<option>${d}</option>`).join('')}</select></label>
      <label class="field">الوقت<select id="r-time"><option>الصبح ٩–١٢</option><option>الضهر ١٢–٣</option><option>العصر ٣–٦</option></select></label>
    </div>
    ${addrField('r')}
    <p class="note" style="margin:0">الصنايعي هيعاين الأول ويتفق معاك على السعر النهائي قبل ما يبدأ.</p>
    <div class="row"><button class="btn ghost" type="button" data-action="close-sheet">إلغاء</button><button class="btn" type="submit">${ic('send')}ابعت الطلب</button></div>`);
}
function quickSheet(id) {
  const x = quickById(id); if (!x) return '';
  return sheetWrap('quickForm', `
    <div class="qs-head"><img src="${tradeImg(x.category)}" alt=""><div><h2>${esc(x.name)}</h2><small class="muted">${esc(cat(x.category).name)} · ${esc(x.duration)} تقريباً</small></div></div>
    <div class="qs-price"><span>سعر ثابت</span><b>${money(x.price)}</b></div>
    <p class="muted small" style="margin:0">شطبلي هتبعتلك أعلى صنايعي تقييماً ومتاح في القسم ده.</p>
    <label class="field">إمتى؟<select id="q-when"><option>في أقرب وقت (خلال ساعتين)</option><option>النهارده بالليل</option><option>بكرة الصبح</option></select></label>
    ${addrField('q')}
    <label class="field">ملاحظة للصنايعي (اختياري)<input id="q-note" maxlength="200" placeholder="مثلاً: الحنفية بتنقط من تحت"></label>
    <p class="note" style="margin:0">بتدفع بعد ما الشغل يخلص. قطع الغيار لو احتاجتها بفاتورة لوحدها.</p>
    <div class="row"><button class="btn ghost" type="button" data-action="close-sheet">إلغاء</button><button class="btn tape" type="submit">اطلب بـ ${money(x.price)}</button></div>`);
}
function helperSheet(id) {
  const t = taskById(id); if (!t) return '';
  const d = S.ui.draft && S.ui.draft.task === id ? S.ui.draft : (S.ui.draft = { task: id, count: t.def_helpers, hours: t.def_hours, note: '' });
  const total = t.rate * d.count * d.hours;
  return sheetWrap('helperForm', `
    <div class="qs-head"><img src="${taskImg(t.id)}" alt=""><div><h2>${esc(t.name)}</h2><small class="muted">${esc(t.description)}</small></div></div>
    <div class="grid2">
      <div class="cstep"><span>عدد المساعدين</span><div class="stepper"><button type="button" data-action="h-step" data-k="count" data-d="1" aria-label="زوّد">+</button><span class="q">${n(d.count)}</span><button type="button" data-action="h-step" data-k="count" data-d="-1" aria-label="قلّل">−</button></div></div>
      <div class="cstep"><span>عدد الساعات</span><div class="stepper"><button type="button" data-action="h-step" data-k="hours" data-d="1" aria-label="زوّد">+</button><span class="q">${n(d.hours)}</span><button type="button" data-action="h-step" data-k="hours" data-d="-1" aria-label="قلّل">−</button></div></div>
    </div>
    <div class="qs-price"><span>${n(d.count)} × ${n(d.hours)} ساعات × ${money(t.rate)}</span><b>${money(total)}</b></div>
    <label class="field">إمتى؟<select id="h-when">${dayOptions.map(x => `<option>${x}</option>`).join('')}</select></label>
    ${addrField('h')}
    <label class="field">التفاصيل<textarea id="h-note" class="textarea-sm" maxlength="300" placeholder="مثلاً: عفش أوضتين من الدور التالت، ومفيش أسانسير">${esc(d.note)}</textarea></label>
    <p class="note" style="margin:0">بتدفع بعد ما الشغل يخلص. لو المهمة خدت وقت أكتر، الساعة الزيادة بنفس السعر.</p>
    <div class="row"><button class="btn ghost" type="button" data-action="close-sheet">إلغاء</button><button class="btn tape" type="submit">اطلب بـ ${money(total)}</button></div>`);
}
function rateSheet(id) {
  const list = S.cache['req:mine']; const r = Array.isArray(list) && list.find(x => x.id === id);
  if (!r) return '';
  const v = S.ui.rateStars || 5;
  return sheetWrap('rateForm', `
    <h2>قيّم ${esc(r.craftsmen?.name || 'الشغل')}</h2>
    <div class="rate-pick" role="group" aria-label="عدد النجوم">${[1, 2, 3, 4, 5].map(k => `<button type="button" data-action="rate-star" data-v="${k}" aria-pressed="${k <= v}" aria-label="${k} نجوم">★</button>`).join('')}</div>
    <label class="field">رأيك (اختياري)<textarea id="rt-comment" class="textarea-sm" maxlength="500" placeholder="ملتزم بالمعاد؟ الشغل نضيف؟"></textarea></label>
    <div class="row"><button class="btn ghost" type="button" data-action="close-sheet">بعدين</button><button class="btn tape" type="submit">ابعت التقييم</button></div>`);
}

/* ---------- customer: orders & account ---------- */
function orderCard(r) {
  const c = r.craftsmen, p = r.person;
  const icon = r.kind === 'helper' ? 'hand' : r.kind === 'quick' ? 'bolt2' : (TRADE[c?.category]?.icon || 'tool');
  const tint = r.kind === 'helper' ? 'orange' : r.kind === 'quick' ? 'amber' : (TRADE[c?.category]?.tint || 'blue');
  const type = r.kind === 'helper' ? 'مساعد بالساعة' : r.kind === 'quick' ? 'خدمة بسعر ثابت' : esc(cat(c?.category).name);
  const reviewed = Array.isArray(r.reviews) ? r.reviews.length : !!r.reviews;
  return `<div class="card job">
    <div class="top"><span class="jt"><span class="jt-ic tn-${tint}">${ic(icon)}</span><span><b>${esc(c?.name || 'صنايعي')}</b><small>${type} · ${ago(r.created_at)}</small></span></span>${pill(r.status)}</div>
    <p>${esc(r.description)}</p>${facts(r)}
    ${r.price ? `<div class="small"><b>${money(r.price)}</b> · بتدفع بعد الشغل</div>` : ''}
    ${p && p.phone && ['accepted', 'done'].includes(r.status) ? `<div class="phone-row"><span>${ic('phone')} رقم ${esc(p.full_name.split(' ')[0] || 'الصنايعي')}</span><a href="tel:${esc(p.phone)}">${esc(p.phone)}</a></div>` : ''}
    ${ACTIVE.includes(r.status) ? `<button class="btn sm ghost" type="button" data-action="cancel-req" data-id="${r.id}">إلغاء الطلب</button>` : ''}
    ${r.status === 'done' && !reviewed ? `<button class="btn sm tape" type="button" data-action="open-rate" data-id="${r.id}">${ic('star')} قيّم الشغل</button>` : ''}
    ${reviewed ? `<div class="small muted">قيّمته: <span class="stars">${stars((Array.isArray(r.reviews) ? r.reviews[0] : r.reviews).stars)}</span></div>` : ''}
  </div>`;
}
function cOrders() {
  if (!S.user) return `${topbar('طلباتي')}<div class="scroll">${needLogin('سجّل دخول عشان تطلب وتتابع طلباتك.')}</div>`;
  const list = myRequests();
  const seg = S.ui.seg === 'past' ? 'past' : 'now';
  let body;
  if (list === undefined) body = loading();
  else if (list.error) body = failed(list);
  else {
    const now = list.filter(r => ACTIVE.includes(r.status)), past = list.filter(r => !ACTIVE.includes(r.status));
    const show = seg === 'now' ? now : past;
    body = `<div class="seg lv" role="group"><button type="button" data-action="seg" data-v="now" aria-pressed="${seg === 'now'}">جارية${now.length ? ` (${n(now.length)})` : ''}</button><button type="button" data-action="seg" data-v="past" aria-pressed="${seg === 'past'}">السابقة</button></div>
      <div class="list">${show.length ? show.map(orderCard).join('') : seg === 'now' ? `<div class="empty">مفيش طلبات جارية.<br><button class="link" type="button" data-action="tab" data-tab="services">شوف الخدمات</button></div>` : '<div class="empty">لسه مفيش طلبات قديمة.</div>'}</div>`;
  }
  return `${topbar('طلباتي', refreshBtn)}<div class="scroll">${body}</div>`;
}
function profileForm() {
  const p = S.profile;
  return `<form class="card calc-in" id="profileForm" novalidate>
      <label class="field">الاسم<input id="p-name" maxlength="80" value="${esc(p.full_name)}"></label>
      <label class="field">الموبايل<input id="p-phone" type="tel" inputmode="tel" maxlength="20" dir="ltr" value="${esc(p.phone)}"></label>
      <label class="field">المنطقة<input id="p-area" maxlength="60" value="${esc(p.area)}"></label>
      <button class="btn sm" type="submit">احفظ</button>
    </form>`;
}
function cAccount() {
  if (!S.user) return `${topbar('حسابي')}<div class="scroll">${needLogin('سجّل دخول عشان تطلب خدمات وتتابعها.')}</div>`;
  const p = S.profile || { full_name: '', phone: '', area: '' };
  return `${topbar('حسابي')}<div class="scroll">
    <div class="me"><span class="me-av">${initials(p.full_name || S.user.email)}</span><div><b>${esc(p.full_name || 'حسابي')}</b><small dir="ltr" style="text-align:end">${esc(S.user.email)}</small></div></div>
    ${S.profile ? profileForm() : ''}
    ${role() === 'admin' ? `<button class="btn block tape" type="button" data-action="tab" data-tab="admin">${ic('shield')} لوحة الإدارة</button>` : ''}
    ${role() === 'customer' ? `<div class="sec"><h2 class="hd">${ic('gift')}اشتغل مع شطبلي</h2>
      <div class="card menu"><button type="button" data-action="become-worker"><span><i class="mi-w tn-orange">${ic('tool', 'i mi')}</i> أنا صنايعي أو مساعد</span><b>${ic('back', 'i chev')}</b></button></div></div>` : ''}
    <button class="btn ghost block" type="button" data-action="sign-out">تسجيل خروج</button>
    <p class="note">شطبلي · نسخة تجريبية للتجمع والقاهرة الجديدة</p>
  </div>`;
}

/* ---------- craftsman / helper ---------- */
function cardForm(c) {
  const v = c || { name: S.profile?.full_name || '', category: 'paint', area: S.profile?.area || PILOT_AREA, price: '', unit: 'م²', years: '', about: '' };
  return `<form class="card calc-in" id="cardForm" novalidate>
    <label class="field">الاسم اللي هيظهر للعملاء<input id="c-name" required maxlength="80" value="${esc(v.name)}"></label>
    <label class="field">الصنعة<select id="c-cat">${S.cats.map(x => `<option value="${x.id}" ${x.id === v.category ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
    <label class="field">المنطقة اللي بتشتغل فيها<input id="c-area" maxlength="60" value="${esc(v.area)}"></label>
    <div class="grid2">
      <label class="field">سعرك يبدأ من (ج.م)<input id="c-price" inputmode="numeric" required value="${esc(v.price)}"></label>
      <label class="field">لكل<select id="c-unit">${UNITS.map(u => `<option ${u === v.unit ? 'selected' : ''}>${u}</option>`).join('')}</select></label>
    </div>
    <label class="field">سنين الخبرة<input id="c-years" inputmode="numeric" value="${esc(v.years)}"></label>
    <label class="field">عن شغلك<textarea id="c-about" maxlength="600" placeholder="بتعمل إيه بالظبط؟ وإيه اللي يميز شغلك؟">${esc(v.about)}</textarea></label>
    <div class="err" id="c-err" role="alert"></div>
    <button class="btn block" type="submit">${c ? 'احفظ التعديلات' : 'ابعت بياناتك للمراجعة'}</button>
  </form>`;
}
function wOnboard() {
  return `${topbar('اشتغل مع شطبلي')}<div class="scroll">
    <div class="qhero">${ic('tool')}<div><b>أهلاً بيك في شطبلي</b><small>اكتب بياناتك، وفريق شطبلي هيراجعها ويكلّمك. بعد الموافقة هتظهر للعملاء وتبدأ توصلك طلبات.</small></div></div>
    ${cardForm(null)}
    <button class="btn ghost block" type="button" data-action="sign-out">تسجيل خروج</button>
  </div>`;
}
function wWaiting() {
  const st = S.card.status;
  return `${topbar('حسابك')}<div class="scroll">
    <div class="review-state"><div class="big">${st === 'suspended' ? '⛔' : '⏳'}</div>
      <h2>${st === 'suspended' ? 'حسابك متوقف مؤقتاً' : 'بياناتك تحت المراجعة'}</h2>
      <p>${st === 'suspended' ? 'كلّم فريق شطبلي عشان نعرف حصل إيه.' : 'فريق شطبلي هيراجع بياناتك ويكلّمك على رقمك. بعد الموافقة هتظهر للعملاء.'}</p>
    </div>
    <div class="sec"><h2 class="hd">${ic('user')}بياناتك</h2>${cardForm(S.card)}</div>
    <button class="btn ghost block" type="button" data-action="sign-out">تسجيل خروج</button>
  </div>`;
}
function jobCard(r) {
  const p = r.person;
  const rv = Array.isArray(r.reviews) ? r.reviews[0] : r.reviews;
  return `<div class="card job">
    <div class="top"><b>${esc(p?.full_name || 'عميل')}</b>${pill(r.status)}</div>
    <p>${esc(r.description)}</p>${facts(r)}
    ${r.price ? `<div class="small"><b>${money(r.price)}</b> ${r.kind === 'helper' ? 'مساعد بالساعة' : 'سعر ثابت'} · عمولة شطبلي ${money(Math.round(r.price * COMMISSION))}</div>` : ''}
    ${p?.phone && ['accepted', 'done'].includes(r.status) ? `<div class="phone-row"><span>${ic('phone')} رقم العميل</span><a href="tel:${esc(p.phone)}">${esc(p.phone)}</a></div>` : ''}
    ${r.status === 'pending' ? `<div class="row"><button class="btn sm" type="button" data-action="job-status" data-id="${r.id}" data-v="accepted">اقبل</button><button class="btn ghost sm" type="button" data-action="job-status" data-id="${r.id}" data-v="rejected">اعتذر</button></div>` : ''}
    ${r.status === 'accepted' ? `<button class="btn sm tape" type="button" data-action="job-status" data-id="${r.id}" data-v="done">${ic('check')} خلّصت الشغل</button>` : ''}
    ${r.status === 'done' ? `<div class="small muted">${rv ? `تقييم العميل: <span class="stars">${stars(rv.stars)}</span>${rv.comment ? ` · ${esc(rv.comment)}` : ''}` : 'في انتظار تقييم العميل'}</div>` : ''}
  </div>`;
}
function wIncoming() {
  const list = jobRequests();
  const body = list === undefined ? loading() : failed(list) || (() => {
    const pend = list.filter(r => r.status === 'pending');
    return pend.length ? `<div class="list">${pend.map(jobCard).join('')}</div>` : `<div class="empty">مفيش طلبات جديدة دلوقتي.<br>${S.card.available ? 'أول ما عميل يطلبك هيظهر هنا.' : 'إنت قافل استقبال الطلبات من حسابك.'}</div>`;
  })();
  return `${topbar('طلبات جديدة', refreshBtn)}<div class="scroll">
    <div class="card" style="display:flex;gap:12px;align-items:center">${avatar(S.card)}<div><b>أهلاً يا ${esc(S.card.name.split(' ')[0])}</b><div class="small muted">${esc(cat(S.card.category).name)} · ${S.card.rating_count ? `<span style="color:var(--tape)">★</span> ${r1(S.card.rating_avg)}` : 'جديد'}</div></div><span class="pill ${S.card.available ? 'ok' : 'bad'}" style="margin-inline-start:auto">${S.card.available ? 'متاح' : 'مش متاح'}</span></div>
    ${body}</div>`;
}
function wJobs() {
  const list = jobRequests();
  const body = list === undefined ? loading() : failed(list) || (() => {
    const act = list.filter(r => r.status === 'accepted'), done = list.filter(r => r.status === 'done');
    return `<div class="sec"><h2 class="hd">${ic('tool')}شغل جاري (${n(act.length)})</h2><div class="list">${act.length ? act.map(jobCard).join('') : '<div class="empty">مفيش شغل جاري.</div>'}</div></div>
      <div class="sec"><h2 class="hd">${ic('okc')}خلص</h2><div class="list">${done.length ? done.map(jobCard).join('') : '<div class="empty">لسه مفيش.</div>'}</div></div>`;
  })();
  return `${topbar('شغلي', refreshBtn)}<div class="scroll">${body}</div>`;
}
function wAccount() {
  const c = S.card, list = jobRequests();
  const earned = Array.isArray(list) ? list.filter(r => r.status === 'done' && r.price).reduce((a, r) => a + r.price, 0) : 0;
  return `${topbar('حسابي')}<div class="scroll">
    <div class="stats">
      <div class="stat"><b>${c.rating_count ? r1(c.rating_avg) : '—'}</b><span>تقييمك</span></div>
      <div class="stat"><b>${n(c.jobs_done)}</b><span>شغلانة خلصت</span></div>
      <div class="stat"><b>${n(Math.round(earned * (1 - COMMISSION)))}</b><span>ج.م صافي (خدمات ثابتة)</span></div>
    </div>
    <div class="card toggle"><div><b>متاح لطلبات جديدة</b><div class="small muted">لو قفلتها مش هتوصلك طلبات</div></div><button class="switch" type="button" role="switch" aria-checked="${c.available}" aria-label="متاح" data-action="toggle-avail"></button></div>
    <div class="sec"><h2 class="hd">${ic('user')}بياناتك للعملاء</h2>${cardForm(c)}</div>
    <div class="sec"><h2 class="hd">${ic('phone')}بيانات التواصل</h2>${S.profile ? profileForm() : ''}</div>
    <button class="btn ghost block" type="button" data-action="sign-out">تسجيل خروج</button>
  </div>`;
}

/* ---------- admin ---------- */
const adminCrafters = () => use('admin:crafters', async () => {
  const rows = await q(sb.from('craftsmen').select('*').order('created_at', { ascending: false }).limit(300));
  return withProfiles(rows, 'id');
});
const adminRequests = () => use('admin:requests', async () =>
  q(sb.from('requests').select('id,status,kind,price,description,created_at,craftsmen(name)').order('created_at', { ascending: false }).limit(200)));
function aPanel() {
  const seg = S.ui.aseg || 'crafters';
  let body;
  if (seg === 'crafters') {
    const list = adminCrafters();
    body = list === undefined ? loading() : failed(list) || (() => {
      const order = { pending: 0, approved: 1, suspended: 2 };
      const rows = list.slice().sort((a, b) => order[a.status] - order[b.status]);
      return rows.length ? `<div class="list">${rows.map(c => `<div class="card job">
        <div class="top"><span class="jt">${avatar(c)}<span><b>${esc(c.name)}</b><small>${esc(cat(c.category).name)} · ${esc(c.area)} · ${ago(c.created_at)}</small></span></span><span class="pill ${c.status === 'approved' ? 'ok' : c.status === 'pending' ? 'wait' : 'bad'}">${c.status === 'approved' ? 'شغال' : c.status === 'pending' ? 'مستني موافقتك' : 'متوقف'}</span></div>
        <div class="kv"><span>السعر</span><b>${money(c.price)} / ${esc(c.unit)}</b><span>الخبرة</span><b>${n(c.years)} سنة</b><span>الموبايل</span><b dir="ltr" style="text-align:end">${esc(c.person?.phone || '—')}</b><span>التقييم</span><b>${c.rating_count ? `${r1(c.rating_avg)} (${n(c.rating_count)})` : '—'}</b></div>
        ${c.about ? `<p class="muted">${esc(c.about)}</p>` : ''}
        <div class="row">${c.status !== 'approved' ? `<button class="btn sm" type="button" data-action="admin-status" data-id="${c.id}" data-v="approved">${ic('check')} وافق</button>` : ''}${c.status !== 'suspended' ? `<button class="btn sm danger" type="button" data-action="admin-status" data-id="${c.id}" data-v="suspended">وقّف</button>` : ''}</div>
      </div>`).join('')}</div>` : '<div class="empty">لسه مفيش صنايعية سجّلوا.</div>';
    })();
  } else {
    const list = adminRequests();
    body = list === undefined ? loading() : failed(list) || (() => {
      const done = list.filter(r => r.status === 'done');
      const gmv = done.reduce((a, r) => a + (r.price || 0), 0);
      const by = s => list.filter(r => r.status === s).length;
      return `<div class="stats">
          <div class="stat"><b>${n(by('pending') + by('accepted'))}</b><span>طلب جاري</span></div>
          <div class="stat"><b>${n(done.length)}</b><span>خلص</span></div>
          <div class="stat"><b>${n(Math.round(gmv * COMMISSION))}</b><span>ج.م عمولتك (١٠٪)</span></div>
        </div>
        <p class="note" style="margin:0;text-align:start">العمولة محسوبة على الطلبات اللي ليها سعر ثابت بس (خدمات سريعة ومساعد). طلبات المعاينة السعر بيتحدد برّه التطبيق.</p>
        <div class="list">${list.map(r => `<div class="card job"><div class="top"><b>${esc(r.craftsmen?.name || '—')}</b>${pill(r.status)}</div><p>${esc(r.description)}</p><div class="small muted">${ago(r.created_at)}${r.price ? ' · ' + money(r.price) : ''}</div></div>`).join('') || '<div class="empty">لسه مفيش طلبات.</div>'}</div>`;
    })();
  }
  return `${topbar('لوحة الإدارة', refreshBtn)}<div class="scroll">
    <div class="seg lv" role="group"><button type="button" data-action="aseg" data-v="crafters" aria-pressed="${seg === 'crafters'}">الصنايعية</button><button type="button" data-action="aseg" data-v="requests" aria-pressed="${seg === 'requests'}">الطلبات</button></div>
    ${body}</div>`;
}

/* ---------- render ---------- */
const app = document.getElementById('app');
function screen() {
  const top = S.ui.stack[S.ui.stack.length - 1];
  if (top?.name === 'auth') return { html: authScreen(), tabs: null };
  if (isWorker()) {
    if (S.card === null) return { html: wOnboard(), tabs: null };
    if (S.card && S.card.status !== 'approved') return { html: wWaiting(), tabs: null };
    if (S.card) {
      const list = S.cache['req:jobs'];
      const pend = Array.isArray(list) ? list.filter(r => r.status === 'pending').length : 0;
      return {
        html: ({ home: wIncoming, jobs: wJobs, account: wAccount }[S.ui.tab] || (S.ui.tab = 'home', wIncoming))(),
        tabs: [{ id: 'home', label: 'الطلبات', icon: 'inbox', badge: pend }, { id: 'jobs', label: 'شغلي', icon: 'tool' }, { id: 'account', label: 'حسابي', icon: 'user' }]
      };
    }
  }
  const routes = { cat: () => cCategory(top.id), crafter: () => cCrafter(top.id), trades: cTrades, helper: cHelper };
  const html = top && routes[top.name] ? routes[top.name]()
    : ({ home: cHome, services: cServices, orders: cOrders, account: cAccount, admin: role() === 'admin' ? aPanel : cHome }[S.ui.tab] || cHome)();
  const mine = S.cache['req:mine'];
  const tabs = [{ id: 'home', label: 'الرئيسية', icon: 'home' }, { id: 'services', label: 'الخدمات', icon: 'grid' },
    { id: 'orders', label: 'طلباتي', icon: 'list', badge: Array.isArray(mine) ? mine.filter(r => ACTIVE.includes(r.status)).length : 0 },
    { id: 'account', label: 'حسابي', icon: 'user' }];
  if (role() === 'admin') tabs.splice(3, 0, { id: 'admin', label: 'الإدارة', icon: 'shield' });
  return { html, tabs };
}
function sheetHtml() {
  const s = S.ui.sheet; if (!s) return '';
  const [k, id] = [s.slice(0, s.indexOf(':')), s.slice(s.indexOf(':') + 1)];
  return { req: requestSheet, q: quickSheet, h: helperSheet, rate: rateSheet }[k]?.(id) || '';
}
function render(keepScroll) {
  if (!S.booted) return;
  const sc = app.querySelector('.scroll'), y = keepScroll && sc ? sc.scrollTop : 0;
  const shEl = app.querySelector('.sheet'), sy = keepScroll && shEl ? shEl.scrollTop : 0;
  // keep what the person was typing in an open form
  const typed = {};
  if (keepScroll) app.querySelectorAll('input[id],textarea[id],select[id]').forEach(el => { typed[el.id] = el.value; });
  const { html, tabs } = screen();
  app.innerHTML = `${html}${tabs ? tabbar(tabs) : ''}${sheetHtml()}<div class="toast" id="toast" data-show="false" role="status"></div>`;
  if (keepScroll) {
    for (const [id, v] of Object.entries(typed)) { const el = document.getElementById(id); if (el && id !== 'q') el.value = v; }
    const sc2 = app.querySelector('.scroll'); if (sc2) sc2.scrollTop = y;
    const sh2 = app.querySelector('.sheet'); if (sh2) sh2.scrollTop = sy;
  }
}
let toastT;
function toast(msg) {
  const t = document.getElementById('toast'); if (!t) return;
  t.textContent = msg; t.dataset.show = 'true';
  clearTimeout(toastT); toastT = setTimeout(() => { const t2 = document.getElementById('toast'); if (t2) t2.dataset.show = 'false'; }, 3200);
}
const go = (changes, keep) => { Object.assign(S.ui, changes); render(keep); };
const requireLogin = () => { if (S.user) return true; S.ui.stack.push({ name: 'auth' }); S.ui.sheet = null; render(); return false; };
const busy = (btn, on) => { if (!btn) return; btn.disabled = on; btn.dataset.label ??= btn.innerHTML; btn.innerHTML = on ? 'استنى…' : btn.dataset.label; };
const errMsg = e => {
  const m = e?.message || String(e);
  if (/Invalid login/i.test(m)) return 'الإيميل أو كلمة السر مش صح.';
  if (/already registered/i.test(m)) return 'الإيميل ده عليه حساب بالفعل. سجّل دخول.';
  if (/Password should be/i.test(m)) return 'كلمة السر لازم تكون ٨ حروف على الأقل.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'مفيش اتصال بالنت. جرّب تاني.';
  return m;
};

/* ---------- events ---------- */
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-action]'); if (!el) return;
  const a = el.dataset.action, id = el.dataset.id;
  if (a === 'close-sheet') { if (e.target !== el && el.classList.contains('sheet-wrap')) return; S.ui.draft = null; return go({ sheet: null }, true); }
  switch (a) {
    case 'tab': S.ui.stack = []; S.ui.sheet = null; return go({ tab: el.dataset.tab });
    case 'back': S.ui.stack.pop(); return go({});
    case 'retry': S.cache = {}; return render();
    case 'reload': return location.reload();
    case 'refresh': invalidate('req:', 'admin:', 'crafter', 'reviews'); return render(true);
    case 'open-cat': S.ui.stack.push({ name: 'cat', id }); return go({});
    case 'open-crafter': S.ui.stack.push({ name: 'crafter', id }); return go({});
    case 'open-trades': S.ui.stack.push({ name: 'trades' }); return go({});
    case 'open-helper': S.ui.stack.push({ name: 'helper' }); return go({});
    case 'open-auth': S.ui.stack.push({ name: 'auth' }); return go({ auth: el.dataset.v === 'signup' ? 'signup' : S.ui.auth });
    case 'jump': { const t = document.getElementById('svc-' + el.dataset.v); if (t) t.scrollIntoView({ block: 'start' }); return; }
    case 'seg': return go({ seg: el.dataset.v }, true);
    case 'aseg': return go({ aseg: el.dataset.v }, true);
    case 'auth-mode': return go({ auth: el.dataset.v }, true);
    case 'sign-role': return go({ signRole: el.dataset.v }, true);
    case 'open-request': if (!requireLogin()) return; return go({ sheet: 'req:' + id }, true);
    case 'open-q': if (!requireLogin()) return; return go({ sheet: 'q:' + id }, true);
    case 'open-task': if (!requireLogin()) return; S.ui.draft = null; return go({ sheet: 'h:' + id }, true);
    case 'open-rate': S.ui.rateStars = 5; return go({ sheet: 'rate:' + id }, true);
    case 'rate-star': S.ui.rateStars = Number(el.dataset.v); return render(true);
    case 'h-step': {
      const d = S.ui.draft, k = el.dataset.k, lim = k === 'count' ? [1, 6] : [2, 12];
      const note = document.getElementById('h-note'); if (note) d.note = note.value;
      d[k] = Math.min(lim[1], Math.max(lim[0], d[k] + Number(el.dataset.d)));
      return render(true);
    }
    case 'cancel-req': {
      busy(el, true);
      try { await q(sb.from('requests').update({ status: 'cancelled' }).eq('id', id)); invalidate('req:'); render(true); toast('الطلب اتلغى.'); }
      catch (err) { busy(el, false); toast(errMsg(err)); }
      return;
    }
    case 'job-status': {
      busy(el, true);
      try {
        await q(sb.from('requests').update({ status: el.dataset.v }).eq('id', id));
        invalidate('req:');
        if (el.dataset.v === 'done') S.card = await q(sb.from('craftsmen').select('*').eq('id', S.user.id).maybeSingle());
        render(true);
        toast({ accepted: 'تمام! كلّم العميل واتفقوا على المعاد.', rejected: 'اتبعت اعتذارك للعميل.', done: 'برافو! العميل يقدر يقيّمك دلوقتي.' }[el.dataset.v]);
      } catch (err) { busy(el, false); toast(errMsg(err)); }
      return;
    }
    case 'toggle-avail': {
      const v = !S.card.available;
      try { S.card = await q(sb.from('craftsmen').update({ available: v }).eq('id', S.user.id).select().single()); render(true); toast(v ? 'إنت متاح للطلبات.' : 'قفلت استقبال الطلبات.'); }
      catch (err) { toast(errMsg(err)); }
      return;
    }
    case 'become-worker': S.card = null; S.profile = { ...S.profile, role: 'craftsman' }; S.ui.stack = []; return go({ tab: 'home' });
    case 'admin-status': {
      busy(el, true);
      try { await q(sb.rpc('admin_set_craftsman_status', { p_id: id, p_status: el.dataset.v })); invalidate('admin:', 'crafters', 'crafter:'); render(true); toast(el.dataset.v === 'approved' ? 'تمام، الصنايعي بقى ظاهر للعملاء.' : 'الصنايعي اتوقف.'); }
      catch (err) { busy(el, false); toast(errMsg(err)); }
      return;
    }
    case 'sign-out': await sb.auth.signOut(); S.cache = {}; S.ui = { ...S.ui, tab: 'home', stack: [], sheet: null }; return;
  }
});

document.addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, btn = f.querySelector('[type=submit]');
  const val = sel => (f.querySelector(sel)?.value || '').trim();
  try {
    if (f.id === 'authForm') {
      const err = f.querySelector('#a-err'); err.textContent = '';
      const email = val('#a-email'), password = f.querySelector('#a-pass').value;
      if (!/^\S+@\S+\.\S+$/.test(email)) { err.textContent = 'اكتب إيميل صحيح.'; return; }
      if (password.length < 8) { err.textContent = 'كلمة السر لازم تكون ٨ حروف على الأقل.'; return; }
      busy(btn, true);
      if (S.ui.auth === 'signup') {
        const full_name = val('#a-name'), phone = digits(val('#a-phone')).replace(/[^\d+]/g, ''), area = val('#a-area');
        if (full_name.length < 3) { busy(btn, false); err.textContent = 'اكتب اسمك بالكامل.'; return; }
        if (phone.length < 10) { busy(btn, false); err.textContent = 'اكتب رقم موبايل صحيح.'; return; }
        const { data, error } = await sb.auth.signUp({ email, password, options: { data: { role: S.ui.signRole, full_name, phone, area } } });
        if (error) throw error;
        if (!data.session) { busy(btn, false); err.textContent = 'اتعمل الحساب. افتح الإيميل اللي وصلك وأكّده، وبعدين سجّل دخول.'; return; }
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      S.ui.stack = S.ui.stack.filter(s => s.name !== 'auth');
      return; // onAuthStateChange re-renders
    }
    if (f.id === 'reqForm') {
      const desc = val('#r-desc'), address = val('#r-addr');
      if (desc.length < 3) return toast('اكتب محتاج إيه.');
      if (address.length < 3) return toast('اكتب العنوان.');
      busy(btn, true);
      await q(sb.from('requests').insert({ craftsman_id: S.ui.sheet.slice(4), description: desc, address, day: val('#r-day'), time_slot: val('#r-time') }));
      invalidate('req:'); S.ui.stack = []; go({ sheet: null, tab: 'orders', seg: 'now' });
      return toast('طلبك وصل للصنايعي. هيرد عليك قريب.');
    }
    if (f.id === 'quickForm') {
      const address = val('#q-addr'); if (address.length < 3) return toast('اكتب العنوان.');
      busy(btn, true);
      await q(sb.rpc('book_quick_service', { p_service_id: Number(S.ui.sheet.slice(2)), p_address: address, p_day: val('#q-when'), p_note: val('#q-note') }));
      invalidate('req:'); S.ui.stack = []; go({ sheet: null, tab: 'orders', seg: 'now' });
      return toast('تمام! الصنايعي اتحجز، ورقمه ظاهر في الطلب.');
    }
    if (f.id === 'helperForm') {
      const d = S.ui.draft, address = val('#h-addr'); if (address.length < 3) return toast('اكتب العنوان.');
      busy(btn, true);
      await q(sb.rpc('book_helper', { p_task: d.task, p_helpers: d.count, p_hours: d.hours, p_address: address, p_day: val('#h-when'), p_note: val('#h-note') }));
      S.ui.draft = null; invalidate('req:'); S.ui.stack = []; go({ sheet: null, tab: 'orders', seg: 'now' });
      return toast('تمام! المساعد اتحجز، ورقمه ظاهر في الطلب.');
    }
    if (f.id === 'rateForm') {
      busy(btn, true);
      await q(sb.from('reviews').insert({ request_id: S.ui.sheet.slice(5), stars: S.ui.rateStars || 5, comment: val('#rt-comment') }));
      invalidate('req:', 'reviews:', 'crafter'); go({ sheet: null }, true);
      return toast('شكراً! تقييمك بيساعد غيرك يختار صح.');
    }
    if (f.id === 'profileForm') {
      busy(btn, true);
      S.profile = await q(sb.from('profiles').update({ full_name: val('#p-name'), phone: digits(val('#p-phone')).replace(/[^\d+]/g, ''), area: val('#p-area') }).eq('id', S.user.id).select().single());
      render(true); return toast('اتحفظ.');
    }
    if (f.id === 'cardForm') {
      const err = f.querySelector('#c-err'); err.textContent = '';
      const price = parseInt(digits(val('#c-price')), 10), years = parseInt(digits(val('#c-years')) || '0', 10);
      const row = { name: val('#c-name'), category: val('#c-cat'), area: val('#c-area'), price, unit: val('#c-unit'), years: Number.isFinite(years) ? years : 0, about: val('#c-about') };
      if (row.name.length < 2) { err.textContent = 'اكتب اسمك.'; return; }
      if (!(price > 0)) { err.textContent = 'اكتب سعرك بالأرقام.'; return; }
      busy(btn, true);
      S.card = S.card
        ? await q(sb.from('craftsmen').update(row).eq('id', S.user.id).select().single())
        : await q(sb.from('craftsmen').insert(row).select().single());
      if (S.profile.role === 'customer') S.profile.role = 'craftsman';
      invalidate('crafter'); render(true);
      return toast(S.card.status === 'pending' ? 'بياناتك اتبعتت للمراجعة.' : 'اتحفظ.');
    }
  } catch (err) {
    busy(btn, false);
    const box = f.querySelector('.err');
    if (box) box.textContent = errMsg(err); else toast(errMsg(err));
  }
});

document.addEventListener('input', e => {
  if (e.target.id !== 'q') return;
  const v = e.target.value.trim(), box = document.getElementById('qres'), body = document.getElementById('homeBody');
  if (!v) { box.hidden = true; body.hidden = false; return; }
  const qs = S.quick.filter(x => x.name.includes(v) || cat(x.category).name.includes(v));
  const ts = S.tasks.filter(x => x.name.includes(v) || x.description.includes(v));
  const top = S.cache['crafters:top'];
  const cs = Array.isArray(top) ? top.filter(c => c.name.includes(v) || cat(c.category).name.includes(v) || (c.area || '').includes(v)) : [];
  const parts = [];
  if (qs.length) parts.push(`<h2 class="res-h">إصلاحات بسعر ثابت</h2><div class="card qlist">${qs.map(x => `<button type="button" class="qrow" data-action="open-q" data-id="${x.id}"><span class="pop-ic sm tn-${TRADE[x.category]?.tint || 'blue'}">${icSafe(x.icon)}</span><span><b>${esc(x.name)}</b><small>${esc(x.duration)} تقريباً</small></span><span class="qp">${money(x.price)}</span></button>`).join('')}</div>`);
  if (ts.length) parts.push(`<h2 class="res-h">مساعد بالساعة</h2><div class="card qlist">${ts.map(x => `<button type="button" class="qrow" data-action="open-task" data-id="${x.id}"><span class="pop-ic sm tn-${tint(x.tint)}">${icSafe(x.icon)}</span><span><b>${esc(x.name)}</b><small>${esc(x.description)}</small></span><span class="qp">${money(x.rate)}/س</span></button>`).join('')}</div>`);
  if (cs.length) parts.push(`<h2 class="res-h">صنايعية</h2>${cs.map(proCard).join('')}`);
  box.innerHTML = parts.length ? parts.join('') : '<div class="empty">مفيش نتايج. جرّب «حنفية» أو «نقل» أو «نقاش».</div>';
  box.hidden = false; body.hidden = true;
});

// Refresh lists when the app comes back to the front, and every 30s while open.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.user) { invalidate('req:', 'admin:'); render(true); }
});
setInterval(() => {
  if (document.visibilityState !== 'visible' || !S.user || S.ui.sheet) return;
  const busyTyping = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if (busyTyping) return;
  invalidate('req:'); render(true);
}, 30000);

/* ---------- boot ---------- */
(async function boot() {
  try {
    const [cats, quick, tasks] = await Promise.all([
      q(sb.from('categories').select('*').order('sort')),
      q(sb.from('quick_services').select('*').eq('active', true).order('sort')),
      q(sb.from('helper_tasks').select('*').eq('active', true).order('sort')).catch(() => [])
    ]);
    S.cats = cats; S.quick = quick; S.tasks = tasks;
  } catch (e) {
    app.innerHTML = `<div class="scroll"><div class="empty" style="margin-top:40px">مش قادرين نوصل لشطبلي دلوقتي.<br>اتأكد من النت وجرّب تاني.<br><button class="btn sm" type="button" data-action="reload" style="margin-top:10px">جرّب تاني</button></div></div>`;
    return;
  }
  const { data: { session } } = await sb.auth.getSession();
  S.booted = true;
  await loadSession(session);
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return;
    setTimeout(() => loadSession(session), 0);   // don't call Supabase inside the callback
  });
})();

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
