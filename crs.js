/* =========================================================
   CRS Various — incoming CRS material by truck (bags and glass IBCs)
   Brought over from the old CRS Intake app (GitHub repo crs-intake).

   Data: Firestore collection "crsSheets", one doc per truck load:
     { id, date, carrier, rego, bin, location, manifest, createdAt, updatedAt,
       e: { <entryId>: { id, material, bag | ibc, weight(kg), done, doneAt, createdAt, updatedAt } } }
   Entries are written one field at a time (e.<id>), so two devices adding bags
   to the same truck at once never overwrite each other.
   Without Firebase the loads live in S.crsSheets like everything else.
   ========================================================= */
const CRS_MATS = [
  { id:'Aluminium',    short:'Alu',     group:'alu'   },
  { id:'PET - Clear',  short:'PET Clr', group:'other' },
  { id:'PET - Colour', short:'PET Col', group:'other' },
  { id:'HDPE',         short:'HDPE',    group:'other' },
  { id:'LPB',          short:'LPB',     group:'other' },
  { id:'Steel',        short:'Steel',   group:'other' },
  { id:'Glass',        short:'Glass',   group:'glass' },
];
const CRS_CARRIERS = ['Hawkins', 'MAMS'];
const CRS_LOCATIONS = ['Normanton', 'Badu Island', 'Thursday Island'];
const CRS_PERIODS = [['7d','Last 7 days'],['14d','Last 14 days'],['1m','Last month'],['3m','Last 3 months'],['6m','Last 6 months'],['12m','Last 12 months'],['all','All loads'],['custom','Custom dates']];
const CRS_GROUPS = [['location','Location'],['carrier','Carrier'],['month','Month'],['week','Week'],['rego','Truck rego']];
const CRS_MIN_ROWS = 20;
const crsGroupOf = m => (CRS_MATS.find(x => x.id === m) || { group:'other' }).group;
const crsNorm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const crsNum = s => String(s || '').toLowerCase().replace(/\s+/g, '');
const crsD = d => d ? d.split('-').reverse().join('/') : '';
const crsNow = () => new Date().toISOString();
const crsEid = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : uid() + uid());

/* ---------- UI state (this device) ---------- */
let CRS_OPEN = null;        // id of the open load, or { draft: meta } before its first entry
let CRS_HL = null;          // { material, number } highlighted from a search result
let CRS_Q = { mat:'', num:'' };
let CRS_RECENT = 25;
const CRS_UI_KEY = 'containertracks:crs-ui';
let CRS_UI = (() => { try { return Object.assign({ period:'1m', from:'', to:'', group:'location' }, JSON.parse(localStorage.getItem(CRS_UI_KEY)) || {}); } catch(e){ return { period:'1m', from:'', to:'', group:'location' }; } })();
function crsUI(p){ Object.assign(CRS_UI, p); try { localStorage.setItem(CRS_UI_KEY, JSON.stringify(CRS_UI)); } catch(e) {} render(); }

/* ---------- data ---------- */
const crsSheets = () => S.crsSheets || (S.crsSheets = []);
const crsSheet = id => crsSheets().find(s => s.id === id);
const crsEntries = s => Object.values(s && s.e || {}).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
const crsBlocked = () => CLOUD && CLOUD.blocked && CLOUD.blocked.has('crsSheets');
const crsKey = m => [m.date, crsNorm(m.carrier), normRego(m.rego), crsNorm(m.bin), crsNorm(m.location)].join('|');
const crsOpenSheet = () => CRS_OPEN && typeof CRS_OPEN === 'object' ? null : crsSheet(CRS_OPEN);
const crsMeta = () => CRS_OPEN && typeof CRS_OPEN === 'object' ? CRS_OPEN.draft : crsOpenSheet();

/* write a new load */
function crsCreate(sheet){
  crsSheets().push(sheet);
  if (CLOUD && CLOUD.loaded){
    if (crsBlocked()) return crsRulesToast();
    CLOUD.F.setDoc(CLOUD.F.doc(CLOUD.db, 'crsSheets', sheet.id), clean(sheet)).catch(cloudErr);
  } else save();
}
/* change some fields of a load. Keys can be paths like 'e.<id>' or 'e.<id>.done'; null deletes. */
function crsPatch(id, patch){
  const s = crsSheet(id); if (!s) return;
  patch = Object.assign({ updatedAt: crsNow() }, patch);
  Object.entries(patch).forEach(([path, v]) => {
    const keys = path.split('.'); let o = s;
    keys.slice(0, -1).forEach(k => { o = o[k] = o[k] || {}; });
    const last = keys[keys.length - 1];
    if (v === null) delete o[last]; else o[last] = v;
  });
  if (CLOUD && CLOUD.loaded){
    if (crsBlocked()) return crsRulesToast();
    const F = CLOUD.F, up = {};
    Object.entries(patch).forEach(([k, v]) => up[k] = v === null ? F.deleteField() : (v && typeof v === 'object' ? clean(v) : v));
    F.updateDoc(F.doc(CLOUD.db, 'crsSheets', id), up).catch(cloudErr);
  } else save();
}
function crsDeleteSheet(id){
  S.crsSheets = crsSheets().filter(s => s.id !== id);
  if (CLOUD && CLOUD.loaded){
    if (crsBlocked()) return crsRulesToast();
    CLOUD.F.deleteDoc(CLOUD.F.doc(CLOUD.db, 'crsSheets', id)).catch(cloudErr);
  } else save();
}
function crsRulesToast(){ toast('CRS Various can’t save yet — paste the latest firestore.rules into Firebase and Publish'); }

/* ---------- weight split ----------
   Bags aren't weighed, glass IBCs are. Net weight − weighed glass is shared between the
   bag materials by number of bags × that material's slider (how heavy its bags are). */
const CRS_ROUND = 20;      // bag weights go back into the system in 20 kg steps
const CRS_W_DEF = 100, CRS_W_MAX = 200, CRS_W_STEP = 20;
/* sliders were 0–10 at first: scale those up (5 → 100) and keep everything on steps of 20 */
const crsWfix = v => { v = Number(v); if (isNaN(v)) return CRS_W_DEF; if (v <= 10) v *= 20; return Math.min(CRS_W_MAX, Math.max(0, Math.round(v / CRS_W_STEP) * CRS_W_STEP)); };
const crsDefW = m => { const v = (S.crsBagWeights || {})[m]; return v == null ? CRS_W_DEF : crsWfix(v); };
const crsW = (s, m) => { const v = s.w && s.w[m]; return v == null ? crsDefW(m) : crsWfix(v); };
const kgf = n => n == null || isNaN(n) ? '—' : Math.round(n).toLocaleString('en-AU') + ' kg';
function crsSplit(s, over){
  const es = crsEntries(s), counts = {};
  es.forEach(e => counts[e.material] = (counts[e.material] || 0) + 1);
  const gl = es.filter(e => crsGroupOf(e.material) === 'glass');
  const unweighed = gl.filter(e => e.weight === '' || e.weight == null).length;
  const glassKg = gl.reduce((t, e) => t + (e.weight === '' || e.weight == null ? 0 : Number(e.weight) || 0), 0);
  const rows = CRS_MATS.filter(m => m.group !== 'glass' && counts[m.id])
    .map(m => ({ id: m.id, n: counts[m.id], f: over && over[m.id] != null ? over[m.id] : crsW(s, m.id), kg: null }));
  const net = s.net === '' || s.net == null ? null : Number(s.net);
  const r = { net, glassKg, glassN: gl.length, unweighed, rows, ok: false, rem: null, reason: '' };
  if (net == null) { r.reason = 'Enter the net weight to divide it up between the materials.'; return r; }
  if (unweighed) { r.reason = `Waiting on the glass: ${unweighed} IBC${unweighed === 1 ? '' : 's'} still to weigh. The weight is divided up once every IBC has a weight.`; return r; }
  r.rem = net - glassKg;
  if (r.rem < 0) { r.reason = `The glass (${kgf(glassKg)}) weighs more than the net weight. Check the net weight and IBC weights.`; return r; }
  if (!rows.length) { r.ok = true; return r; }
  const tot = rows.reduce((t, x) => t + x.n * x.f, 0);
  if (!tot) { r.reason = 'Move at least one slider above 0.'; return r; }
  /* each material is rounded to the nearest 20 kg (how it goes back into the system).
     Largest-remainder rounding keeps the bags adding up to the rest of the net, to the nearest 20. */
  const R = CRS_ROUND, units = rows.map(x => r.rem * x.n * x.f / tot / R);
  let spare = Math.round(r.rem / R) - units.reduce((t, u) => t + Math.floor(u), 0);
  rows.forEach((x, i) => x.kg = Math.floor(units[i]) * R);
  rows.map((x, i) => [i, units[i] - Math.floor(units[i])]).sort((a, b) => b[1] - a[1])
    .forEach(([i]) => { if (spare > 0){ rows[i].kg += R; spare--; } });
  r.rounding = Math.round((r.rem - rows.reduce((t, x) => t + x.kg, 0)) * 10) / 10;
  r.ok = true; return r;
}

