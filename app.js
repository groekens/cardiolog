/* ══════════════════════════════════════════════════
   CardioLog — app.js
   Full PWA: Auth · Recording · History · Chart · Export
   ══════════════════════════════════════════════════ */

'use strict';

// ── SERVICE WORKER REGISTRATION ──────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err =>
      console.warn('SW registration failed:', err)
    );
  });
}

// ══════════════════════════════════════════════════
//  GLOBAL STATE
// ══════════════════════════════════════════════════
let currentUser   = null;
let allReadings   = [];     // [{id, date, period, r1:{sys,dia,pulse}, r2:{sys,dia,pulse}, ts}]
let bpChartInst   = null;

// Keypad state machine
const kpState = {
  active: false,
  period: 'morning',
  date:   '',
  includePulse: false,  // décoché par défaut
  readings: [],
  step: 0,
  field: 'sys',
  value: '',
};

// ══════════════════════════════════════════════════
//  DOM SHORTCUTS
// ══════════════════════════════════════════════════
const $  = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// ══════════════════════════════════════════════════
//  UTILS
// ══════════════════════════════════════════════════
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function formatDateFR(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-');
  const months = ['jan','fév','mar','avr','mai','jun','jul','aoû','sep','oct','nov','déc'];
  const days   = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
  const dt = new Date(+y, +m-1, +d);
  return `${days[dt.getDay()]} ${+d} ${months[+m-1]} ${y}`;
}

function formatDateFRLong(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-');
  const months = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
  const days   = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
  const dt = new Date(+y, +m-1, +d);
  return `${days[dt.getDay()]} ${+d} ${months[+m-1]} ${y}`;
}

function detectPeriod() {
  const h = new Date().getHours();
  return h < 14 ? 'morning' : 'evening';
}

function bpCategory(sys, dia) {
  if (sys < 120 && dia < 80)               return { label: '✅ Normal',         color: '#3D8F6F' };
  if (sys < 130 && dia < 80)               return { label: '🟡 Élevé',           color: '#E8A838' };
  if (sys < 140 || dia < 90)               return { label: '🟠 HTA stade 1',     color: '#E07530' };
  if (sys >= 180 || dia >= 120)            return { label: '🔴 Crise HTA',       color: '#C0392B' };
  return                                          { label: '🔴 HTA stade 2',     color: '#C0392B' };
}

function avgReadings(readings) {
  // readings = [{sys,dia,pulse}, ...]
  const valid = readings.filter(r => r && r.sys && r.dia);
  if (!valid.length) return null;
  const sys  = Math.round(valid.reduce((s,r) => s + r.sys,   0) / valid.length);
  const dia  = Math.round(valid.reduce((s,r) => s + r.dia,   0) / valid.length);
  const pulseVals = valid.filter(r => r.pulse).map(r => r.pulse);
  const pulse = pulseVals.length ? Math.round(pulseVals.reduce((s,v) => s+v, 0) / pulseVals.length) : null;
  return { sys, dia, pulse };
}

function avgEntry(entry) {
  // Protocole médical : seule la 2e mesure est retenue pour les moyennes
  // La 1ère mesure est affichée à titre informatif uniquement
  if (entry.r2 && entry.r2.sys) return entry.r2;
  // Fallback sur r1 si r2 absent (entrée incomplète)
  if (entry.r1 && entry.r1.sys) return entry.r1;
  return null;
}

// Parse "YYYY-WNN" → display label
function weekLabel(key) {
  const [y, w] = key.split('-W');
  return `Semaine ${w} — ${y}`;
}

