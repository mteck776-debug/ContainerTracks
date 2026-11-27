/* =========================================================
   CRS Various → Manifests
   Upload Containers for Change freight manifests (PDF). Each line (Asset ID, material,
   qty, weight) is matched against the bags / IBCs recorded in CRS Various, showing which
   truck load it came in on and what is still missing. Manifests are kept, so bags that
   arrive on later trucks match as they are recorded.

   Data: one Firestore settings doc per manifest, id "crsman-<manifest id>":
     { id, date, from, location, provider, reg, gross, file, addedAt,
       lines: [{ a: asset id, m: material as printed, q: qty, w: weight kg }] }
   ========================================================= */
const PDFJS_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.min.js';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.worker.min.js';
let CRS_MAN = false;                 // showing the manifests page
let MAN_OPEN = {};                   // manifest id -> expanded
let MAN_FILTER = 'open';             // 'open' (not all found) | 'all'
let MAN_Q = '';

const crsManifests = () => S.crsManifests || (S.crsManifests = []);

(function manStyles(){
  const st = document.createElement('style');
  st.textContent = `
  .man-drop{border:2px dashed var(--line,#cbd5e1);border-radius:12px;padding:22px;text-align:center;background:#f8fafc}
  .man-drop.over{border-color:var(--accent,#2563eb);background:#eff6ff}
  .man-card{border:1px solid var(--line,#e2e8f0);border-radius:10px;margin:8px 0;background:#fff}
  .man-head{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:10px 12px;cursor:pointer}
  .man-head .grow{flex:1}
  .man-bar{height:8px;border-radius:99px;background:#e2e8f0;overflow:hidden;width:140px;display:inline-block;vertical-align:middle}
  .man-bar b{display:block;height:100%;background:#16a34a}
  .man-body{padding:0 12px 12px}
  .man-body td.ok{color:#15803d;font-weight:700}
  .man-body td.miss{color:#b45309;font-weight:700}
  .man-body tr.miss td{background:#fffbeb}
  .man-pill{font-size:12px;border-radius:99px;padding:2px 9px;background:#e2e8f0;font-weight:700}
  .man-pill.ok{background:#dcfce7;color:#166534}
  .man-pill.part{background:#fef3c7;color:#92400e}
  .man-pill.none{background:#fee2e2;color:#991b1b}
  .man-id{font-family:ui-monospace,Consolas,monospace;font-size:12px;color:#64748b}`;
  document.head.appendChild(st);
})();