/* ---------- summaries ---------- */
function crsSum(s){
  const counts = {}; let glassKg = 0, toWeigh = 0, done = 0;
  const es = crsEntries(s);
  es.forEach(e => {
    counts[e.material] = (counts[e.material] || 0) + 1;
    if (e.done) done++;
    if (crsGroupOf(e.material) === 'glass'){
      if (e.weight === '' || e.weight == null) toWeigh++; else glassKg += Number(e.weight) || 0;
    }
  });
  const sp = crsSplit(s), kg = {};
  if (sp.ok){ sp.rows.forEach(x => kg[x.id] = x.kg); if (sp.glassN) kg.Glass = glassKg; }
  return { counts, glassKg, toWeigh, done, total: es.length, net: sp.net, split: sp.ok, kg };
}
function crsRange(){
  const p = CRS_UI.period, today = ymd();
  if (p === 'all') return ['0000-01-01', '9999-12-31'];
  if (p === 'custom') return [CRS_UI.from || '0000-01-01', CRS_UI.to || '9999-12-31'];
  const d = new Date(); d.setHours(12, 0, 0, 0);
  const days = { '7d':7, '14d':14 }[p];
  if (days) d.setDate(d.getDate() - (days - 1));
  else { const day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() - parseInt(p)); d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())); }
  return [ymd(d), today];
}
const crsPeriodText = () => { const [f, t] = crsRange(); return CRS_UI.period === 'all' ? 'all loads' : `${crsD(f.startsWith('0000') ? '' : f) || 'start'} to ${crsD(t.startsWith('9999') ? '' : t) || 'today'}`; };
function crsInPeriod(){
  const [f, t] = crsRange();
  return crsSheets().filter(s => s.date >= f && s.date <= t && Object.keys(s.e || {}).length)
    .sort((a, b) => b.date.localeCompare(a.date) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
}
function crsWeek(date){       // Monday of that week
  const [y, m, d] = date.split('-').map(Number), x = new Date(y, m - 1, d, 12);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return ymd(x);
}
const crsMonthLabel = m => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo - 1, 1).toLocaleDateString('en-AU', { month:'short', year:'numeric' }); };
function crsGroupKey(s, g){
  if (g === 'month') return [s.date.slice(0, 7), crsMonthLabel(s.date.slice(0, 7))];
  if (g === 'week'){ const w = crsWeek(s.date); return [w, 'Week of ' + crsD(w)]; }
  if (g === 'rego') return [normRego(s.rego), s.rego || '—'];
  const v = String(s[g] || '').trim();
  return [v ? v.toLowerCase() : '~', v || (g === 'location' ? 'No location' : '—')];
}
function crsGroup(list, g){
  const map = new Map(), total = { name:'Total', loads:0, counts:{}, glassKg:0, toWeigh:0, kg:{}, net:0, split:0 };
  list.forEach(s => {
    const [k, name] = crsGroupKey(s, g), sm = crsSum(s);
    if (!map.has(k)) map.set(k, { k, name, loads:0, counts:{}, glassKg:0, toWeigh:0, kg:{}, net:0, split:0 });
    [map.get(k), total].forEach(r => {
      r.loads++; r.glassKg += sm.glassKg; r.toWeigh += sm.toWeigh;
      if (sm.split){ r.split++; r.net += sm.net || 0; Object.entries(sm.kg).forEach(([m, v]) => r.kg[m] = (r.kg[m] || 0) + v); }
      Object.entries(sm.counts).forEach(([m, n]) => r.counts[m] = (r.counts[m] || 0) + n);
    });
  });
  const rows = [...map.values()];
  if (g === 'month' || g === 'week') rows.sort((a, b) => b.k.localeCompare(a.k));
  else rows.sort((a, b) => (a.k === '~') - (b.k === '~') || b.loads - a.loads || a.name.localeCompare(b.name));
  return { rows, total };
}
const crsCarriers = () => [...new Map([...CRS_CARRIERS, ...crsSheets().map(s => s.carrier)].filter(Boolean).map(c => [crsNorm(c), c])).values()];
const crsLocations = () => [...new Map([...CRS_LOCATIONS, ...crsSheets().map(s => s.location)].filter(Boolean).map(c => [crsNorm(c), c])).values()];

/* =========================================================
   RENDER
   ========================================================= */
function renderCrs(){
  if (CRS_OPEN && !crsMeta()) CRS_OPEN = null;      // load deleted on another device
  $('#main').innerHTML = (crsBlocked() ? `<div class="panel crs-warn"><b>CRS Various can’t reach the database yet.</b> Open Firebase console → Firestore Database → Rules, paste in the latest <code>firestore.rules</code> from the app and click Publish, then reload.</div>` : '')
    + (CRS_OPEN ? crsSheetHtml() : crsHomeHtml());
  if (CRS_OPEN && CRS_HL){ const h = document.querySelector('.crs-grid td.hit'); if (h) setTimeout(() => h.scrollIntoView({ block:'center', behavior:'smooth' }), 50); }
}