// Get ISO week number for a date string
function getWeekKey(isoDate) {
  const d = new Date(isoDate + 'T12:00:00');
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const weekNum = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2,'0')}`;
}

function getMonthKey(isoDate) {
  const [y, m] = isoDate.split('-');
  return `${y}-${m}`;
}

// Show toast
let toastTimer = null;
function showToast(msg, type = 'info') {
  const t = $('toast');
  t.textContent = msg;
  t.className = `toast toast-${type}`;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast hidden'; }, 2800);
}

// BP value display with colored badge
function bpHtml(sys, dia, pulse) {
  const cat = bpCategory(sys, dia);
  let html = `<div class="bp-display">
    <span class="bp-sys">${sys}</span>
    <span class="bp-sep">/</span>
    <span class="bp-dia">${dia}</span>
    <span class="bp-unit">mmHg</span>
  </div>`;
  if (pulse) html += `<div class="bp-pulse">❤️ ${pulse} bpm</div>`;
  html += `<span class="bp-badge" style="color:${cat.color}">${cat.label}</span>`;
  return html;
}

// ── FIREBASE ERROR MODAL ────────────────────────
function showFirebaseError(message, url) {
  $('fb-error-msg').textContent = message;
  if (url) {
    $('fb-error-url').textContent = url;
    $('fb-error-url-wrap').style.display = 'block';
    $('btn-copy-fb-url').onclick = () => {
      navigator.clipboard.writeText(url).then(() => {
        showToast('✓ Lien copié !', 'success');
      }).catch(() => {
        // Fallback: select the text
        const el = $('fb-error-url');
        const range = document.createRange();
        range.selectNodeContents(el);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
        showToast('Sélectionne le texte puis copie', 'info');
      });
    };
  } else {
    $('fb-error-url-wrap').style.display = 'none';
  }
  $('firebase-error-modal').classList.remove('hidden');
  $('btn-close-fb-modal').onclick = () => {
    $('firebase-error-modal').classList.add('hidden');
  };
}

// ══════════════════════════════════════════════════
//  FIREBASE CRUD
// ══════════════════════════════════════════════════
async function loadReadings() {
  if (!currentUser) return;
  try {
    const snap = await db.collection('readings')
      .where('uid', '==', currentUser.uid)
      .orderBy('date', 'desc')
      .get();
    allReadings = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    allReadings.sort((a, b) => {
      if (b.date !== a.date) return b.date.localeCompare(a.date);
      return b.period.localeCompare(a.period);
    });
  } catch (e) {
    console.error('loadReadings error:', e);
    // Extract Firebase index URL from error message if present
    const urlMatch = e.message && e.message.match(/https:\/\/console\.firebase\.google\.com[^\s"]+/);
    const indexUrl = urlMatch ? urlMatch[0] : null;
    showFirebaseError(
      'Erreur lors du chargement des données Firestore.\n' +
      (indexUrl ? 'Un index manquant doit être créé — copie le lien ci-dessous et ouvre-le dans un navigateur.' : e.message),
      indexUrl
    );
    allReadings = [];
  }
}

async function saveReading(entry) {
  entry.uid = currentUser.uid;
  entry.ts  = firebase.firestore.FieldValue.serverTimestamp();
  const ref = await db.collection('readings').add(entry);
  entry.id  = ref.id;
  // Update local cache
  allReadings = allReadings.filter(r => !(r.date === entry.date && r.period === entry.period));
  allReadings.unshift(entry);
  allReadings.sort((a,b) => {
    if (b.date !== a.date) return b.date.localeCompare(a.date);
    return b.period.localeCompare(a.period);
  });
}

async function deleteReading(id) {
  await db.collection('readings').doc(id).delete();
  allReadings = allReadings.filter(r => r.id !== id);
}

async function deleteAllReadings() {
  const batch = db.batch();
  allReadings.forEach(r => {
    batch.delete(db.collection('readings').doc(r.id));
  });
  await batch.commit();
  allReadings = [];
}

// ══════════════════════════════════════════════════
//  NAVIGATION
// ══════════════════════════════════════════════════
const SCREENS = ['home', 'record', 'history', 'chart', 'settings'];

function showScreen(name) {
  SCREENS.forEach(s => {
    $(`screen-${s}`).classList.toggle('hidden', s !== name);
    $(`screen-${s}`).classList.toggle('active', s === name);
  });
  // Update nav active state
  $$('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.nav === name);
  });
  // Refresh screen data on show
  if (name === 'home')     renderHome();
  if (name === 'history')  renderHistory();
  if (name === 'chart')    renderChart();
}

// ══════════════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════════════
function initAuth() {
  auth.onAuthStateChanged(async user => {
    $('loading-overlay').classList.add('hidden');
    if (user) {
      currentUser = user;
      $('screen-login').classList.add('hidden');
      $('app').classList.remove('hidden');
      await loadReadings();
      initHeaderDate();
      showScreen('home');
    } else {
      currentUser = null;
      $('screen-login').classList.remove('hidden');
      $('app').classList.add('hidden');
    }
  });

  $('btn-login').addEventListener('click', async () => {
    const email = $('login-email').value.trim();
    const pass  = $('login-password').value;
    const errEl = $('login-error');
    errEl.classList.add('hidden');
    $('btn-login').disabled = true;
    try {
      await auth.signInWithEmailAndPassword(email, pass);
    } catch (e) {
      errEl.textContent = 'Email ou mot de passe incorrect.';
      errEl.classList.remove('hidden');
    } finally {
      $('btn-login').disabled = false;
    }
  });

  $('login-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('btn-login').click();
  });

  $('btn-logout').addEventListener('click', async () => {
    await auth.signOut();
  });
}

// ══════════════════════════════════════════════════
//  HEADER DATE
// ══════════════════════════════════════════════════
function initHeaderDate() {
  const now = new Date();
  const h   = now.getHours();
  let greeting = 'Bonsoir';
  if (h >= 5  && h < 12) greeting = 'Bonjour';
  else if (h >= 12 && h < 18) greeting = 'Bon après-midi';
  $('header-greeting').textContent = greeting;

  const months = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
  const days   = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
  $('header-date').textContent = `${days[now.getDay()]} ${now.getDate()} ${months[now.getMonth()]}`;
}

// ══════════════════════════════════════════════════
//  HOME SCREEN
// ══════════════════════════════════════════════════
function renderHome() {
  const today = todayISO();
  const mEntry = allReadings.find(r => r.date === today && r.period === 'morning');
  const eEntry = allReadings.find(r => r.date === today && r.period === 'evening');

  renderPeriodCard('morning', mEntry);
  renderPeriodCard('evening', eEntry);
  renderWeeklyAvg();
}

function renderPeriodCard(period, entry) {
  const suffix  = period === 'morning' ? 'morning' : 'evening';
  const tagEl   = $(`tag-${suffix}`);
  const valsEl  = $(`values-${suffix}`);
  const cardEl  = $(`card-${suffix}`);

  if (!entry) {
    tagEl.textContent = 'Non enregistré';
    valsEl.innerHTML  = '<span class="period-empty-hint">Appuyez + pour enregistrer</span>';
    cardEl.classList.remove('card-done');
    return;
  }

  const avg = avgEntry(entry);
  if (!avg) return;
  const cat = bpCategory(avg.sys, avg.dia);

  tagEl.textContent = '✓ Enregistré';
  cardEl.classList.add('card-done');

  let html = '';
  // Show individual readings
  [entry.r1, entry.r2].filter(Boolean).forEach((r, i) => {
    if (!r.sys) return;
    html += `<div style="font-size:0.75rem;color:var(--text-3);margin-bottom:2px">
      <strong style="color:var(--text-2)">M${i+1}</strong> ${r.sys}/${r.dia} mmHg${r.pulse ? ` · ${r.pulse} bpm` : ''}
    </div>`;
  });
  // Average
  html += `<div class="bp-display" style="margin-top:4px">
    <span class="bp-sys">${avg.sys}</span>
    <span class="bp-sep">/</span>
    <span class="bp-dia">${avg.dia}</span>
    <span class="bp-unit">mmHg</span>
  </div>`;
  if (avg.pulse) html += `<div class="bp-pulse">❤️ ${avg.pulse} bpm</div>`;
  html += `<span class="bp-badge" style="color:${cat.color}">${cat.label}</span>`;
  html += `<button class="btn-delete-reading" onclick="confirmDeleteEntry('${entry.id}')" title="Supprimer">✕</button>`;

  valsEl.innerHTML = html;
}

function renderWeeklyAvg() {
  const weekKey = getWeekKey(todayISO());
  const weekReadings = allReadings
    .filter(e => getWeekKey(e.date) === weekKey)
    .flatMap(e => [e.r1, e.r2].filter(Boolean));
  const avg = avgReadings(weekReadings);

  const el = $('weekly-avg-content');
  if (!avg) {
    el.innerHTML = '<span class="muted-text">Pas encore de données cette semaine.</span>';
    return;
  }
  const cat = bpCategory(avg.sys, avg.dia);
  el.innerHTML = `
    <div class="avg-display">
      <span class="avg-bp">${avg.sys}</span>
      <span class="avg-sep" style="color:var(--text-3)">/</span>
      <span class="avg-bp">${avg.dia}</span>
      <span class="avg-unit">mmHg</span>
      ${avg.pulse ? `<span class="avg-pulse">❤️ ${avg.pulse} bpm</span>` : ''}
    </div>
    <div class="bp-badge" style="color:${cat.color};margin-top:4px">${cat.label}</div>
    <div style="font-size:0.72rem;color:var(--text-3);margin-top:4px">${weekReadings.length} mesure(s) cette semaine</div>
  `;
}

window.confirmDeleteEntry = async (id) => {
  if (!confirm('Supprimer cette mesure ?')) return;
  try {
    await deleteReading(id);
    renderHome();
    showToast('Mesure supprimée', 'info');
  } catch (e) {
    showToast('Erreur lors de la suppression', 'error');
  }
};

// ══════════════════════════════════════════════════
//  RECORD SCREEN — KEYPAD FLOW
// ══════════════════════════════════════════════════

// Steps: context → (for each reading: sys → dia → [pulse]) → summary
// reading 1 & 2

function initRecordScreen() {
  // Whole card clickable (not just the + button)
  $('card-morning').addEventListener('click', (e) => {
    if (!e.target.closest('.btn-delete-reading')) openRecord('morning');
  });
  $('card-evening').addEventListener('click', (e) => {
    if (!e.target.closest('.btn-delete-reading')) openRecord('evening');
  });
  // Keep + buttons working too (they bubble up to card handler above)
  $('btn-back-record').addEventListener('click', closeRecord);

  // Period toggle
  $$('.ptoggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.ptoggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Start recording
  $('btn-start-record').addEventListener('click', startKeypad);

  // Keypad keys
  $$('.key').forEach(btn => {
    btn.addEventListener('click', () => handleKey(btn.dataset.key));
  });

  // Skip pulse
  $('btn-skip-pulse').addEventListener('click', () => {
    kpState.value = '';
    advanceKeypad();
  });

  // Summary
  $('btn-save-record').addEventListener('click', saveCurrentRecord);
  $('btn-cancel-record').addEventListener('click', () => {
    showRecordStep('context');
  });
}

function openRecord(period) {
  kpState.period = period;
  // Set date to today
  $('record-date').value = todayISO();
  // Auto-select correct period toggle
  $$('.ptoggle-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.period === period);
  });
  showScreen('record');
  showRecordStep('context');
}

function closeRecord() {
  showScreen('home');
}

function startKeypad() {
  const toggle = document.querySelector('.ptoggle-btn.active');
  kpState.period = toggle ? toggle.dataset.period : 'morning';
  kpState.date   = $('record-date').value || todayISO();
  kpState.includePulse = $('include-pulse').checked;
  kpState.readings = [];
  kpState.step  = 0;
  kpState.field = 'sys';
  kpState.value = '';
  showRecordStep('keypad');
  updateKeypadUI();
}

// Fields per reading
function fieldsForStep(includePulse) {
  return includePulse ? ['sys', 'dia', 'pulse'] : ['sys', 'dia'];
}

function totalSteps(includePulse) {
  return fieldsForStep(includePulse).length * 2; // 2 readings
}

function currentFieldIndex() {
  const fields = fieldsForStep(kpState.includePulse);
  return fields.indexOf(kpState.field);
}

function handleKey(key) {
  if (key === 'del') {
    kpState.value = kpState.value.slice(0, -1);
    updateKeypadDisplay();
    return;
  }
  if (key === 'ok') {
    const val = parseInt(kpState.value, 10);
    if (!kpState.value || isNaN(val)) return;
    // Validate range
    const { valid, hint } = validateField(kpState.field, val);
    if (!valid) {
      $('kp-hint').textContent = `⚠️ ${hint}`;
      $('kp-hint').style.color = 'var(--accent)';
      return;
    }
    storeFieldValue(kpState.field, val);
    advanceKeypad();
    return;
  }
  // Digit
  const MAX_LEN = kpState.field === 'pulse' ? 3 : 3;
  if (kpState.value.length >= MAX_LEN) return;
  kpState.value += key;
  updateKeypadDisplay();
}

function validateField(field, val) {
  if (field === 'sys') {
    if (val < 60 || val > 250) return { valid: false, hint: 'Valeur inhabituelle (60–250 mmHg). Vérifier ?' };
  }
  if (field === 'dia') {
    if (val < 40 || val > 150) return { valid: false, hint: 'Valeur inhabituelle (40–150 mmHg). Vérifier ?' };
  }
  if (field === 'pulse') {
    if (val < 30 || val > 220) return { valid: false, hint: 'Valeur inhabituelle (30–220 bpm). Vérifier ?' };
  }
  return { valid: true };
}

function storeFieldValue(field, val) {
  if (!kpState.readings[kpState.step]) kpState.readings[kpState.step] = {};
  kpState.readings[kpState.step][field] = val;
}

function advanceKeypad() {
  kpState.value = '';
  const fields = fieldsForStep(kpState.includePulse);
  const currentIdx = fields.indexOf(kpState.field);

  if (currentIdx < fields.length - 1) {
    // Next field, same reading
    kpState.field = fields[currentIdx + 1];
    updateKeypadUI();
    return;
  }
  // End of fields for this reading
  if (kpState.step === 0) {
    // Move to reading 2
    kpState.step  = 1;
    kpState.field = 'sys';
    updateKeypadUI();
    return;
  }
  // Both readings done — show summary
  showSummary();
}

function updateKeypadDisplay() {
  $('kp-value').textContent = kpState.value || '—';
}

function updateKeypadUI() {
  const fields = fieldsForStep(kpState.includePulse);
  const total  = totalSteps(kpState.includePulse);
  const done   = kpState.step * fields.length + fields.indexOf(kpState.field);

  // Progress
  $('kp-progress-fill').style.width = `${(done / total) * 100}%`;
  $('kp-progress-label').textContent = `${done + 1} / ${total}`;

  // Badge
  $('kp-reading-badge').textContent = kpState.step === 0 ? 'Mesure 1' : 'Mesure 2';

  // Field name
  const names = { sys: 'Systolique', dia: 'Diastolique', pulse: 'Pouls' };
  $('kp-field-name').textContent = names[kpState.field];

  // Unit
  $('kp-unit').textContent = kpState.field === 'pulse' ? 'bpm' : 'mmHg';

  // Hint
  const hints = {
    sys:   'Valeur habituelle : 100–140',
    dia:   'Valeur habituelle : 60–90',
    pulse: 'Valeur habituelle : 60–100',
  };
  $('kp-hint').textContent = hints[kpState.field];
  $('kp-hint').style.color = 'var(--text-3)';

  // Value display
  $('kp-value').textContent = '—';

  // Skip button for pulse
  $('btn-skip-pulse').classList.toggle('hidden', kpState.field !== 'pulse');

  showRecordStep('keypad');
}

function showRecordStep(step) {
  $('record-step-context').classList.toggle('hidden', step !== 'context');
  $('record-step-keypad').classList.toggle('hidden', step !== 'keypad');
  $('record-step-summary').classList.toggle('hidden', step !== 'summary');

  if (step === 'context') {
    // reset to context display inside screen-content
    $('record-step-context').classList.remove('hidden');
  }
}

function showSummary() {
  const r1 = kpState.readings[0] || {};
  const r2 = kpState.readings[1] || {};
  const avg = avgReadings([r1, r2].filter(r => r.sys));

  let html = `<div class="summary-meta">
    <span>${kpState.period === 'morning' ? '🌅 Matin' : '🌙 Soir'}</span>
    <span>${formatDateFR(kpState.date)}</span>
  </div>`;

  html += `<div class="summary-readings">`;
  [r1, r2].forEach((r, i) => {
    if (!r.sys) return;
    html += `<div class="summary-reading-row">
      <span class="summary-reading-label">Mesure ${i+1}</span>
      <span class="summary-reading-vals">${r.sys}/${r.dia} mmHg${r.pulse ? ` · ${r.pulse} bpm` : ''}</span>
    </div>`;
  });
  html += `</div>`;

  if (avg) {
    const cat = bpCategory(avg.sys, avg.dia);
    html += `<div class="summary-avg">
      <div class="avg-label">Moyenne des deux mesures</div>
      <div class="avg-big">${avg.sys}<span>/</span>${avg.dia}</div>
      <div class="avg-unit">mmHg</div>
      ${avg.pulse ? `<div class="avg-pulse">❤️ ${avg.pulse} bpm</div>` : ''}
      <div class="avg-cat" style="color:${cat.color}">${cat.label}</div>
    </div>`;
  }

  $('summary-content').innerHTML = html;
  showRecordStep('summary');
}

async function saveCurrentRecord() {
  const entry = {
    date:   kpState.date,
    period: kpState.period,
    r1:     kpState.readings[0] || null,
    r2:     kpState.readings[1] || null,
  };
  try {
    $('btn-save-record').disabled = true;
    $('btn-save-record').textContent = 'Sauvegarde…';
    await saveReading(entry);
    showToast('✓ Mesure sauvegardée !', 'success');
    showScreen('home');
  } catch (e) {
    showToast('Erreur : ' + e.message, 'error');
  } finally {
    $('btn-save-record').disabled = false;
    $('btn-save-record').textContent = '💾 Sauvegarder';
  }
}

// ══════════════════════════════════════════════════
//  HISTORY SCREEN
// ══════════════════════════════════════════════════
function renderHistory() {
  const activeTab = document.querySelector('.avg-tab.active');
  const avgType   = activeTab ? activeTab.dataset.avgType : 'weekly';
  renderAvgBox(avgType);
  renderHistoryList();
}

function renderAvgBox(type) {
  const box = $('avg-box');
  let groups = {};

  if (type === 'weekly') {
    allReadings.forEach(e => {
      const k = getWeekKey(e.date);
      if (!groups[k]) groups[k] = [];
      // Protocole : seule la 2e mesure compte
      const ref = (e.r2 && e.r2.sys) ? e.r2 : (e.r1 && e.r1.sys ? e.r1 : null);
      if (ref) groups[k].push(ref);
    });
  } else if (type === 'monthly') {
    allReadings.forEach(e => {
      const k = getMonthKey(e.date);
      if (!groups[k]) groups[k] = [];
      const ref = (e.r2 && e.r2.sys) ? e.r2 : (e.r1 && e.r1.sys ? e.r1 : null);
      if (ref) groups[k].push(ref);
    });
  } else {
    allReadings.forEach(e => {
      if (!groups[e.date]) groups[e.date] = [];
      const ref = (e.r2 && e.r2.sys) ? e.r2 : (e.r1 && e.r1.sys ? e.r1 : null);
      if (ref) groups[e.date].push(ref);
    });
  }

  const keys = Object.keys(groups).sort((a,b) => b.localeCompare(a)).slice(0, 8);
  if (!keys.length) {
    box.innerHTML = '<span class="muted-text">Pas encore de données.</span>';
    return;
  }

  let html = '<div style="display:flex;flex-direction:column;gap:10px;">';
  keys.forEach(k => {
    const avg = avgReadings(groups[k]);
    if (!avg) return;
    const cat = bpCategory(avg.sys, avg.dia);
    let label = type === 'weekly' ? weekLabel(k) :
                type === 'monthly' ? monthLabel(k) : formatDateFR(k);
    html += `<div style="display:flex;align-items:center;justify-content:space-between;">
      <span style="font-size:0.82rem;color:var(--text-2);font-weight:600;">${label}</span>
      <span style="font-size:0.95rem;font-weight:800;color:var(--primary);">${avg.sys}/${avg.dia}
        <span style="font-size:0.7rem;color:var(--text-3)">mmHg</span>
        <span style="margin-left:6px;font-size:0.78rem;color:${cat.color}">${cat.label.split(' ')[0]}</span>
      </span>
    </div>`;
  });
  html += '</div>';
  box.innerHTML = html;
}

function monthLabel(key) {
  const [y, m] = key.split('-');
  const months = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  return `${months[+m-1]} ${y}`;
}

function renderHistoryList() {
  const list = $('history-list');
  if (!allReadings.length) {
    list.innerHTML = '<div class="empty-state">🫀<br>Aucune mesure enregistrée.<br>Appuyez sur + pour commencer.</div>';
    return;
  }

  // Group by date
  const byDate = {};
  allReadings.forEach(e => {
    if (!byDate[e.date]) byDate[e.date] = [];
    byDate[e.date].push(e);
  });

  let html = '';
  const sortedDates = Object.keys(byDate).sort((a,b) => b.localeCompare(a));

  sortedDates.forEach(date => {
    html += `<div class="history-day">
      <div class="history-day-header">${formatDateFRLong(date)}</div>`;
    byDate[date].forEach(entry => {
      const avg = avgEntry(entry);
      if (!avg) return;
      const cat = bpCategory(avg.sys, avg.dia);
      const periodLabel = entry.period === 'morning' ? '🌅' : '🌙';

      let readingsHtml = '';
      [entry.r1, entry.r2].filter(Boolean).forEach((r, i) => {
        if (!r.sys) return;
        readingsHtml += `<div class="history-reading-row">
          <span class="history-reading-num">M${i+1}</span>
          <span>${r.sys}/${r.dia} mmHg${r.pulse ? ` · <span style="color:var(--accent)">❤️${r.pulse}</span>` : ''}</span>
        </div>`;
      });

      html += `<div class="history-entry">
        <div class="history-entry-period">${periodLabel}</div>
        <div class="history-entry-readings">${readingsHtml}</div>
        <div class="history-entry-avg">
          <div class="bp-avg-compact" style="color:var(--primary)">${avg.sys}/${avg.dia}</div>
          <div class="history-cat" style="color:${cat.color}">${cat.label.split(' ')[0]}</div>
        </div>
        <button class="btn-delete-reading" onclick="confirmDeleteEntry('${entry.id}')" title="Supprimer">✕</button>
      </div>`;
    });
    html += `</div>`;
  });

  list.innerHTML = html;
}

// ══════════════════════════════════════════════════
//  CHART SCREEN
// ══════════════════════════════════════════════════
function renderChart() {
  const days = parseInt($('chart-range').value, 10) || 30;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffISO = cutoff.toISOString().split('T')[0];

  const filtered = allReadings.filter(e => e.date >= cutoffISO);

  // Group by date → daily avg (both periods)
  const byDate = {};
  filtered.forEach(e => {
    const ref = (e.r2 && e.r2.sys) ? e.r2 : (e.r1 && e.r1.sys ? e.r1 : null);
    if (!ref) return;
    if (!byDate[e.date]) byDate[e.date] = [];
    byDate[e.date].push(ref);
  });

  // Also for period avg
  const allFlat = filtered.map(e =>
    (e.r2 && e.r2.sys) ? e.r2 : (e.r1 && e.r1.sys ? e.r1 : null)
  ).filter(Boolean);

  // Build chart series from grouped data
  const labels = Object.keys(byDate).sort();
  const sysData = [], diaData = [];
  labels.forEach(d => {
    const avg = avgReadings(byDate[d]);
    sysData.push(avg ? avg.sys : null);
    diaData.push(avg ? avg.dia : null);
  });
  const shortLabels = labels.map(d => {
    const [, m, day] = d.split('-');
    return `${+day}/${+m}`;
  });
  const periodAvg = avgReadings(allFlat);
  if (periodAvg) {
    const cat = bpCategory(periodAvg.sys, periodAvg.dia);
    $('chart-period-avg').innerHTML = `
      <span style="font-size:1.4rem;font-weight:800;color:var(--primary)">${periodAvg.sys}/${periodAvg.dia}</span>
      <span style="font-size:0.8rem;color:var(--text-3)"> mmHg</span>
      ${periodAvg.pulse ? `<span style="font-size:0.85rem;color:var(--text-2);margin-left:8px">❤️ ${periodAvg.pulse} bpm</span>` : ''}
      <div style="color:${cat.color};font-weight:700;font-size:0.85rem;margin-top:4px">${cat.label}</div>
      <div style="font-size:0.72rem;color:var(--text-3);margin-top:2px">${allFlat.length} mesure(s) sur ${days} jours</div>
    `;
  } else {
    $('chart-period-avg').innerHTML = '<span class="muted-text">Pas de données sur cette période.</span>';
  }

  // Destroy previous chart
  if (bpChartInst) { bpChartInst.destroy(); bpChartInst = null; }

  if (!labels.length) return;

  const ctx = $('bp-chart').getContext('2d');
  bpChartInst = new Chart(ctx, {
    type: 'line',
    data: {
      labels: shortLabels,
      datasets: [
        {
          label: 'Systolique',
          data: sysData,
          borderColor: '#E05E44',
          backgroundColor: 'rgba(224,94,68,0.07)',
          borderWidth: 2.5,
          pointRadius: 3,
          pointBackgroundColor: '#E05E44',
          tension: 0.3,
          fill: true,
          spanGaps: true,
        },
        {
          label: 'Diastolique',
          data: diaData,
          borderColor: '#2C7DB5',
          backgroundColor: 'rgba(44,125,181,0.06)',
          borderWidth: 2.5,
          pointRadius: 3,
          pointBackgroundColor: '#2C7DB5',
          tension: 0.3,
          fill: true,
          spanGaps: true,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1A3A5C',
          titleFont: { family: 'Nunito', size: 12 },
          bodyFont:  { family: 'Nunito', size: 12 },
          padding: 10,
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y} mmHg`
          }
        }
      },
      scales: {
        x: {
          ticks: { font: { family: 'Nunito', size: 10 }, maxTicksLimit: 8, color: '#999' },
          grid: { color: 'rgba(0,0,0,0.04)' }
        },
        y: {
          min: 50,
          ticks: { font: { family: 'Nunito', size: 10 }, color: '#999' },
          grid: { color: 'rgba(0,0,0,0.04)' }
        }
      }
    }
  });
}