/* ---------- reading the PDF ---------- */
function loadPdfJs(){
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  return new Promise((ok, bad) => {
    const s = document.createElement('script'); s.src = PDFJS_URL;
    s.onload = () => { pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; ok(pdfjsLib); };
    s.onerror = () => bad(new Error('Could not load the PDF reader (no internet?)'));
    document.head.appendChild(s);
  });
}
/* text rows: items grouped by their height on the page, left to right */
async function manRows(buf){
  const lib = await loadPdfJs(), pdf = await lib.getDocument({ data: buf }).promise, rows = [];
  for (let p = 1; p <= pdf.numPages; p++){
    const items = (await (await pdf.getPage(p)).getTextContent()).items.filter(i => i.str && i.str.trim());
    const byY = [];
    items.forEach(i => {
      const y = i.transform[5], x = i.transform[4];
      let r = byY.find(r => Math.abs(r.y - y) < 3);
      if (!r){ r = { y, items: [] }; byY.push(r); }
      r.items.push({ x, s: i.str.trim() });
    });
    byY.sort((a, b) => b.y - a.y).forEach(r => rows.push(r.items.sort((a, b) => a.x - b.x).map(i => i.s)));
  }
  return rows;
}
const MAN_MONTHS = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
const isNumTok = t => /^-?\d[\d,]*(\.\d+)?$/.test(t);
function manParse(rows, file){
  const text = rows.map(r => r.join(' ')).join('\n');
  const m = { id:'', date:'', from:'', location:'', provider:'', reg:'', gross:null, file: file || '', lines: [] };
  const id = /\b[0-9A-F]{32}\b/.exec(text); if (id) m.id = id[0];
  const d = /DATE:\s*(\d{1,2})[-\s/]([A-Za-z]{3})[A-Za-z]*[-\s/](\d{4})/.exec(text);
  if (d) m.date = `${d[3]}-${String(MAN_MONTHS[d[2].toLowerCase()] || 1).padStart(2, '0')}-${d[1].padStart(2, '0')}`;
  const g = /Gross load Weight:\s*([\d.,]+)/i.exec(text); if (g) m.gross = Number(g[1].replace(/,/g, ''));
  const reg = /REG NO:\s*(\S+)/i.exec(text); if (reg) m.reg = reg[1];
  const lp = /LOGISTIC PROVIDER:\s*(.+)/i.exec(text); if (lp) m.provider = lp[1].replace(/\s+(PTY\.?|LTD\.?).*$/i, '').trim();
  /* COLLECT FROM row: "QC37153003 Gulf Cash 4 Cans - Normanton QP12060001 Cairns Regional Council" */
  const cf = /\b(Q[A-Z]\d{6,})\s+(.+?)\s+Q[A-Z]\d{6,}\b/.exec(text);
  if (cf){ m.from = cf[2].trim(); const dash = m.from.lastIndexOf(' - '); m.location = dash > 0 ? m.from.slice(dash + 3).trim() : ''; }
  /* lines: <asset id> <material …> <qty> <weight> */
  rows.forEach(r => {
    if (r.length < 4 || !isNumTok(r[r.length - 1]) || !isNumTok(r[r.length - 2])) return;
    const a = r[0];
    if (!/\d/.test(a) || !/^[A-Za-z0-9][A-Za-z0-9_.\/#-]*$/.test(a) || /^Q[A-Z]\d{6,}$/.test(a)) return;
    const mat = r.slice(1, -2).join(' ').trim();
    if (!mat || isNumTok(mat)) return;
    m.lines.push({ a, m: mat, q: Number(r[r.length - 2].replace(/,/g, '')), w: Number(r[r.length - 1].replace(/,/g, '')) });
  });
  if (!m.id) m.id = 'F' + [m.date, m.from, m.lines.map(l => l.a).join(',')].join('|').split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(16).toUpperCase();
  return m;
}

/* ---------- matching ---------- */
/* manifest material → CRS Various product */
function manMat(raw){
  const s = crsNorm(raw);
  if (/glass/.test(s)) return 'Glass';
  if (/alu/.test(s)) return 'Aluminium';
  if (/pet/.test(s)) return /col/.test(s) ? 'PET - Colour' : 'PET - Clear';
  if (/hdpe/.test(s)) return 'HDPE';
  if (/lpb|paper ?board|liquid/.test(s)) return 'LPB';
  if (/steel/.test(s)) return 'Steel';
  return raw;
}
const manDigits = s => String(s || '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
const manLetters = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
let MAN_IDX = null, MAN_IDX_KEY = '';
/* every recorded bag/IBC, indexed by its number (exact) and by digits only */
function manIndex(){
  const sheets = crsSheets(), key = sheets.length + ':' + sheets.reduce((t, s) => t + (s.updatedAt || '') + Object.keys(s.e || {}).length, '');
  if (MAN_IDX && MAN_IDX_KEY === key) return MAN_IDX;
  const exact = new Map(), digits = new Map();
  sheets.forEach(s => crsEntries(s).forEach(e => {
    const no = String((crsGroupOf(e.material) === 'glass' ? e.ibc : e.bag) || ''); if (!no) return;
    const rec = { s, e, no };
    const k1 = crsNum(no); exact.set(k1, (exact.get(k1) || []).concat(rec));
    const k2 = manDigits(no); if (k2) digits.set(k2, (digits.get(k2) || []).concat(rec));
  }));
  MAN_IDX = { exact, digits }; MAN_IDX_KEY = key;
  return MAN_IDX;
}
/* best recorded entry for a manifest line, or null */
function manFind(line, man){
  const want = manMat(line.m), grp = crsGroupOf(want), idx = manIndex();
  const sameMat = r => r.e.material === want || (grp !== 'other' && crsGroupOf(r.e.material) === grp);
  let c = (idx.exact.get(crsNum(line.a)) || []).filter(sameMat), how = 'exact';
  if (!c.length){                     // "GULF-012" recorded as "12" or "GULF12": same digits, no clashing letters
    const L = manLetters(line.a);
    c = (idx.digits.get(manDigits(line.a)) || []).filter(r => sameMat(r) && (!manLetters(r.no) || manLetters(r.no) === L));
    how = 'number';
  }
  if (!c.length) return null;
  const score = r => (man.location && crsNorm(r.s.location) === crsNorm(man.location) ? 4 : 0) + (r.s.date >= (man.date || '') ? 2 : 0) + (how === 'exact' ? 1 : 0);
  c.sort((x, y) => score(y) - score(x) || String(x.s.date).localeCompare(String(y.s.date)));
  return { ...c[0], how, others: c.length - 1 };
}
function manStatus(man){
  const res = man.lines.map(l => manFind(l, man));
  const found = res.filter(Boolean).length;
  const loads = [...new Map(res.filter(Boolean).map(r => [r.s.id, r.s])).values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return { res, found, total: man.lines.length, loads };
}

/* ---------- upload ---------- */
async function manUpload(files){
  files = [...(files || [])].filter(f => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name));
  if (!files.length) return toast('Choose manifest PDFs');
  let added = 0, updated = 0, failed = [];
  toast(`Reading ${files.length} manifest${files.length > 1 ? 's' : ''}…`);
  for (const f of files){
    try {
      const m = manParse(await manRows(await f.arrayBuffer()), f.name);
      if (!m.lines.length){ failed.push(f.name); continue; }
      m.addedAt = new Date().toISOString();
      const list = crsManifests(), i = list.findIndex(x => x.id === m.id);
      if (i >= 0){ m.addedAt = list[i].addedAt || m.addedAt; list[i] = m; updated++; } else { list.push(m); added++; }
      MAN_OPEN[m.id] = files.length === 1;
    } catch(e){ console.error(e); failed.push(f.name); }
  }
  if (added || updated) save();
  render();
  toast([added && `${added} added`, updated && `${updated} already there (updated)`, failed.length && `${failed.length} couldn't be read: ${failed.join(', ')}`].filter(Boolean).join(' · ') || 'Nothing read');
}
function manDrop(ev){ ev.preventDefault(); ev.currentTarget.classList.remove('over'); manUpload(ev.dataTransfer.files); }
function manDel(id){
  const m = crsManifests().find(x => x.id === id); if (!m) return;
  if (!confirm(`Remove the manifest from ${m.from || m.location || '?'} (${crsD(m.date)})? The CRS Various loads aren't changed.`)) return;
  S.crsManifests = crsManifests().filter(x => x.id !== id); save(); render();
}
/* write this manifest's number onto the loads its bags came in on (added to any already there) */
function manStamp(id){
  const m = crsManifests().find(x => x.id === id); if (!m) return;
  const st = manStatus(m); let n = 0;
  st.loads.forEach(s => {
    const have = String(s.manifest || '').split(/[,;]\s*/).map(x => x.trim()).filter(Boolean);
    if (have.some(x => x.toUpperCase() === m.id.toUpperCase())) return;
    crsPatch(s.id, { manifest: have.concat(m.id).join(', ') }); n++;
  });
  render(); toast(n ? `Manifest number added to ${n} load${n > 1 ? 's' : ''}` : 'Those loads already have this manifest number');
}
/* tick off every bag/IBC on the sheets that this manifest accounts for */
function manTick(id){
  const m = crsManifests().find(x => x.id === id); if (!m) return;
  const now = crsNow(), by = {};
  manStatus(m).res.filter(r => r && !r.e.done).forEach(r => { (by[r.s.id] = by[r.s.id] || {})[`e.${r.e.id}.done`] = true; by[r.s.id][`e.${r.e.id}.doneAt`] = now; });
  const n = Object.values(by).reduce((t, p) => t + Object.keys(p).length / 2, 0);
  Object.entries(by).forEach(([sid, p]) => crsPatch(sid, p));
  render(); toast(n ? `Ticked off ${n} bag${n > 1 ? 's' : ''}/IBC${n > 1 ? 's' : ''}` : 'Already all ticked off');
}
function manOpenLoad(sid, mat, no){ CRS_MAN = false; crsOpen(sid, { material: mat, number: crsNum(no) }); }

/* ---------- page ---------- */
function crsManHtml(){
  const all = crsManifests().slice().sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.addedAt).localeCompare(String(a.addedAt)));
  const stats = new Map(all.map(m => [m.id, manStatus(m)]));
  const q = crsNorm(MAN_Q);
  const shown = all.filter(m => (MAN_FILTER === 'all' || stats.get(m.id).found < stats.get(m.id).total)
    && (!q || crsNorm([m.id, m.from, m.location, m.provider, m.file, crsD(m.date), ...m.lines.map(l => l.a)].join(' ')).includes(q)));
  const open = all.filter(m => stats.get(m.id).found < stats.get(m.id).total).length;
  const linesTot = all.reduce((t, m) => t + m.lines.length, 0), linesFound = all.reduce((t, m) => t + stats.get(m.id).found, 0);
  return `
  <div class="panel noprint crs-toolbar"><button onclick="CRS_MAN=false;render()">← CRS Various</button><div class="spacer"></div>
    <label class="btn primary">⬆ Upload manifests<input type="file" accept=".pdf,application/pdf" multiple hidden onchange="manUpload(this.files);this.value=''"></label></div>
  <div class="panel">
    <h2>Manifests</h2>
    <p class="muted" style="margin-top:0">Upload the Containers for Change freight manifests (PDF, as many at once as you like). Each line is matched to the bags and IBCs recorded in CRS Various by its Asset ID and material,
      so you can see which truck it came in on and what hasn't turned up yet. Manifests are kept, so bags recorded later match automatically.</p>
    <div class="man-drop noprint" ondragover="event.preventDefault();this.classList.add('over')" ondragleave="this.classList.remove('over')" ondrop="manDrop(event)">
      Drop manifest PDFs here, or <label class="btn small" style="display:inline-block;width:auto;margin:0 4px">choose files<input type="file" accept=".pdf,application/pdf" multiple hidden onchange="manUpload(this.files);this.value=''"></label>
    </div>
    <div class="summary" style="margin-top:12px">
      <div class="stat"><b>${all.length}</b><span>Manifests</span></div>
      <div class="stat"><b>${linesFound} / ${linesTot}</b><span>Lines matched</span></div>
      <div class="stat ${open ? 'warn' : ''}"><b>${open}</b><span>Still waiting on bags</span></div>
    </div>
    <div class="row noprint" style="align-items:flex-end;margin-top:6px">
      <div><label>Show</label><select onchange="MAN_FILTER=this.value;render()"><option value="open" ${MAN_FILTER === 'open' ? 'selected' : ''}>Still waiting on bags</option><option value="all" ${MAN_FILTER === 'all' ? 'selected' : ''}>All manifests</option></select></div>
      <div style="flex:1"><label>Search</label><input type="search" value="${esc(MAN_Q)}" placeholder="Asset ID, location, manifest no…" oninput="MAN_Q=this.value;clearTimeout(window._manT);window._manT=setTimeout(()=>{render();const i=document.querySelector('.man-search');if(i){i.focus();i.setSelectionRange(i.value.length,i.value.length)}},250)" class="man-search" style="width:100%"></div>
    </div>
    ${shown.map(m => manCardHtml(m, stats.get(m.id))).join('') || `<p class="muted">${all.length ? (MAN_FILTER === 'open' ? 'Every manifest is fully matched ✓ — choose “All manifests” to see them.' : 'No manifests match the search.') : 'No manifests yet. Upload some above.'}</p>`}
  </div>`;
}
function manCardHtml(m, st){
  const pct = st.total ? Math.round(st.found / st.total * 100) : 0;
  const pill = st.found === st.total ? `<span class="man-pill ok">all ${st.total} found</span>` : st.found ? `<span class="man-pill part">${st.found} of ${st.total} found</span>` : `<span class="man-pill none">none found yet</span>`;
  const isOpen = !!MAN_OPEN[m.id];
  const kg = m.lines.reduce((t, l) => t + (l.w || 0), 0);
  return `<div class="man-card">
    <div class="man-head" onclick="MAN_OPEN['${m.id}']=!MAN_OPEN['${m.id}'];render()">
      <b>${crsD(m.date) || '—'}</b>
      <span class="grow">${esc(m.from || m.location || m.file)}${m.provider ? ` <span class="muted">· ${esc(m.provider)}</span>` : ''}<br><span class="man-id">${esc(m.id)}</span></span>
      <span class="muted">${m.lines.length} line${m.lines.length === 1 ? '' : 's'} · ${kgf(m.gross ?? kg)}</span>
      <span class="man-bar"><b style="width:${pct}%"></b></span>${pill}
      <span>${isOpen ? '▾' : '▸'}</span>
    </div>
    ${isOpen ? `<div class="man-body">
      <div class="tbl-wrap"><table>
        <tr><th>Asset ID</th><th>Material</th><th class="n">Qty</th><th class="n">Weight</th><th></th><th>Came in on</th></tr>
        ${m.lines.map((l, i) => { const r = st.res[i]; return `<tr class="${r ? '' : 'miss'}">
          <td><b>${esc(l.a)}</b></td><td>${esc(l.m)}${manMat(l.m) !== l.m ? '' : ''}</td><td class="n">${l.q ?? ''}</td><td class="n">${l.w != null ? kgf(l.w) : ''}</td>
          ${r ? `<td class="ok">✓</td><td><a href="#" onclick="manOpenLoad('${r.s.id}','${esc(r.e.material)}','${esc(r.no)}');return false">${crsD(r.s.date)} · ${esc(r.s.carrier)} · ${esc(r.s.rego)}${r.s.location ? ' · ' + esc(r.s.location) : ''}</a>
              <span class="muted">— recorded as ${esc(r.no)}${r.how === 'number' ? ' (same number)' : ''}${r.e.done ? ' · ticked ✓' : ''}${r.others ? ` · also on ${r.others} other load${r.others > 1 ? 's' : ''}` : ''}</span></td>`
            : `<td class="miss">✗</td><td class="muted">not recorded yet</td>`}
        </tr>`; }).join('')}
      </table></div>
      <div class="row noprint" style="margin-top:8px">
        ${st.loads.length ? `<button onclick="manStamp('${m.id}')">Add manifest no to ${st.loads.length === 1 ? 'that load' : `those ${st.loads.length} loads`}</button>
          <button onclick="manTick('${m.id}')">Tick off the ${st.found} found</button>` : ''}
        <div class="spacer"></div>
        <span class="muted" style="align-self:center">${esc(m.file)}</span>
        <button class="small danger" onclick="manDel('${m.id}')">Remove</button>
      </div>
    </div>` : ''}
  </div>`;
}