/* ---------- home: open a load, recent loads, search, report ---------- */
function crsHomeHtml(){
  const list = crsInPeriod(), { rows, total } = crsGroup(list, CRS_UI.group);
  const opts = (arr, sel) => arr.map(([v, l]) => `<option value="${v}" ${v === sel ? 'selected' : ''}>${l}</option>`).join('');
  const dl = (id, arr) => `<datalist id="${id}">${arr.map(v => `<option value="${esc(v)}">`).join('')}</datalist>`;
  const bags = Object.entries(total.counts).filter(([m]) => crsGroupOf(m) !== 'glass').reduce((a, [, n]) => a + n, 0);
  const groupLabel = CRS_GROUPS.find(g => g[0] === CRS_UI.group)[1];
  const empty = !crsSheets().length;
  return `
  <div class="crs-home">
    <div class="panel crs-open noprint">
      <h2>Incoming CRS Various Material</h2>
      <form class="row" onsubmit="crsLookup(event)" autocomplete="off">
        <div><label>Date</label><input type="date" id="crs-date" value="${ymd()}" required></div>
        <div><label>Carrier</label><input id="crs-carrier" list="crs-carriers" required placeholder="Choose or type"></div>
        <div><label>Truck rego</label><input id="crs-rego" required placeholder="e.g. 123ABC" style="text-transform:uppercase;width:130px"></div>
        <div><label>Bin no <span class="muted">(optional)</span></label><input id="crs-bin" style="width:110px"></div>
        <div><label>Location <span class="muted">(optional)</span></label><input id="crs-loc" list="crs-locs" placeholder="Choose or type"></div>
        <div><label>&nbsp;</label><button class="primary" type="submit">Open sheet</button></div>
        <div class="spacer"></div>
        <div><label>&nbsp;</label><button type="button" onclick="crsCalc()">🧮 MAM's Calculator</button></div>
      </form>
      ${dl('crs-carriers', crsCarriers())}${dl('crs-locs', crsLocations())}
      <p class="muted" style="margin:8px 0 0">Same date, carrier, rego, bin and location opens the same sheet, so anyone can carry on where someone else left off.</p>
      ${empty ? `<div class="crs-import"><b>Bringing loads over from the old CRS Intake app?</b> <label class="btn small">Import file…<input type="file" accept=".json" hidden onchange="crsImport(this.files[0]);this.value=''"></label></div>` : ''}
    </div>

    <div class="panel crs-filter noprint">
      <div class="row">
        <div><label>Period</label><select onchange="crsUI({period:this.value})">${opts(CRS_PERIODS, CRS_UI.period)}</select></div>
        ${CRS_UI.period === 'custom' ? `<div><label>From</label><input type="date" value="${CRS_UI.from}" onchange="crsUI({from:this.value})"></div><div><label>To</label><input type="date" value="${CRS_UI.to}" onchange="crsUI({to:this.value})"></div>` : ''}
        <div class="spacer"></div>
        <div><label>&nbsp;</label><button onclick="crsExport()">⬇ Export to Excel</button></div>
      </div>
    </div>

    <div class="summary">
      <div class="stat"><b>${total.loads}</b><span>Loads</span></div>
      <div class="stat"><b>${bags.toLocaleString('en-AU')}</b><span>Bags</span></div>
      <div class="stat"><b>${(total.counts.Glass || 0).toLocaleString('en-AU')}</b><span>Glass IBCs</span></div>
      <div class="stat"><b>${kgf(total.net)}</b><span>Net weight (${total.split} of ${total.loads} split)</span></div>
      ${total.toWeigh ? `<div class="stat warn"><b>${total.toWeigh}</b><span>IBCs to weigh</span></div>` : ''}
    </div>

    <div class="panel">
      <div class="row" style="align-items:center;margin-bottom:8px">
        <h2 style="margin:0">Report by ${groupLabel.toLowerCase()}</h2>
        <div class="spacer"></div>
        <span class="noprint" style="display:flex;flex-wrap:wrap;gap:6px">${CRS_GROUPS.map(([v, l]) => `<button class="fchip ${CRS_UI.group === v ? 'on' : ''}" onclick="crsUI({group:'${v}'})">${l}</button>`).join('')}</span>
      </div>
      <p class="muted" style="margin:0 0 8px">Bags per material (glass counted in IBCs), with the kg from each load's weight split underneath · ${crsPeriodText()}</p>
      ${crsTableHtml(rows, total, groupLabel)}
    </div>

    <div class="ch-grid2">
      <div class="panel">
        <h2>Recent loads <span class="muted" style="font-weight:400">${list.length} · ${crsPeriodText()}</span></h2>
        <div class="crs-recent">${list.slice(0, CRS_RECENT).map(crsRecentItem).join('') || '<p class="muted">No loads in this period.</p>'}</div>
        ${list.length > CRS_RECENT ? `<button class="noprint" onclick="CRS_RECENT+=25;render()">Show more (${list.length - CRS_RECENT})</button>` : ''}
      </div>
      <div class="panel noprint">
        <h2>Find a bag or IBC</h2>
        <div class="row">
          <div><label>Product</label><select id="crs-qmat" onchange="CRS_Q.mat=this.value;crsSearch()"><option value="">Any product</option>${CRS_MATS.map(m => `<option ${CRS_Q.mat === m.id ? 'selected' : ''}>${esc(m.id)}</option>`).join('')}</select></div>
          <div style="flex:1"><label>Bag or IBC number</label><input id="crs-qnum" type="search" value="${esc(CRS_Q.num)}" oninput="CRS_Q.num=this.value;crsSearch()" placeholder="Searches every load" autocomplete="off"></div>
        </div>
        <div id="crs-results">${crsSearchHtml()}</div>
      </div>
    </div>
  </div>`;
}
function crsTableHtml(rows, total, label){
  const numTd = (n, d = 0) => { const v = +(n || 0).toFixed(d); return `<td class="n ${v ? '' : 'zero'}">${v ? v.toLocaleString('en-AU') : '–'}</td>`; };
  const mTd = (r, m) => { const n = r.counts[m.id] || 0; return n ? `<td class="n">${n.toLocaleString('en-AU')}${r.kg[m.id] != null ? `<small>${kgf(r.kg[m.id])}</small>` : ''}</td>` : `<td class="n zero">–</td>`; };
  const tRow = r => `<td>${esc(r.name)}${r.split < r.loads ? `<small class="muted">${r.split ? `${r.loads - r.split} not split yet` : 'not split yet'}</small>` : ''}</td>${numTd(r.loads)}${CRS_MATS.map(m => mTd(r, m)).join('')}<td class="n">${r.split ? kgf(r.net) : '–'}</td>`;
  return `<div class="tbl-wrap"><table class="crs-rpt">
    <thead><tr><th>${label}</th><th class="n">Loads</th>${CRS_MATS.map(m => `<th class="n crs-${m.group}">${m.group === 'glass' ? 'Glass (IBC)' : esc(m.id)}</th>`).join('')}<th class="n">Net kg</th></tr></thead>
    <tbody>${rows.map(r => `<tr>${tRow(r)}</tr>`).join('') || `<tr><td colspan="${CRS_MATS.length + 3}" class="muted">No bulka bags in this period.</td></tr>`}</tbody>
    ${rows.length > 1 ? `<tfoot><tr class="tot">${tRow(total)}</tr></tfoot>` : ''}
  </table></div>`;
}

/* ---------- Reports tab: Bulka bags section (follows the Reports period) ---------- */
function crsBetween(from, to){
  return crsSheets().filter(s => (!from || s.date >= from) && (!to || s.date <= to) && Object.keys(s.e || {}).length)
    .sort((a, b) => b.date.localeCompare(a.date));
}
function bulkaPanel(from, to){
  const list = crsBetween(from, to), g = CRS_UI.rptGroup || 'location', { rows, total } = crsGroup(list, g);
  const label = CRS_GROUPS.find(x => x[0] === g)[1];
  const bags = Object.entries(total.counts).filter(([m]) => crsGroupOf(m) !== 'glass').reduce((a, [, n]) => a + n, 0);
  const period = !from && !to ? 'all dates' : `${crsD(from) || 'start'} to ${crsD(to) || 'today'}`;
  return `<div class="panel bulka">
    <div class="row" style="align-items:center;margin-bottom:6px">
      <h2 style="margin:0">Bulka bags <span class="muted" style="font-weight:400">CRS Various · ${period}</span></h2>
      <div class="spacer"></div>
      <span class="noprint" style="display:flex;flex-wrap:wrap;gap:6px">${CRS_GROUPS.map(([v, l]) => `<button class="fchip ${g === v ? 'on' : ''}" onclick="crsUI({rptGroup:'${v}'})">${l}</button>`).join('')}</span>
    </div>
    <div class="summary" style="margin-bottom:12px">
      <div class="stat"><span>Truck loads</span><b>${total.loads}</b></div>
      <div class="stat"><span>Bags</span><b>${bags.toLocaleString('en-AU')}</b></div>
      <div class="stat"><span>Glass IBCs</span><b>${(total.counts.Glass || 0).toLocaleString('en-AU')}</b></div>
      <div class="stat"><span>Net weight (${total.split} of ${total.loads} split)</span><b>${kgf(total.net)}</b></div>
    </div>
    ${crsTableHtml(rows, total, label)}
    <div class="row noprint" style="margin-top:10px">
      <button onclick="crsExportList(crsBetween('${from || ''}', '${to || ''}'), 'Bulka bags ${period.replace(/\//g, '-')}')">⬇ Bulka bags to Excel</button>
      <button onclick="document.querySelector('#nav [data-v=crs]').click()">Go to CRS Various</button>
    </div>
  </div>`;
}