// ══════════════════════════════════════════════════
//  NOTIFICATIONS / REMINDERS
// ══════════════════════════════════════════════════
function initNotifications() {
  $('btn-enable-notifs').addEventListener('click', async () => {
    if (!('Notification' in window)) {
      showToast('Notifications non supportées', 'error');
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      showToast('Permission refusée', 'error');
      return;
    }
    scheduleNotifications();
    showToast('✓ Rappels activés !', 'success');
  });
}

function scheduleNotifications() {
  const morning = $('reminder-morning').value || '08:00';
  const evening = $('reminder-evening').value || '20:00';
  localStorage.setItem('cl_reminder_morning', morning);
  localStorage.setItem('cl_reminder_evening', evening);

  // Register with SW
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready.then(reg => {
      reg.active && reg.active.postMessage({
        type: 'SET_REMINDERS',
        morning,
        evening,
      });
    });
  }

  // Immediate test via Notification API directly (fallback)
  // The SW handles the actual daily scheduling
}

function loadReminderSettings() {
  const m = localStorage.getItem('cl_reminder_morning');
  const e = localStorage.getItem('cl_reminder_evening');
  if (m) $('reminder-morning').value = m;
  if (e) $('reminder-evening').value = e;
}

// ══════════════════════════════════════════════════
//  EXPORT
// ══════════════════════════════════════════════════
function initExport() {
  $('btn-export-csv').addEventListener('click', exportCSV);
  $('btn-generate-report').addEventListener('click', generateReport);
  $('btn-delete-all').addEventListener('click', async () => {
    if (!confirm('Supprimer TOUTES les mesures ? Cette action est irréversible.')) return;
    try {
      await deleteAllReadings();
      renderHome();
      renderHistory();
      showToast('Toutes les données supprimées', 'info');
    } catch (e) {
      showToast('Erreur : ' + e.message, 'error');
    }
  });
}