function crsRecentItem(s){
  const sm = crsSum(s), all = sm.done >= sm.total;
  const chips = CRS_MATS.filter(m => sm.counts[m.id]).map(m => `<span class="crs-chip crs-${m.group}">${m.group === 'glass'
    ? `Glass ${sm.counts[m.id]} IBC${sm.glassKg ? ' · ' + kgf(sm.glassKg) : ''}${sm.toWeigh ? ` · ${sm.toWeigh} to weigh` : ''}` : `${m.short} ${sm.counts[m.id]}`}</span>`).join('');
  const sub = [s.bin && `Bin ${esc(s.bin)}`, esc(s.location), s.manifest && `Manifest ${esc(s.manifest)}`].filter(Boolean).join(' · ');
  return `<button class="crs-item" onclick="crsOpen('${s.id}')">
    <div class="crs-idate"><b>${crsD(s.date).slice(0, 5)}</b><span>${crsDay(s.date)}</span></div>
    <div class="crs-imain"><div><b>${esc(s.carrier)}</b> · <span class="crs-rego">${esc(s.rego)}</span></div>${sub ? `<div class="muted">${sub}</div>` : ''}</div>
    <div class="crs-ichips">${chips}<span class="crs-chip ${all ? 'crs-done' : 'crs-todo'}">${all ? '✓ All ticked' : `✓ ${sm.done}/${sm.total}`}</span>${sm.split ? `<span class="crs-chip crs-done">⚖ ${kgf(sm.net)}</span>` : sm.net != null ? `<span class="crs-chip crs-todo">⚖ not split</span>` : ''}</div>
  </button>`;
}
function crsDay(date){
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (date === ymd()) return 'Today';
  if (date === ymd(y)) return 'Yesterday';
  const [a, b, c] = date.split('-').map(Number);
  return new Date(a, b - 1, c).toLocaleDateString('en-AU', { weekday:'short' });
}
function crsSearch(){ const el = $('#crs-results'); if (el) el.innerHTML = crsSearchHtml(); }
function crsSearchHtml(){
  const raw = CRS_Q.num.trim(), q = crsNum(raw), mat = CRS_Q.mat;
  if (!q) return `<p class="muted">Type a bag or IBC number. Leave the product as “Any product” to search everything.</p>`;
  const res = [];
  crsSheets().forEach(s => crsEntries(s).forEach(e => {
    if (mat && e.material !== mat) return;
    const no = String((crsGroupOf(e.material) === 'glass' ? e.ibc : e.bag) || ''), n = crsNum(no);
    if (n.includes(q)) res.push({ s, e, no, exact: n === q });
  }));
  res.sort((a, b) => (b.exact - a.exact) || b.s.date.localeCompare(a.s.date) || a.no.localeCompare(b.no, undefined, { numeric:true }));
  const ex = res.filter(r => r.exact).length;
  const mark = no => { const i = no.toLowerCase().indexOf(raw.toLowerCase()); return i < 0 ? esc(no) : esc(no.slice(0, i)) + '<mark>' + esc(no.slice(i, i + raw.length)) + '</mark>' + esc(no.slice(i + raw.length)); };
  return `<p class="muted">${res.length ? `${ex} exact match${ex === 1 ? '' : 'es'}${res.length > ex ? `, ${res.length - ex} containing “${esc(raw)}”` : ''}` : `Nothing matching “${esc(raw)}”.`}</p>`
    + res.slice(0, 100).map(({ s, e, no, exact }) => {
      const g = crsGroupOf(e.material);
      return `<button class="crs-hit ${exact ? 'exact' : ''}" onclick='crsOpen("${s.id}", ${JSON.stringify({ material: e.material, number: crsNum(no) }).replace(/'/g, '&#39;')})'>
        <span><span class="crs-chip crs-${g}">${esc(e.material)}</span> <span class="muted">${g === 'glass' ? 'IBC' : 'Bag'}</span> <b class="${e.done ? 'crs-struck' : ''}">${mark(no)}</b>${e.done ? ' <span class="crs-chip crs-done">✓</span>' : ''}</span>
        <span class="muted">${crsD(s.date)} · ${esc(s.carrier)} · ${esc(s.rego)}${s.location ? ' · ' + esc(s.location) : ''}</span></button>`;
    }).join('') + (res.length > 100 ? `<p class="muted">Showing the first 100 of ${res.length}.</p>` : '');
}

/* ---------- open / look up a load ---------- */
function crsLookup(ev){
  ev.preventDefault();
  const meta = { date: $('#crs-date').value, carrier: $('#crs-carrier').value.trim(), rego: normRego($('#crs-rego').value),
    bin: $('#crs-bin').value.trim(), location: $('#crs-loc').value.trim(), manifest:'' };
  if (!meta.date || !meta.carrier || !meta.rego) return;
  const k = crsKey(meta), found = crsSheets().find(s => crsKey(s) === k);
  CRS_HL = null;
  if (found){ CRS_OPEN = found.id; toast(`Opened existing sheet (${Object.keys(found.e || {}).length} entries)`); }
  else { CRS_OPEN = { draft: meta }; toast('New sheet — saves when the first entry is added'); }
  scrollTo(0, 0); render();
}
function crsOpen(id, hl){ CRS_OPEN = id; CRS_HL = hl || null; scrollTo(0, 0); render(); }
function crsBack(){ CRS_OPEN = null; CRS_HL = null; render(); }

/* ---------- the sheet (laid out like the paper form) ---------- */
function crsSheetHtml(){
  const m = crsMeta(), s = crsOpenSheet(), es = s ? crsEntries(s) : [];
  const alu = es.filter(e => crsGroupOf(e.material) === 'alu'), oth = es.filter(e => crsGroupOf(e.material) === 'other'), gls = es.filter(e => crsGroupOf(e.material) === 'glass');
  const n = Math.max(CRS_MIN_ROWS, alu.length, oth.length, gls.length);
  const hit = e => CRS_HL && (!CRS_HL.material || CRS_HL.material === e.material) && crsNum(crsGroupOf(e.material) === 'glass' ? e.ibc : e.bag) === CRS_HL.number;
  const cell = (txt, e, tick, cls = '') => e
    ? `<td class="filled ${e.done ? 'done' : ''} ${hit(e) ? 'hit' : ''} ${cls}" onclick="crsCellClick(event,'${e.id}')">${tick ? `<input type="checkbox" class="crs-tick" ${e.done ? 'checked' : ''} onchange="crsTick('${e.id}',this.checked)" title="Tick off when complete">` : ''}<span class="txt">${esc(txt)}</span></td>`
    : `<td class="${cls}"></td>`;
  let body = '';
  for (let i = 0; i < n; i++){
    const a = alu[i], o = oth[i], g = gls[i];
    body += `<tr>${cell(a ? i + 1 : '', a, true, 'idx')}${cell(a ? a.bag : '', a)}${cell(o ? o.material : '', o, true)}${cell(o ? o.bag : '', o)}${cell(g ? g.ibc : '', g, true)}${
      g && (g.weight === '' || g.weight == null) ? cell('to weigh', g, false, 'pending') : cell(g ? g.weight : '', g)}</tr>`;
  }
  const weighed = gls.filter(g => g.weight !== '' && g.weight != null), kgSum = weighed.reduce((t, g) => t + Number(g.weight || 0), 0);
  const pl = (k, w) => `${k} ${w}${k === 1 ? '' : 's'}`;
  const sm = s ? crsSum(s) : { counts:{}, done:0, total:0 };
  return `
  <div class="panel noprint crs-toolbar">
    <button onclick="crsBack()">← CRS Various</button>
    <button onclick="crsPrint()">🖨 Print</button>
    ${s ? `<button onclick="crsExportSheet()">⬇ Excel</button>` : ''}
    <button onclick="crsDetails()">✎ Edit details</button>
    ${s ? `<button class="danger" onclick="crsDelLoad()">Delete load</button>` : `<span class="muted">New sheet — saves when the first entry is added</span>`}
    <div class="spacer"></div>
    <button onclick="crsCalc()">🧮 MAM's Calculator</button>
    <button class="primary crs-addbtn" onclick="crsEntry()">+ Add entry</button>
  </div>
  <div class="panel crs-sheet">
    <h2 style="text-align:center">Incoming CRS Various Material</h2>
    <table class="crs-meta" onclick="crsDetails(event.target.closest('.crs-man') ? 'man' : '')" title="Tap to edit details">
      <tr><th>Date:</th><td>${crsD(m.date)}</td><th>Truck Rego:</th><td>${esc(m.rego)}</td></tr>
      <tr><th>Carrier:</th><td>${esc(m.carrier)}</td><th>Bin No:</th><td>${esc(m.bin)}</td></tr>
      <tr><th>Location:</th><td colspan="3">${esc(m.location)}</td></tr>
      <tr class="crs-man"><th>Manifest No:</th><td colspan="3" class="${m.manifest ? '' : 'crs-ph'}">${esc(m.manifest || 'tap to add')}</td></tr>
    </table>
    <div class="tbl-wrap"><table class="crs-grid">
      <colgroup><col style="width:58px"><col><col style="width:138px"><col><col><col></colgroup>
      <thead>
        <tr class="grp"><th colspan="2" class="crs-alu">Aluminium</th><th colspan="2" class="crs-other">Other</th><th colspan="2" class="crs-glass">Glass</th></tr>
        <tr><th>#</th><th>Bag Number</th><th>Material</th><th>Bag Number</th><th>IBC #</th><th>Weight (kg)</th></tr>
      </thead>
      <tbody>${body}</tbody>
      <tfoot><tr><td colspan="2">${pl(alu.length, 'bag')}</td><td colspan="2">${pl(oth.length, 'bag')}</td>
        <td colspan="2">${pl(gls.length, 'IBC')}${weighed.length ? ` · ${+kgSum.toFixed(1)} kg` : ''}${gls.length - weighed.length ? ` · ${gls.length - weighed.length} to weigh` : ''}</td></tr></tfoot>
    </table></div>
    <div class="crs-sum noprint">${CRS_MATS.filter(x => sm.counts[x.id]).map(x => `<span class="crs-chip crs-${x.group}">${esc(x.id)}: ${sm.counts[x.id]}</span>`).join('')}
      ${sm.total ? `<span class="crs-chip ${sm.done === sm.total ? 'crs-done' : ''}">${sm.done === sm.total ? `✓ All ${sm.done} ticked off` : `✓ ${sm.done} of ${sm.total} ticked off`}</span>` : ''}</div>
  </div>
  ${s ? crsWeightsHtml(s) : ''}
  <button class="crs-fab noprint" onclick="crsEntry()" aria-label="Add entry">+</button>`;
}
function crsWeightsHtml(s){
  const sp = crsSplit(s), perBag = x => x.kg != null && x.n ? (x.kg / x.n).toFixed(1) + ' kg' : '—';
  const rows = sp.rows.map(x => `<tr>
      <td><span class="crs-chip crs-${crsGroupOf(x.id)}">${esc(x.id)}</span></td>
      <td class="n">${x.n} bag${x.n === 1 ? '' : 's'}</td>
      <td class="crs-slcol"><div class="crs-sl"><small>Lighter</small>
        <input type="range" min="0" max="${CRS_W_MAX}" step="${CRS_W_STEP}" value="${x.f}" data-m="${esc(x.id)}" oninput="crsSlide(this,false)" onchange="crsSlide(this,true)">
        <small>Heavier</small><span class="crs-f">${x.f}</span></div></td>
      <td class="n" data-pb="${esc(x.id)}">${perBag(x)}</td>
      <td class="n" data-kg="${esc(x.id)}"><b>${kgf(x.kg)}</b></td></tr>`).join('');
  const glass = sp.glassN ? `<tr><td><span class="crs-chip crs-glass">Glass</span></td><td class="n">${sp.glassN} IBC${sp.glassN === 1 ? '' : 's'}</td>
      <td class="crs-slcol muted">Weighed${sp.unweighed ? ` · <span class="neg">${sp.unweighed} to weigh</span>` : ''}</td>
      <td class="n">${sp.glassN - sp.unweighed ? (sp.glassKg / (sp.glassN - sp.unweighed)).toFixed(1) + ' kg' : '—'}</td><td class="n"><b>${kgf(sp.glassKg)}</b></td></tr>` : '';
  return `<div class="panel crs-weights crs-sheet">
    <h2>Weights (kg)</h2>
    <p class="muted noprint" style="margin:0 0 10px">Enter the net weight. Glass IBCs keep their weighed kg; what's left is divided between the bags and rounded to the nearest ${CRS_ROUND} kg. Slide a material towards <b>Heavier</b> if its bags weigh more.</p>
    <div class="row" style="align-items:flex-end;margin-bottom:10px">
      <div><label>Net weight (kg)</label><input class="crs-netin" type="number" inputmode="decimal" min="0" step="1" value="${sp.net ?? ''}" placeholder="kg" onchange="crsSetNet(this.value)"></div>
      ${sp.glassN ? `<div><label>− Glass weighed</label><b style="font-size:18px">${kgf(sp.glassKg)}</b></div>` : ''}
      <div><label>= To divide between bags</label><b style="font-size:18px" id="crs-rem">${sp.rem != null ? kgf(sp.rem) : '—'}</b></div>
    </div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>Material</th><th class="n">Count</th><th class="crs-slcol">How heavy per bag</th><th class="n">Per bag</th><th class="n">Weight</th></tr></thead>
      <tbody>${rows}${glass}</tbody>
      ${sp.ok && sp.rounding ? `<tr><td colspan="4" class="muted">Rounding (bags are rounded to the nearest ${CRS_ROUND} kg)</td><td class="n muted">${sp.rounding > 0 ? '+' : '−'}${Math.abs(sp.rounding)} kg</td></tr>` : ''}
      <tfoot><tr class="tot"><td>Total</td><td></td><td class="crs-slcol"></td><td></td><td class="n">${sp.ok ? kgf(sp.net) : '—'}</td></tr></tfoot>
    </table></div>
    ${sp.ok ? '' : `<div class="crs-msg" id="crs-wmsg">${esc(sp.reason)}</div>`}
    ${sp.rows.length ? `<div class="row crs-wbtns noprint" style="margin-top:10px">
      <button class="small" onclick="crsSliderDefaults()">Reset sliders to default</button>
      <button class="small" onclick="crsSaveDefaults()">Save these sliders as the default</button></div>` : ''}
  </div>`;
}
/* ---------- MAM's Calculator: bag counts only, nothing is saved ---------- */
let CRS_CALC = null;
function crsCalc(){
  const prev = CRS_CALC || {};
  CRS_CALC = { net: prev.net ?? '', glass: prev.glass ?? '', n: Object.assign({}, prev.n || {}), w: Object.assign({}, prev.w || {}) };
  const bagMats = CRS_MATS.filter(m => m.group !== 'glass');
  openDlg("MAM's Calculator", `
    <p class="muted" style="margin-top:0">Work out the split without bag numbers. Nothing here is saved.</p>
    <div class="row" style="margin-bottom:10px">
      <div><label>Net weight (kg)</label><input id="cc-net" class="crs-netin" type="number" inputmode="decimal" min="0" value="${esc(CRS_CALC.net)}" oninput="crsCalcIn()"></div>
      <div><label>Glass weighed (kg)</label><input id="cc-glass" class="crs-netin" type="number" inputmode="decimal" min="0" value="${esc(CRS_CALC.glass)}" oninput="crsCalcIn()"></div>
      <div><label>= To divide between bags</label><b style="font-size:18px" id="cc-rem">—</b></div>
    </div>
    <div class="tbl-wrap crs-weights"><table>
      <thead><tr><th>Material</th><th class="n">Bags</th><th>How heavy per bag</th><th class="n">Per bag</th><th class="n">Weight</th></tr></thead>
      <tbody>${bagMats.map(m => { const f = CRS_CALC.w[m.id] ?? crsDefW(m.id); return `<tr>
        <td><span class="crs-chip crs-${m.group}">${esc(m.id)}</span></td>
        <td class="n"><input type="number" min="0" step="1" inputmode="numeric" data-cn="${esc(m.id)}" value="${esc(CRS_CALC.n[m.id] ?? '')}" placeholder="0" style="width:80px;text-align:right" oninput="crsCalcIn()"></td>
        <td><div class="crs-sl"><small>Lighter</small><input type="range" min="0" max="${CRS_W_MAX}" step="${CRS_W_STEP}" value="${f}" data-cw="${esc(m.id)}" oninput="this.nextElementSibling.nextElementSibling.textContent=this.value;crsCalcIn()"><small>Heavier</small><span class="crs-f">${f}</span></div></td>
        <td class="n" data-cpb="${esc(m.id)}">—</td><td class="n" data-ckg="${esc(m.id)}">—</td></tr>`; }).join('')}
        <tr id="cc-glassrow"><td><span class="crs-chip crs-glass">Glass</span></td><td></td><td class="muted">Weighed</td><td></td><td class="n" id="cc-gkg">—</td></tr>
        <tr id="cc-round" class="hidden"><td colspan="4" class="muted">Rounding (bags are rounded to the nearest ${CRS_ROUND} kg)</td><td class="n muted" id="cc-rkg"></td></tr>
      </tbody>
      <tfoot><tr class="tot"><td>Total</td><td class="n" id="cc-bags"></td><td></td><td></td><td class="n" id="cc-tot">—</td></tr></tfoot>
    </table></div>
    <div class="crs-msg" id="cc-msg"></div>`,
    `<button onclick="crsCalcClear()" style="margin-right:auto">Clear</button><button class="primary" onclick="closeDlg()">Close</button>`);
  crsCalcIn();
  setTimeout(() => $('#cc-net').focus(), 30);
}
function crsCalcIn(){
  const c = CRS_CALC, numv = v => String(v).trim() === '' ? null : Number(v);
  c.net = $('#cc-net').value; c.glass = $('#cc-glass').value;
  document.querySelectorAll('[data-cn]').forEach(i => c.n[i.dataset.cn] = i.value);
  document.querySelectorAll('[data-cw]').forEach(i => c.w[i.dataset.cw] = Number(i.value));
  /* build a throwaway load and run it through the same split as the real sheets */
  const e = {}; let k = 0;
  Object.entries(c.n).forEach(([m, v]) => { const n = Math.max(0, Math.floor(Number(v) || 0)); for (let i = 0; i < n; i++){ e['c' + k] = { id:'c' + k, material:m, bag:'', createdAt:String(k).padStart(6, '0') }; k++; } });
  const gkg = numv(c.glass);
  if (gkg) e.g = { id:'g', material:'Glass', ibc:'', weight:gkg, createdAt:'z' };
  const sp = crsSplit({ e, net: numv(c.net), w: c.w });
  const byId = Object.fromEntries(sp.rows.map(x => [x.id, x]));
  CRS_MATS.filter(m => m.group !== 'glass').forEach(m => {
    const x = byId[m.id], q = s => document.querySelector(`[data-${s}="${CSS.escape(m.id)}"]`);
    q('ckg').innerHTML = x && x.kg != null ? `<b>${kgf(x.kg)}</b>` : '—';
    q('cpb').textContent = x && x.kg != null ? (x.kg / x.n).toFixed(1) + ' kg' : '—';
  });
  $('#cc-glassrow').classList.toggle('hidden', !gkg); $('#cc-gkg').innerHTML = gkg ? `<b>${kgf(gkg)}</b>` : '—';
  $('#cc-rem').textContent = sp.rem != null ? kgf(sp.rem) : '—';
  $('#cc-round').classList.toggle('hidden', !(sp.ok && sp.rounding));
  if (sp.ok && sp.rounding) $('#cc-rkg').textContent = `${sp.rounding > 0 ? '+' : '−'}${Math.abs(sp.rounding)} kg`;
  const bags = sp.rows.reduce((t, x) => t + x.n, 0);
  $('#cc-bags').textContent = bags ? `${bags} bag${bags === 1 ? '' : 's'}` : '';
  $('#cc-tot').textContent = sp.ok ? kgf(sp.net) : '—';
  const msg = !bags && sp.net != null ? 'Enter how many bags of each material.' : sp.ok ? '' : sp.reason.replace('Enter the net weight to divide it up', 'Enter the net weight to divide it up');
  $('#cc-msg').textContent = msg; $('#cc-msg').classList.toggle('hidden', !msg);
}
function crsCalcClear(){ CRS_CALC = null; crsCalc(); }