function exportCSV() {
  if (!allReadings.length) {
    showToast('Aucune donnée à exporter', 'info');
    return;
  }
  const rows = [
    ['Date', 'Période', 'Mes.1 Sys', 'Mes.1 Dia', 'Mes.1 Pouls', 'Mes.2 Sys', 'Mes.2 Dia', 'Mes.2 Pouls', 'Moy Sys', 'Moy Dia', 'Moy Pouls', 'Catégorie']
  ];
  allReadings.forEach(e => {
    const avg = avgEntry(e);
    const cat = avg ? bpCategory(avg.sys, avg.dia).label.replace(/[^\w\s]/g, '').trim() : '';
    rows.push([
      e.date,
      e.period === 'morning' ? 'Matin' : 'Soir',
      e.r1?.sys || '', e.r1?.dia || '', e.r1?.pulse || '',
      e.r2?.sys || '', e.r2?.dia || '', e.r2?.pulse || '',
      avg?.sys || '', avg?.dia || '', avg?.pulse || '',
      cat,
    ]);
  });
  const csv = rows.map(r => r.join(';')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `cardiolog_${todayISO()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('✓ Export CSV téléchargé', 'success');
}

function generateReport() {
  const rangeDays = parseInt($('report-range').value, 10);
  const cutoffISO = rangeDays
    ? (() => { const d = new Date(); d.setDate(d.getDate() - rangeDays); return d.toISOString().split('T')[0]; })()
    : '0000-00-00';

  const data = allReadings.filter(e => e.date >= cutoffISO);
  if (!data.length) {
    showToast('Aucune donnée sur cette période', 'info');
    return;
  }

  const allFlat = data.flatMap(e => [e.r1, e.r2].filter(Boolean));
  const globalAvg = avgReadings(allFlat);
  const cat = globalAvg ? bpCategory(globalAvg.sys, globalAvg.dia) : null;

  const now = new Date();
  const dateStr = now.toLocaleDateString('fr-BE', { day: 'numeric', month: 'long', year: 'numeric' });

  // Group by date for table
  const byDate = {};
  data.forEach(e => {
    const k = `${e.date}__${e.period}`;
    byDate[k] = e;
  });

  const tableRows = Object.entries(byDate)
    .sort((a,b) => a[0].localeCompare(b[0]))
    .map(([, e]) => {
      const avg = avgEntry(e);
      const c = avg ? bpCategory(avg.sys, avg.dia) : null;
      return `
        <tr>
          <td>${formatDateFR(e.date)}</td>
          <td>${e.period === 'morning' ? '🌅 Matin' : '🌙 Soir'}</td>
          <td>${e.r1?.sys || '–'}/${e.r1?.dia || '–'}</td>
          <td>${e.r1?.pulse || '–'}</td>
          <td>${e.r2?.sys || '–'}/${e.r2?.dia || '–'}</td>
          <td>${e.r2?.pulse || '–'}</td>
          <td><strong>${avg?.sys || '–'}/${avg?.dia || '–'}</strong></td>
          <td style="color:${c?.color || '#999'}">${c?.label || '–'}</td>
        </tr>`;
    }).join('');

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Rapport CardioLog — ${dateStr}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&family=Playfair+Display:wght@600&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Nunito', sans-serif; color: #1E1E1E; background: white; padding: 32px 40px; }
  header { border-bottom: 2px solid #1A3A5C; padding-bottom: 16px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: flex-end; }
  h1 { font-family: 'Playfair Display', serif; font-size: 1.8rem; color: #1A3A5C; }
  .meta { font-size: 0.8rem; color: #999; text-align: right; }
  .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px; }
  .summary-box { border: 1.5px solid #e8e4df; border-radius: 12px; padding: 16px; }
  .summary-box .val { font-size: 2rem; font-weight: 800; color: #1A3A5C; }
  .summary-box .lbl { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: #999; margin-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th { background: #1A3A5C; color: white; padding: 8px 10px; text-align: left; font-weight: 700; font-size: 0.75rem; text-transform: uppercase; letter-spacing: .04em; }
  td { padding: 8px 10px; border-bottom: 1px solid #F0EDE8; }
  tr:nth-child(even) td { background: #faf9f7; }
  footer { margin-top: 20px; font-size: 0.75rem; color: #aaa; text-align: center; }
  @media print { body { padding: 16px 24px; } }
</style>
</head>
<body>
<header>
  <div>
    <h1>Rapport CardioLog</h1>
    <p style="color:#999;font-size:.82rem;margin-top:4px">Suivi de tension artérielle</p>
  </div>
  <div class="meta">
    Généré le ${dateStr}<br>
    Période : ${rangeDays ? `${rangeDays} derniers jours` : 'Tout'}<br>
    ${data.length} session(s) · ${allFlat.length} mesure(s)
  </div>
</header>

${globalAvg ? `
<div class="summary-grid">
  <div class="summary-box">
    <div class="lbl">Moyenne Systolique</div>
    <div class="val">${globalAvg.sys} <span style="font-size:1rem;color:#999">mmHg</span></div>
  </div>
  <div class="summary-box">
    <div class="lbl">Moyenne Diastolique</div>
    <div class="val">${globalAvg.dia} <span style="font-size:1rem;color:#999">mmHg</span></div>
  </div>
  <div class="summary-box">
    <div class="lbl">Catégorie HTA</div>
    <div style="font-size:1rem;font-weight:800;color:${cat?.color};margin-top:8px">${cat?.label}</div>
    ${globalAvg.pulse ? `<div style="font-size:.82rem;color:#555;margin-top:4px">❤️ Pouls moy. ${globalAvg.pulse} bpm</div>` : ''}
  </div>
</div>
` : ''}

<table>
  <thead><tr>
    <th>Date</th><th>Période</th>
    <th>Mesure 1</th><th>Pouls 1</th>
    <th>Mesure 2</th><th>Pouls 2</th>
    <th>Moyenne</th><th>Catégorie</th>
  </tr></thead>
  <tbody>${tableRows}</tbody>
</table>

<footer>CardioLog · Rapport confidentiel · À remettre au cardiologue</footer>
</body>
</html>`;

  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
  setTimeout(() => w.print(), 500);
}

// ══════════════════════════════════════════════════
//  BOTTOM NAV + TAB LISTENERS
// ══════════════════════════════════════════════════
function initNav() {
  $$('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const nav = btn.dataset.nav;
      if (nav === 'record') {
        openRecord(detectPeriod());
      } else {
        showScreen(nav);
      }
    });
  });

  // Avg tabs (history)
  $$('.avg-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.avg-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderAvgBox(tab.dataset.avgType);
    });
  });

  // Chart range selector
  $('chart-range').addEventListener('change', renderChart);
}

// ══════════════════════════════════════════════════
//  BOOT
// ══════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  initAuth();
  initNav();
  initRecordScreen();
  initNotifications();
  initExport();
  loadReminderSettings();
});