function crsSetNet(v){
  const s = crsOpenSheet(); if (!s) return;
  const n = String(v).trim() === '' ? null : Math.max(0, Number(v));
  if (n != null && isNaN(n)) return toast('Net weight must be a number');
  crsPatch(s.id, { net: n }); render();
}
/* while dragging: update the numbers only (the slider itself must not be redrawn); on release: save */
function crsSlide(el, commit){
  const s = crsOpenSheet(); if (!s) return;
  const over = {}; document.querySelectorAll('.crs-weights input[type=range]').forEach(r => over[r.dataset.m] = Number(r.value));
  el.parentElement.querySelector('.crs-f').textContent = el.value;
  if (commit){ crsPatch(s.id, { w: Object.assign({}, s.w || {}, over) }); return render(); }
  const sp = crsSplit(s, over);
  sp.rows.forEach(x => {
    const kgEl = document.querySelector(`.crs-weights [data-kg="${CSS.escape(x.id)}"]`), pbEl = document.querySelector(`.crs-weights [data-pb="${CSS.escape(x.id)}"]`);
    if (kgEl) kgEl.innerHTML = `<b>${kgf(x.kg)}</b>`;
    if (pbEl) pbEl.textContent = x.kg != null ? (x.kg / x.n).toFixed(1) + ' kg' : '—';
  });
}
function crsSliderDefaults(){
  const s = crsOpenSheet(); if (!s) return;
  crsPatch(s.id, { w: null }); render(); toast('Sliders back to the default');
}
function crsSaveDefaults(){
  const s = crsOpenSheet(); if (!s) return;
  S.crsBagWeights = Object.assign({}, S.crsBagWeights || {});
  crsSplit(s).rows.forEach(x => S.crsBagWeights[x.id] = x.f);
  save(); toast('Saved as the default for new loads');
}
function crsCellClick(ev, id){
  if (ev.target.classList.contains('crs-tick')) return;
  const s = crsOpenSheet(); if (s && s.e[id]) crsEntry(s.e[id]);
}
function crsTick(id, on){
  const s = crsOpenSheet(); if (!s) return;
  crsPatch(s.id, { [`e.${id}.done`]: on, [`e.${id}.doneAt`]: on ? crsNow() : null, [`e.${id}.updatedAt`]: crsNow() });
  render();
}

/* ---------- add / edit an entry ---------- */
let CRS_EDIT = null, CRS_MAT = null;
function crsEntry(e = null){
  CRS_EDIT = e ? e.id : null; CRS_MAT = e ? e.material : null;
  openDlg(e ? 'Edit entry' : 'Add entry', `
    <p class="muted" style="margin-top:0">What is it?</p>
    <div class="crs-mats">${CRS_MATS.map(m => `<button type="button" data-m="${esc(m.id)}" class="crs-${m.group} ${CRS_MAT === m.id ? 'sel' : ''}" onclick="crsPick(this.dataset.m)">${esc(m.id)}</button>`).join('')}</div>
    <form id="crs-ef" onsubmit="event.preventDefault();crsSubmit(false)" autocomplete="off">
      <div id="crs-bagf" class="hidden"><label>Bag Number</label><input id="crs-bag" inputmode="numeric" style="width:100%" value="${esc(e && e.bag || '')}"></div>
      <div id="crs-glassf" class="hidden">
        <label>IBC #</label><input id="crs-ibc" style="width:100%" value="${esc(e && e.ibc || '')}">
        <label>Weight (kg) <span class="muted">— optional, can be added later</span></label><input id="crs-wt" type="number" inputmode="decimal" min="0" step="0.1" style="width:100%" value="${e && e.weight != null ? esc(e.weight) : ''}">
      </div>
      <div id="crs-err" class="neg" style="margin-top:6px"></div>
      <button type="submit" hidden></button>
    </form>`,
    `${e ? `<button class="danger" onclick="crsDelEntry()" style="margin-right:auto">Delete</button>` : ''}
     <button onclick="closeDlg()">Cancel</button>
     ${e ? '' : `<button id="crs-another" onclick="crsSubmit(true)" disabled>Add + another</button>`}
     <button class="primary" id="crs-ok" onclick="crsSubmit(false)" ${CRS_MAT ? '' : 'disabled'}>${e ? 'Update' : 'Add'}</button>`);
  if (CRS_MAT) crsPick(CRS_MAT, !(e && crsGroupOf(e.material) === 'glass' && (e.weight === '' || e.weight == null)));
  if (e && crsGroupOf(e.material) === 'glass' && (e.weight === '' || e.weight == null)) setTimeout(() => $('#crs-wt').focus(), 30);
}
function crsPick(m, focus = true){
  CRS_MAT = m;
  document.querySelectorAll('.crs-mats button').forEach(b => b.classList.toggle('sel', b.dataset.m === m));
  const glass = crsGroupOf(m) === 'glass';
  $('#crs-bagf').classList.toggle('hidden', glass); $('#crs-glassf').classList.toggle('hidden', !glass);
  $('#crs-ok').disabled = false; if ($('#crs-another')) $('#crs-another').disabled = false;
  $('#crs-err').textContent = '';
  if (focus) setTimeout(() => (glass ? $('#crs-ibc') : $('#crs-bag')).focus(), 30);
}
function crsSubmit(keep){
  const err = $('#crs-err'), m = CRS_MAT;
  if (!m){ err.textContent = 'Choose what it is first.'; return; }
  const glass = crsGroupOf(m) === 'glass', bag = $('#crs-bag').value.trim(), ibc = $('#crs-ibc').value.trim(), w = $('#crs-wt').value.trim();
  if (glass && !ibc){ err.textContent = 'Enter the IBC number.'; return $('#crs-ibc').focus(); }
  if (!glass && !bag){ err.textContent = 'Enter the bag number.'; return $('#crs-bag').focus(); }
  if (glass && w !== '' && !(Number(w) >= 0)){ err.textContent = 'Weight must be a number.'; return; }
  let s = crsOpenSheet();
  const no = (glass ? ibc : bag).toLowerCase();
  if (s && crsEntries(s).some(x => x.id !== CRS_EDIT && x.material === m && String((glass ? x.ibc : x.bag) || '').toLowerCase() === no)
      && !confirm(`${m} ${glass ? 'IBC' : 'bag'} "${glass ? ibc : bag}" is already on this sheet. Add it anyway?`)) return;
  const now = crsNow(), old = s && CRS_EDIT ? s.e[CRS_EDIT] : null;
  const entry = Object.assign({ id: CRS_EDIT || crsEid(), createdAt: old ? old.createdAt : now }, old && old.done ? { done: true, doneAt: old.doneAt } : {},
    { material: m, updatedAt: now }, glass ? { ibc, weight: w === '' ? '' : Number(w) } : { bag });
  if (!s){                                     // first entry: the load gets saved now
    const d = CRS_OPEN.draft;
    s = { id: 'crs' + uid(), date: d.date, carrier: d.carrier, rego: d.rego, bin: d.bin || '', location: d.location || '', manifest: d.manifest || '',
      createdAt: now, updatedAt: now, e: { [entry.id]: entry } };
    crsCreate(s); CRS_OPEN = s.id;
  } else crsPatch(s.id, { ['e.' + entry.id]: entry });
  render();
  if (keep){
    $('#crs-bag').value = ''; $('#crs-ibc').value = ''; $('#crs-wt').value = ''; err.textContent = '';
    toast(`Added ${m} ${glass ? 'IBC ' + ibc : 'bag ' + bag}`);
    (glass ? $('#crs-ibc') : $('#crs-bag')).focus();
  } else closeDlg();
}
function crsDelEntry(){
  const s = crsOpenSheet(), e = s && s.e[CRS_EDIT]; if (!e) return;
  if (!confirm(`Delete ${e.material} ${e.ibc ? 'IBC ' + e.ibc : 'bag ' + e.bag}?`)) return;
  crsPatch(s.id, { ['e.' + e.id]: null }); closeDlg(); render();
}
function crsDelLoad(){
  const s = crsOpenSheet(); if (!s) return;
  if (!confirm(`Delete the whole load for ${s.carrier} ${s.rego} on ${crsD(s.date)} (${Object.keys(s.e || {}).length} entries)? This can't be undone.`)) return;
  crsDeleteSheet(s.id); CRS_OPEN = null; render(); toast('Load deleted');
}

/* ---------- edit details (everything but the date) ---------- */
function crsDetails(focus){
  const m = crsMeta(); if (!m) return;
  openDlg('Edit details', `
    <p class="muted" style="margin-top:0">Date: <b>${crsD(m.date)}</b> (the date can't be changed)</p>
    <form id="crs-df" onsubmit="event.preventDefault();crsSaveDetails()" autocomplete="off">
      <div class="cols">
        <div><label>Carrier</label><input id="crs-dc" list="crs-carriers2" value="${esc(m.carrier)}" style="width:100%"></div>
        <div><label>Truck rego</label><input id="crs-dr" value="${esc(m.rego)}" style="width:100%;text-transform:uppercase"></div>
        <div><label>Bin no</label><input id="crs-db" value="${esc(m.bin)}" style="width:100%"></div>
        <div><label>Location</label><input id="crs-dl" list="crs-locs2" value="${esc(m.location)}" style="width:100%"></div>
      </div>
      <label>Manifest no <span class="muted">— usually added later</span></label><input id="crs-dm" value="${esc(m.manifest)}" style="width:100%">
      <datalist id="crs-carriers2">${crsCarriers().map(v => `<option value="${esc(v)}">`).join('')}</datalist>
      <datalist id="crs-locs2">${crsLocations().map(v => `<option value="${esc(v)}">`).join('')}</datalist>
      <div id="crs-derr" class="neg" style="margin-top:6px"></div>
      <button type="submit" hidden></button>
    </form>`,
    `<button onclick="closeDlg()">Cancel</button><button class="primary" onclick="crsSaveDetails()">Save</button>`);
  setTimeout(() => $(focus === 'man' ? '#crs-dm' : '#crs-dc').focus(), 30);
}
function crsSaveDetails(){
  const m = crsMeta(), s = crsOpenSheet();
  const nm = { date: m.date, carrier: $('#crs-dc').value.trim(), rego: normRego($('#crs-dr').value), bin: $('#crs-db').value.trim(),
    location: $('#crs-dl').value.trim(), manifest: $('#crs-dm').value.trim() };
  if (!nm.carrier || !nm.rego){ $('#crs-derr').textContent = 'Carrier and truck rego are required.'; return; }
  const other = crsSheets().find(x => x !== s && crsKey(x) === crsKey(nm));
  if (other){ $('#crs-derr').textContent = `There's already a sheet for ${nm.carrier} ${nm.rego} on ${crsD(nm.date)} with those details. Open that one instead.`; return; }
  if (s) crsPatch(s.id, { carrier: nm.carrier, rego: nm.rego, bin: nm.bin, location: nm.location, manifest: nm.manifest });
  else Object.assign(CRS_OPEN.draft, nm);
  closeDlg(); render();
}

/* ---------- print: one A4 portrait page, like the paper form ---------- */
function crsPrint(){
  const sh = document.querySelector('.crs-sheet'); if (!sh) return;
  const PX = 96 / 25.4, W = 190 * PX, H = 277 * PX - 6;
  document.body.classList.add('crs-print');
  sh.style.width = W + 'px';
  const tb = sh.querySelector('.crs-grid tbody'), rowH = tb.lastElementChild ? tb.lastElementChild.getBoundingClientRect().height : 25;
  for (let i = 0; i < 60 && sh.scrollHeight + rowH <= H; i++) tb.insertAdjacentHTML('beforeend', '<tr class="crs-fill"><td class="idx"></td><td></td><td></td><td></td><td></td><td></td></tr>');
  if (sh.scrollHeight > H){ const k = H / sh.scrollHeight; sh.style.width = W / k + 'px'; sh.style.zoom = String(Math.min(1, H / sh.scrollHeight)); }
  const done = () => {
    document.body.classList.remove('crs-print'); sh.style.width = ''; sh.style.zoom = '';
    sh.querySelectorAll('.crs-fill').forEach(r => r.remove()); removeEventListener('afterprint', done);
  };
  addEventListener('afterprint', done); window.print(); setTimeout(done, 1500);
}

/* ---------- Excel ---------- */
const crsSafe = s => s.replace(/[\\/:*?"<>|]+/g, '-').trim();
const crsKg = n => Math.round((n || 0) * 10) / 10;
function crsExport(){ crsExportList(crsInPeriod(), `CRS Various - ${CRS_PERIODS.find(p => p[0] === CRS_UI.period)[1]}`, `CRS Various – ${crsPeriodText()}`); }
function crsExportList(list, fileLabel, title){
  title = title || fileLabel;
  if (!list.length) return toast('No loads in this period to export');
  if (!window.downloadXlsx) return toast('Excel export didn’t load — reload the page');
  const head = CRS_MATS.map(m => m.group === 'glass' ? 'Glass (IBC)' : m.id), kgHead = CRS_MATS.map(m => m.id + ' kg');
  const tab = (g, label) => {
    const { rows, total } = crsGroup(list, g);
    const line = r => [r.name, r.loads, ...CRS_MATS.map(m => r.counts[m.id] || 0), ...CRS_MATS.map(m => r.kg[m.id] != null ? Math.round(r.kg[m.id]) : ''), r.split ? Math.round(r.net) : '', r.split, r.toWeigh];
    const out = [[`${title} – by ${label.toLowerCase()}`], [], [label, 'Loads', ...head, ...kgHead, 'Net kg', 'Loads split', 'Glass to weigh'],
      ...rows.map(line), line(total)];
    return { name: 'By ' + label.toLowerCase(), rows: out, widths: [24, 8, ...CRS_MATS.map(() => 12), ...CRS_MATS.map(() => 13), 11, 11, 13], titleRows: [0], boldRows: [2, out.length - 1] };
  };
  const loads = [['Date', 'Carrier', 'Truck Rego', 'Bin No', 'Location', 'Manifest No', ...head, 'Net kg', ...kgHead, 'Weight split', 'Glass to weigh', 'Total items', 'Ticked off'],
    ...list.map(s => { const sm = crsSum(s); return [{ date: s.date }, s.carrier, s.rego, s.bin || '', s.location || '', s.manifest || '',
      ...CRS_MATS.map(m => sm.counts[m.id] || 0), sm.net == null ? '' : sm.net, ...CRS_MATS.map(m => sm.kg[m.id] != null ? Math.round(sm.kg[m.id]) : ''),
      sm.split ? 'Yes' : sm.net == null ? 'No net weight' : 'Waiting on glass', sm.toWeigh, sm.total, sm.done]; })];
  const items = [['Date', 'Carrier', 'Truck Rego', 'Bin No', 'Location', 'Manifest No', 'Material', 'Group', 'Bag Number', 'IBC #', 'Weight (kg)', 'Weighed or estimated', 'Ticked off', 'Added'],
    ...list.flatMap(s => { const sp = crsSplit(s), per = {}; if (sp.ok) sp.rows.forEach(x => per[x.id] = Math.round(x.kg / x.n * 10) / 10);
      return crsEntries(s).map(e => { const g = crsGroupOf(e.material), w = g === 'glass' ? (e.weight === '' || e.weight == null ? '' : Number(e.weight)) : (per[e.material] ?? '');
        return [{ date: s.date }, s.carrier, s.rego, s.bin || '', s.location || '', s.manifest || '', e.material,
        { alu:'Aluminium', other:'Other', glass:'Glass' }[g], e.bag || '', e.ibc || '', w, w === '' ? '' : g === 'glass' ? 'Weighed' : 'Estimated', e.done ? 'Yes' : '', e.createdAt ? fmtDate(e.createdAt) : '']; }); })];
  window.downloadXlsx(crsSafe(`${fileLabel} - ${ymd()}.xlsx`), [
    tab('location', 'Location'), tab('month', 'Month'), tab('carrier', 'Carrier'),
    { name: 'Loads', rows: loads, widths: [12, 18, 12, 10, 18, 14, ...CRS_MATS.map(() => 12), 10, ...CRS_MATS.map(() => 13), 16, 14, 11, 11], boldRows: [0] },
    { name: 'Every bag and IBC', rows: items, widths: [12, 18, 12, 10, 18, 14, 14, 11, 12, 10, 11, 18, 10, 18], boldRows: [0] },
  ]);
}
function crsExportSheet(){
  const s = crsOpenSheet(); if (!s || !window.downloadXlsx) return;
  const t = iso => iso ? new Date(iso).toLocaleTimeString('en-AU', { hour:'2-digit', minute:'2-digit' }) : '';
  const order = Object.fromEntries(CRS_MATS.map((x, i) => [x.id, i]));
  const es = crsEntries(s).sort((a, b) => (order[a.material] ?? 99) - (order[b.material] ?? 99) || String(a.createdAt).localeCompare(String(b.createdAt)));
  const totals = CRS_MATS.map(x => [x.id, es.filter(e => e.material === x.id).length]).filter(r => r[1]);
  const rows = [['Incoming CRS Various Material'], ['Date', { date: s.date }, '', 'Truck Rego', s.rego], ['Carrier', s.carrier, '', 'Bin No', s.bin || ''],
    ['Location', s.location || ''], ['Manifest No', s.manifest || ''], [], ['Material', 'Bag Number', 'IBC #', 'Weight (kg)', 'Added', 'Ticked off'],
    ...es.map(e => [e.material, e.bag || '', e.ibc || '', e.weight === '' || e.weight == null ? '' : Number(e.weight), t(e.createdAt), e.done ? `Yes ${t(e.doneAt)}`.trim() : '']),
    [], ['Totals', 'Count', 'Weight (kg)'], ...totals.map(([m, n]) => { const sp = crsSplit(s), x = sp.rows.find(r => r.id === m);
      return [m, n, m === 'Glass' ? (sp.glassKg || '') : x && x.kg != null ? x.kg : '']; }),
    ['Net weight (kg)', '', s.net == null ? '' : s.net]];
  window.downloadXlsx(crsSafe(`${s.date} ${s.carrier} ${s.rego}.xlsx`), [{ name:'Sheet', rows, widths:[16, 16, 12, 12, 10, 14], titleRows:[0], boldRows:[6, 8 + es.length] }]);
}

/* ---------- one-time import from the old CRS Intake app ---------- */
function crsImport(file){
  if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    let d; try { d = JSON.parse(r.result); } catch(e) { return toast('That file is not a CRS import file'); }
    if (!d || d.type !== 'mrflife-crs-import' || !Array.isArray(d.sheets)) return toast('That file is not a CRS import file');
    const have = new Set(crsSheets().map(s => s.id));
    const fresh = d.sheets.filter(s => s.id && s.date && !have.has(s.id));
    if (!fresh.length) return toast('Those loads are already here');
    const n = fresh.reduce((t, s) => t + Object.keys(s.e || {}).length, 0);
    if (!confirm(`Import ${fresh.length} load${fresh.length === 1 ? '' : 's'} (${n} bags and IBCs) from the old CRS Intake app?`)) return;
    fresh.forEach(s => crsCreate(s));
    render(); toast(`Imported ${fresh.length} loads`);
  };
  r.readAsText(file);
}
