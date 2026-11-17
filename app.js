if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

let D = { status: {}, changes: [], maps: null };
const FALLBACK_TIPS = {
  tiltMarathon: ["Oltre 20 partite e saldo in rosso: forse è il momento di staccare 10 minuti per resettare!"],
  lowRp: ["Prendi tu il Jumpmaster e scegli rotazioni più intelligenti!"],
  lowKills: ["Resta più vicino ai compagni e gioca dietro alle coperture!"],
  limbo: ["Sessione ancora aperta: servono un paio di partite fatte bene per prendere il largo!"],
  good: ["Buon saldo RP oggi, continua a gestire bene le rotazioni!"],
  dominant: ["Stai dominando la lobby tra RP e kill, continua così!"],
  idle: ["Ancora 0 partite oggi: vediamo come va la prima della sessione!"]
};
let COACH_TIPS = FALLBACK_TIPS;

const $ = id => document.getElementById(id);
const fmt = t => new Date(t * 1000).toLocaleString('it-IT', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
const fmtTime = t => new Date(t * 1000).toLocaleTimeString('it-IT', {hour:'2-digit',minute:'2-digit'});
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const store = {get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{localStorage.setItem(k,v)}catch(e){}}};

function buildSquadTips(squadPlayers) {
  const box = $('squad-tips');
  if (!squadPlayers || !squadPlayers.length) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }

  const usedIndices = {
    tiltMarathon: new Set(),
    lowRp: new Set(),
    lowKills: new Set(),
    limbo: new Set(),
    good: new Set(),
    dominant: new Set(),
    idle: new Set()
  };

  const cards = squadPlayers.map((item, idx) => {
    const name = esc(item.p.name || item.uid);
    const isOnline = item.p && (item.p.is_online || item.p.is_in_game);
    const isLowKills = item.matchesD > 0 && item.kD < item.matchesD * 0.6;
    const isDominantKills = item.matchesD > 0 && item.kD >= item.matchesD * 0.75;
    const isWarmupOrFlat = (item.matchesD <= 2 && item.rpD > -100 && item.rpD < 120) || (Math.abs(item.rpD) <= 45);
    const isTiltMarathon =
      (item.matchesD >= 40 && item.rpD < 100) ||
      (item.matchesD >= 30 && item.rpD <= -50) ||
      (item.matchesD >= 20 && item.rpD < -100 && isLowKills);

    let cat = 'limbo';
    let tag = 'In bilico';
    let cls = '';

    if (item.matchesD === 0) {
      cat = 'idle';
      tag = isOnline ? 'Pre-partita' : 'In attesa (Offline)';
      cls = 'tip-idle';
    } else if (isTiltMarathon) {
      cat = 'tiltMarathon';
      const rpSign = item.rpD >= 0 ? '+' : '';
      tag = `Maratona Tilt (${rpSign}${item.rpD} RP · ${item.matchesD} part.)`;
      cls = 'tip-rp';
    } else if (item.rpD <= -100) {
      cat = 'lowRp';
      tag = `Allarme RP (${item.rpD})`;
      cls = 'tip-rp';
    } else if (item.rpD < -45 && isLowKills) {
      cat = 'lowKills';
      tag = `Mira fredda (${item.kD} kill / ${item.matchesD} part.)`;
      cls = 'tip-kills';
    } else if (isWarmupOrFlat || item.rpD <= 45) {
      // Copre sia il limbo classico (±45 RP / prime 2 partite) sia chi è tra -99 e -46 RP ma con buone kill
      cat = 'limbo';
      const rpSign = item.rpD >= 0 ? '+' : '';
      tag = item.rpD < -45
        ? `Kill ok (${item.kD}/${item.matchesD}), RP ${item.rpD}`
        : `In bilico (${rpSign}${item.rpD} RP · ${item.matchesD} part.)`;
      cls = 'tip-kills';
    } else if (item.rpD >= 100 && isDominantKills) {
      cat = 'dominant';
      tag = `Dominio (+${item.rpD} RP · ${item.kD} kill)`;
      cls = 'tip-good';
    } else {
      // Qui entra SOLO chi ha effettivamente rpD > 45!
      cat = 'good';
      tag = `In positivo (+${item.rpD} RP)`;
      cls = 'tip-good';
    }

    const pool = (COACH_TIPS[cat] && COACH_TIPS[cat].length) ? COACH_TIPS[cat] : FALLBACK_TIPS[cat];
    let pick = Math.floor(Math.random() * pool.length);
    let tries = 0;
    while (usedIndices[cat].has(pick) && tries < pool.length) {
      pick = (pick + 1 + idx) % pool.length;
      tries++;
    }
    usedIndices[cat].add(pick);

    return `<div class="tip-box ${cls}">
      <div class="tip-head"><span>&#x1F399;&#xFE0F; Per ${name}</span><span>${esc(tag)}</span></div>
      <div>${esc(pool[pick])}</div>
    </div>`;
  }).join('');

  box.innerHTML = cards;
  box.classList.remove('hidden');
}

const STAT_MAP = {
  'rank_score': 'Punti Rango (RP)',
  'level': 'Livello Account',
  'kills': 'Uccisioni',
  'specialEvent_kills': 'Uccisioni Stagionali',
  'damage': 'Danni Inflitti',
  'specialEvent_damage': 'Danni Stagionali',
  'wins': 'Vittorie',
  'games_played': 'Partite Giocate',
  'top_3': 'Top 3',
  'top_5': 'Top 5',
  'headshots': 'Colpi alla Testa',
  'finishers': 'Esecuzioni',
  'revives': 'Rianimazioni',
  'respawns': 'Respawn',
  'assists': 'Assist',
  'knockdowns': 'Atterramenti',
  'sniper_kills': 'Uccisioni Cecchino',
  'care_package_kills': 'Uccisioni Armi Capsula',
  'double_time_distance': 'Distanza Doppio Passo',
  'smoke_grenade_enemies_hit': 'Nemici Colpiti Fumo',
  'phase_walk_time': 'Tempo Fase',
  'rifts_squadmates_phased': 'Alleati nel Portale',
  'enemies_scanned': 'Nemici Scansionati',
  'doc_drone_healing': 'Cure Drone D.O.C.',
  'doc_drone_squadmates_revived': 'Rianimazioni Drone',
  'tactical_shield_applied': 'Scudi Tattici Applicati',
  'passive_savior_boosted_distance_covered': 'Distanza Passiva Salvatrice',
  'teammates_lifted': 'Alleati Sollevati',
  'ultimate_boosted_travel_distance': 'Distanza Palla Demolitrice',
  'tactical_damage_blocked': 'Danni Bloccati Scudo',
  'motherlode_captured': 'Nemici Intrappolati',
  'squadmates_use_jumppad': 'Salti Trampolino',
  'passive_health_regen': 'Salute Rigenerata',
  'tactical_enemy_tethered': 'Nemici Intrappolati'
};

function shortStatLabel(k) {
  if (STAT_MAP[k]) return STAT_MAP[k];
  if (k.startsWith('total.')) {
    const sub = k.slice(6);
    return STAT_MAP[sub] || sub.replace(/_/g, ' ');
  }
  if (k.startsWith('legend.')) {
    const s = k.split('.').slice(2).join('.');
    return STAT_MAP[s] || s.replace(/_/g, ' ');
  }
  return k;
}

function labelKey(k) {
  if (STAT_MAP[k]) return STAT_MAP[k];
  if (k.startsWith('total.')) return 'Generale \u2014 ' + shortStatLabel(k);
  if (k.startsWith('legend.')) {
    const leg = k.split('.')[1];
    return leg + ' \u2014 ' + shortStatLabel(k);
  }
  return k;
}

function isValidDelta(key, diff) {
  if (key !== 'rank_score' && diff <= 0) return false;
  if ((key.endsWith('.kills') || key.endsWith('.specialEvent_kills')) && diff > 35) return false;
  if ((key.endsWith('.damage') || key.endsWith('.specialEvent_damage')) && diff > 8000) return false;
  if (key.endsWith('.games_played') && diff > 20) return false;
  return true;
}

function getRealtimeBadge(p) {
  if (!p) return '<span class="dot dot-off"></span>Offline';
  if (p.is_in_game) {
    const txt = p.state_text ? esc(p.state_text) : 'In partita';
    return `<span class="dot dot-game"></span>${txt}`;
  }
  if (p.is_online) {
    const txt = p.state_text ? esc(p.state_text) : 'In lobby';
    return `<span class="dot dot-lobby"></span>${txt}`;
  }
  return '<span class="dot dot-off"></span>Offline';
}

function getRankVisual(p) {
  const label = p.rank ? esc(p.rank + ' ' + (p.rank_div || '')) : '\u2014';
  if (p.rank_img) {
    return `<img src="${esc(p.rank_img)}" alt="${label}" title="${label}" class="rank-icon">`;
  }
  return label;
}

function getGamingDayInfo(ts) {
  const shifted = new Date((ts - 4 * 3600) * 1000);
  const nowShifted = new Date(Date.now() - 4 * 3600 * 1000);
  const yestShifted = new Date(Date.now() - 28 * 3600 * 1000);

  const key = `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, '0')}-${String(shifted.getDate()).padStart(2, '0')}`;
  const todayKey = `${nowShifted.getFullYear()}-${String(nowShifted.getMonth() + 1).padStart(2, '0')}-${String(nowShifted.getDate()).padStart(2, '0')}`;
  const yestKey = `${yestShifted.getFullYear()}-${String(yestShifted.getMonth() + 1).padStart(2, '0')}-${String(yestShifted.getDate()).padStart(2, '0')}`;

  if (key === todayKey) return { key, label: 'Oggi' };
  if (key === yestKey) return { key, label: 'Ieri' };

  const label = shifted.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
  return { key, label: label.charAt(0).toUpperCase() + label.slice(1) };
}

const RANK_TIERS = [
  { name: 'Bronze IV', rp: 1000, color: '#a66838' },
  { name: 'Silver IV', rp: 3000, color: '#9aa4b0' },
  { name: 'Gold IV', rp: 5400, color: '#d4af37' },
  { name: 'Platinum IV', rp: 8200, color: '#39b8c4' },
  { name: 'Diamond IV', rp: 11400, color: '#3b7be3' },
  { name: 'Master', rp: 15000, color: '#a349e5' }
];

const rankBandsPlugin = {
  id: 'rankBands',
  afterDraw(chart) {
    if ($('key').value !== 'rank_score') return;
    const { ctx, chartArea: { left, right, top, bottom }, scales: { y } } = chart;
    ctx.save();
    RANK_TIERS.forEach(t => {
      const yPos = y.getPixelForValue(t.rp);
      if (yPos >= top && yPos <= bottom) {
        ctx.beginPath();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = t.color + '88';
        ctx.moveTo(left, yPos);
        ctx.lineTo(right, yPos);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = t.color;
        ctx.font = 'bold 11px system-ui';
        ctx.textAlign = 'right';
        ctx.fillText(t.name, right - 4, yPos - 4);
      }
    });
    ctx.restore();
  }
};

function lightenHex(hex, amt = 75) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, (num >> 16) + amt);
  const g = Math.min(255, ((num >> 8) & 0x00FF) + amt);
  const b = Math.min(255, (num & 0x0000FF) + amt);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

const rpGuidesPlugin = {
  id: 'rpGuides',
  afterDatasetsDraw(chart) {
    const { ctx, chartArea: { left, right, top, bottom }, scales: { x, y } } = chart;
    ctx.save();

    const minTs = x.min;
    const maxTs = x.max;
    if (minTs && maxTs && maxTs > minTs) {
      const d = new Date(minTs);
      d.setHours(4, 0, 0, 0);
      if (d.getTime() < minTs) d.setDate(d.getDate() + 1);

      while (d.getTime() <= maxTs) {
        const xPos = x.getPixelForValue(d.getTime());
        if (xPos >= left && xPos <= right) {
          ctx.beginPath();
          ctx.setLineDash([3, 3]);
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
          ctx.lineWidth = 1;
          ctx.moveTo(xPos, top);
          ctx.lineTo(xPos, bottom);
          ctx.stroke();
          ctx.setLineDash([]);

          const dayLabel = d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });
          ctx.fillStyle = '#8f96a3';
          ctx.font = 'bold 10px system-ui';
          ctx.textAlign = 'left';
          ctx.fillText(dayLabel, xPos + 4, top + 11);
        }
        d.setDate(d.getDate() + 1);
      }
    }

    chart.data.datasets.forEach((ds, idx) => {
      const meta = chart.getDatasetMeta(idx);
      if (meta.hidden || !meta.data.length) return;
      const lastEl = meta.data[meta.data.length - 1];
      if (!lastEl) return;

      const baseColor = ds.borderColor || '#ffffff';
      const lightColor = lightenHex(baseColor, 75);
      const xPos = lastEl.x;
      const yPos = lastEl.y;

      if (yPos >= top && yPos <= bottom && xPos >= left && xPos <= right) {
        ctx.beginPath();
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = baseColor + '88';
        ctx.lineWidth = 1.5;
        ctx.moveTo(left, yPos);
        ctx.lineTo(right, yPos);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.beginPath();
        ctx.arc(xPos, yPos, 8, 0, Math.PI * 2);
        ctx.fillStyle = baseColor + '33';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(xPos, yPos, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = lightColor;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = baseColor;
        ctx.stroke();
      }
    });

    ctx.restore();
  }
};

function buildPointStyles(rows, baseColor) {
  const seenDays = new Set();
  const lightColor = lightenHex(baseColor, 75);
  const radii = [];
  const bgColors = [];
  const borderColors = [];

  rows.forEach((r, i) => {
    const dayKey = getGamingDayInfo(r[0]).key;
    const isDayStart = !seenDays.has(dayKey);
    if (isDayStart) seenDays.add(dayKey);

    if (i === rows.length - 1) {
      radii.push(4.5);
      bgColors.push(lightColor);
      borderColors.push(baseColor);
    } else if (isDayStart) {
      radii.push(3.2);
      bgColors.push(baseColor);
      borderColors.push('#121418');
    } else {
      radii.push(1.5);
      bgColors.push(baseColor);
      borderColors.push(baseColor);
    }
  });
  return { radii, bgColors, borderColors };
}

let chart, compareChart;
let activeTab = 'compare';
let compareDays = 2; // Default: ultime 48h nella vista Squadra
let overviewDays = 7;

function setCompareRange(days, btn) {
  compareDays = days;
  document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderCompare();
}

function setOverviewRange(days, btn) {
  overviewDays = days;
  document.querySelectorAll('.ov-range-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderOverview();
}

const mobileZoomOptions = {
  pan: { enabled: true, mode: 'x' },
  zoom: {
    pinch: { enabled: true },
    wheel: { enabled: true },
    mode: 'x'
  }
};

document.querySelectorAll('.tab').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeTab = btn.dataset.tab;
    ['compare', 'recap', 'matches', 'overview'].forEach(t => $('tab-' + t).classList.toggle('hidden', t !== activeTab));
    updateHeaderSub();
    if (activeTab === 'compare') renderCompare();
    if (activeTab === 'overview') renderOverview();
  };
});

async function loadData() {
  try {
    const [dataRes, tipsRes] = await Promise.all([
      fetch('data.json?t=' + Date.now()),
      fetch('tips.json?t=' + Date.now()).catch(() => null)
    ]);
    const raw = await dataRes.json();
    if (tipsRes && tipsRes.ok) {
      try {
        COACH_TIPS = await tipsRes.json();
        console.log('tips.json caricato con successo:', Object.keys(COACH_TIPS));
      } catch (e) {
        console.error('Errore JSON in tips.json:', e);
      }
    } else {
      console.error('Impossibile caricare tips.json:', tipsRes ? tipsRes.status : 'errore di rete');
    }
    D.status = raw.status || {};
    D.changes = (raw.changes || []).filter(c => c[3] === null || Math.round(c[3] * 100) !== Math.round(c[4] * 100));
    D.maps = raw.maps || null;
    renderMaps();
    initSelectors();
    fillKeys();
    renderAll();
  } catch (e) {
    $('sub').textContent = 'In attesa della prima sincronizzazione cloud...';
  }
}

function renderMaps() {
  const bar = $('map-bar');
  if (!D.maps || !D.maps.ranked_current) {
    bar.classList.add('hidden');
    return;
  }
  bar.classList.remove('hidden');
  const endTxt = D.maps.ranked_end ? `fino alle ${fmtTime(D.maps.ranked_end)}` : '';
  const nextTxt = D.maps.ranked_next ? ` \u00b7 Poi: <b>${esc(D.maps.ranked_next)}</b>` : '';
  const pubsTxt = D.maps.pubs_current ? `<span class="mut">Pubbliche: ${esc(D.maps.pubs_current)}</span>` : '';
  bar.innerHTML = `
    <div class="map-pill">&#x1F5FA;&#xFE0F; <span>Ranked: <b>${esc(D.maps.ranked_current)}</b> <span class="mut">(${endTxt})</span>${nextTxt}</span></div>
    ${pubsTxt}
  `;
}

function updateHeaderSub() {
  if (activeTab === 'compare') {
    const times = Object.values(D.status).map(s => s.last_ok).filter(Boolean);
    const last = times.length ? Math.max(...times) : null;
    $('sub').textContent = last ? 'Ultimo aggiornamento squadra: ' + fmt(last) : 'Nessun dato';
  } else {
    const uid = $('player').value;
    const p = D.status[uid] || {};
    $('sub').textContent = (p.name ? p.name + ' \u00b7 ' : '') +
      (p.rank ? p.rank + ' ' + p.rank_div + ' \u00b7 ' : '') +
      (p.level ? 'Lv ' + p.level + ' \u00b7 ' : '') +
      (p.last_ok ? fmt(p.last_ok) : 'Nessun dato');
  }
}

function initSelectors() {
  const uids = Object.keys(D.status);
  ['player', 'player-matches', 'player-recap'].forEach(selId => {
    const el = $(selId);
    const prev = el.value;
    el.innerHTML = '';
    uids.forEach(u => el.add(new Option(D.status[u].name || u, u)));
    const sp = prev || store.get('apex_player');
    if (sp && uids.includes(sp)) el.value = sp;
    el.onchange = () => {
      store.set('apex_player', el.value);
      ['player', 'player-matches', 'player-recap'].forEach(id => $(id).value = el.value);
      fillKeys();
      renderAll();
    };
  });
}

function fillKeys() {
  const uid = $('player').value;
  const keys = [...new Set(D.changes.filter(c => c[1] === uid).map(c => c[2]))];
  const prev = $('key').value;
  $('key').innerHTML = '';

  const generalKeys = [];
  const legendGroups = {};

  keys.forEach(k => {
    if (k.startsWith('legend.')) {
      const leg = k.split('.')[1];
      if (!legendGroups[leg]) legendGroups[leg] = [];
      legendGroups[leg].push(k);
    } else {
      generalKeys.push(k);
    }
  });

  if (generalKeys.length) {
    const grp = document.createElement('optgroup');
    grp.label = 'Statistiche Generali';
    generalKeys.sort((a, b) => shortStatLabel(a).localeCompare(shortStatLabel(b))).forEach(k => {
      grp.appendChild(new Option(shortStatLabel(k), k));
    });
    $('key').appendChild(grp);
  }

  Object.keys(legendGroups).sort().forEach(leg => {
    const grp = document.createElement('optgroup');
    grp.label = 'Leggenda: ' + leg;
    legendGroups[leg].sort((a, b) => shortStatLabel(a).localeCompare(shortStatLabel(b))).forEach(k => {
      grp.appendChild(new Option(shortStatLabel(k), k));
    });
    $('key').appendChild(grp);
  });

  const sk = prev || store.get('apex_key');
  $('key').value = keys.includes(sk) ? sk : (keys.includes('rank_score') ? 'rank_score' : (keys[0] || ''));
}

function calcPeriodStats(uid, period) {
  const shifted = new Date(Date.now() - 4 * 3600 * 1000);
  let start;
  let endCutoff = Infinity;

  if (period === 'day') {
    start = new Date(shifted.getFullYear(), shifted.getMonth(), shifted.getDate(), 4, 0, 0);
  } else if (period === 'yesterday') {
    start = new Date(shifted.getFullYear(), shifted.getMonth(), shifted.getDate() - 1, 4, 0, 0);
    const todayStart = new Date(shifted.getFullYear(), shifted.getMonth(), shifted.getDate(), 4, 0, 0);
    endCutoff = Math.floor(todayStart.getTime() / 1000);
  } else if (period === 'week') {
    const day = shifted.getDay() || 7;
    start = new Date(shifted.getFullYear(), shifted.getMonth(), shifted.getDate() - day + 1, 4, 0, 0);
  } else {
    start = new Date(shifted.getFullYear(), shifted.getMonth(), 1, 4, 0, 0);
  }

  const cutoff = Math.floor(start.getTime() / 1000);
  const agg = {};

  D.changes.filter(c => c[1] === uid && c[0] >= cutoff && c[0] < endCutoff && c[3] !== null).forEach(r => {
    const k = r[2];
    const diff = Math.round((r[4] - r[3]) * 100) / 100;
    if (!isValidDelta(k, diff)) return;

    if (!agg[k]) agg[k] = { first: r[3], last: r[4], delta: 0, count: 0 };
    agg[k].last = r[4];
    agg[k].delta = Math.round((agg[k].delta + diff) * 100) / 100;
    agg[k].count += 1;
  });
  return agg;
}

function getKillsFromAgg(agg) {
  if (agg['total.kills']) return agg['total.kills'].delta;
  if (agg['total.specialEvent_kills']) return agg['total.specialEvent_kills'].delta;
  return Object.keys(agg).filter(k => k.endsWith('.kills')).reduce((a, b) => a + agg[b].delta, 0);
}

function getDamageFromAgg(agg) {
  if (agg['total.damage']) return agg['total.damage'].delta;
  if (agg['total.specialEvent_damage']) return agg['total.specialEvent_damage'].delta;
  return Object.keys(agg).filter(k => k.endsWith('.damage')).reduce((a, b) => a + agg[b].delta, 0);
}

function getSegmentStyle(hexColor) {
  const isPause = (ctx) => {
    const diff = Math.abs(ctx.p1.parsed.x - ctx.p0.parsed.x);
    return diff > 2700000; // 45 minuti in millisecondi
  };

  return {
    borderColor: (ctx) => {
      if (!isPause(ctx)) return hexColor;
      return hexColor.length === 7 ? hexColor + '38' : hexColor; // Colore sbiadito (22% opacità)
    },
    borderDash: (ctx) => (isPause(ctx) ? [4, 4] : undefined), // Linea tratteggiata
    borderWidth: (ctx) => (isPause(ctx) ? 1.5 : 2.5) // Linea più sottile
  };
}

function renderCompare() {
  const uids = Object.keys(D.status);
  const colors = ['#e0463a', '#3b7be3', '#1ea653', '#d4af37', '#a349e5'];
  const isRelative = $('compare-relative') && $('compare-relative').checked;
  const minCutoff = compareDays > 0 ? Math.floor(Date.now() / 1000) - compareDays * 86400 : 0;

  const squadPlayers = uids.map((u, origIdx) => {
    const p = D.status[u] || {};
    const rpRows = D.changes.filter(c => c[1] === u && c[2] === 'rank_score');
    const curRp = rpRows.length ? rpRows[rpRows.length - 1][4] : -1;
    const dAgg = calcPeriodStats(u, 'day');
    const rpD = dAgg['rank_score'] ? dAgg['rank_score'].delta : 0;
    const kD = getKillsFromAgg(dAgg);
    const matchesD = dAgg['rank_score'] ? dAgg['rank_score'].count : 0;
    return { uid: u, p, curRp, rpD, kD, matchesD, color: colors[origIdx % colors.length] };
  }).sort((a, b) => b.curRp - a.curRp);

  $('compare-table').innerHTML = squadPlayers.map(item => `<tr>
    <td>
      <div><b>${esc(item.p.name || item.uid)}</b></div>
      <div class="status-line">${getRealtimeBadge(item.p)}</div>
    </td>
    <td>${getRankVisual(item.p)}</td>
    <td><b>${item.curRp >= 0 ? item.curRp : '\u2014'}</b></td>
    <td class="${item.rpD >= 0 ? 'up' : 'down'}">${item.rpD >= 0 ? '+' : ''}${item.rpD}</td>
    <td>${item.kD}</td>
    <td>${item.matchesD}</td>
  </tr>`).join('');

  buildSquadTips(squadPlayers);

  const datasets = squadPlayers.map(item => {
    const allRp = D.changes.filter(c => c[1] === item.uid && c[2] === 'rank_score');
    let rows = minCutoff ? allRp.filter(c => c[0] >= minCutoff) : allRp;
    if (!rows.length && allRp.length) rows = [allRp[allRp.length - 1]];

    const baseVal = (isRelative && rows.length) ? rows[0][4] : 0;
    const styles = buildPointStyles(rows, item.color);

    return {
      label: item.p.name || item.uid,
      data: rows.map(r => ({ x: r[0] * 1000, y: Math.round((r[4] - baseVal) * 100) / 100 })),
      borderColor: item.color,
      backgroundColor: item.color,
      segment: getSegmentStyle(item.color),
      pointRadius: styles.radii,
      pointBackgroundColor: styles.bgColors,
      pointBorderColor: styles.borderColors,
      pointBorderWidth: 1.5,
      tension: 0.15
    };
  });

  if (compareChart) compareChart.destroy();
  compareChart = new Chart($('chart-compare'), {
    type: 'line',
    data: { datasets },
    plugins: [rpGuidesPlugin],
    options: {
      maintainAspectRatio: false,
      parsing: false,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      plugins: {
        zoom: mobileZoomOptions,
        tooltip: {
          callbacks: {
            title: items => items.length ? fmt(items[0].parsed.x / 1000) : '',
            label: ctx => {
              const v = ctx.parsed.y;
              return ` ${ctx.dataset.label}: ${isRelative && v >= 0 ? '+' : ''}${v} RP`;
            }
          }
        }
      },
      scales: {
        x: {
          type: 'linear',
          ticks: {
            maxTicksLimit: 5,
            maxRotation: 0,
            callback: v => {
              const d = new Date(v);
              return compareDays > 0 && compareDays <= 2
                ? d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
                : d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });
            }
          }
        },
        y: { grace: '8%' }
      }
    }
  });
}

function renderRecap() {
  const uid = $('player-recap').value;
  const pObj = D.status[uid] || {};
  const p = $('period-recap').value;
  const agg = calcPeriodStats(uid, p);

  const pct = pObj.next_level_pct != null ? Number(pObj.next_level_pct) : null;
  const leg = pObj.selected_legend ? esc(pObj.selected_legend) : '\u2014';

  $('recap-meta').innerHTML = `
    <div>
      <div style="font-size:13px;font-weight:600">${getRealtimeBadge(pObj)}</div>
      <div class="mut" style="margin-top:3px">Leggenda selezionata: <b style="color:var(--fg)">${leg}</b></div>
    </div>
    ${pct !== null ? `
    <div class="prog-wrap">
      <div class="row" style="justify-content:space-between;font-size:11px">
        <span class="mut">Livello ${pObj.level || ''}</span>
        <b>${pct}%</b>
      </div>
      <div class="prog-bar"><div class="prog-fill" style="width:${Math.min(100, Math.max(0, pct))}%"></div></div>
    </div>` : ''}
  `;

  const rp = agg['rank_score'] ? agg['rank_score'].delta : 0;
  const rankedMatches = agg['rank_score'] ? agg['rank_score'].count : 0;
  const kills = getKillsFromAgg(agg);
  const dmg = getDamageFromAgg(agg);

  $('recap-kpis').innerHTML = `
    <div class="kpi"><div class="kpi-title">Variazione RP</div><div class="kpi-val ${rp>=0?'up':'down'}">${rp>=0?'+':''}${rp}</div></div>
    <div class="kpi"><div class="kpi-title">Uccisioni</div><div class="kpi-val">${kills}</div></div>
    <div class="kpi"><div class="kpi-title">Danni Inflitti</div><div class="kpi-val">${dmg.toLocaleString('it-IT')}</div></div>
    <div class="kpi"><div class="kpi-title">Partite Ranked</div><div class="kpi-val">${rankedMatches}</div></div>
  `;

  const generalKeys = [];
  const legendGroups = {};

  Object.keys(agg).forEach(k => {
    if (k.startsWith('legend.')) {
      const lName = k.split('.')[1];
      if (!legendGroups[lName]) legendGroups[lName] = [];
      legendGroups[lName].push(k);
    } else {
      generalKeys.push(k);
    }
  });

  let htmlRows = '';

  if (generalKeys.length) {
    htmlRows += `<tr class="group-row"><td colspan="4">Statistiche Generali</td></tr>`;
    generalKeys.sort((a, b) => shortStatLabel(a).localeCompare(shortStatLabel(b))).forEach(k => {
      const d = agg[k].delta;
      htmlRows += `<tr><td>${esc(shortStatLabel(k))}</td><td>${agg[k].first}</td><td>${agg[k].last}</td><td class="${d>=0?'up':'down'}">${d>=0?'+':''}${d}</td></tr>`;
    });
  }

  Object.keys(legendGroups).sort().forEach(lName => {
    htmlRows += `<tr class="group-row"><td colspan="4">Leggenda: ${esc(lName)}</td></tr>`;
    legendGroups[lName].sort((a, b) => shortStatLabel(a).localeCompare(shortStatLabel(b))).forEach(k => {
      const d = agg[k].delta;
      htmlRows += `<tr><td>${esc(shortStatLabel(k))}</td><td>${agg[k].first}</td><td>${agg[k].last}</td><td class="${d>=0?'up':'down'}">${d>=0?'+':''}${d}</td></tr>`;
    });
  });

  $('recap-table').innerHTML = htmlRows || '<tr><td colspan="4" class="mut">Nessun dato nel periodo.</td></tr>';
}

function renderMatches() {
  const uid = $('player-matches').value;
  const ev = D.changes.filter(c => c[1] === uid && c[3] !== null);
  const sessions = [];

  ev.forEach(c => {
    const last = sessions[sessions.length - 1];
    const hasRpInLast = last && last.items.some(i => i[2] === 'rank_score');
    const hasLegendInLast = last && last.items.some(i => i[2].startsWith('legend.'));
    const isRpNow = c[2] === 'rank_score';
    const isLegendNow = c[2].startsWith('legend.');

    // 1. Due variazioni di rank_score separate da almeno 1 minuto sono sempre due partite distinte.
    // 2. Se una partita ha già sia rank_score che leggenda, chiudiamo a 8 minuti (480s) per eventi extra.
    // 3. Se manca ancora rank_score o manca ancora la leggenda, aspettiamo fino a 22 minuti (1320s),
    //    ovvero la durata massima completa di una Ranked inclusi caricamento e premiazione finale.
    let maxGap = 480;
    if (hasRpInLast && isRpNow) {
      maxGap = 60;
    } else if ((!hasRpInLast && isRpNow) || (!hasLegendInLast && isLegendNow)) {
      maxGap = 1320;
    }

    if (last && (c[0] - last.ts) <= maxGap) {
      last.items.push(c);
      last.ts = c[0];
    } else {
      sessions.push({ ts: c[0], items: [c] });
    }
  });

  const list = sessions.reverse().slice(0, 35);
  if (!list.length) {
    $('matches-list').innerHTML = '<div class="mut">Nessuna partita rilevata ancora.</div>';
    return;
  }

  const dayGroups = [];
  list.forEach(s => {
    const dayInfo = getGamingDayInfo(s.ts);
    let grp = dayGroups[dayGroups.length - 1];
    if (!grp || grp.key !== dayInfo.key) {
      grp = { key: dayInfo.key, label: dayInfo.label, matches: [] };
      dayGroups.push(grp);
    }
    grp.matches.push(s);
  });

  $('matches-list').innerHTML = dayGroups.map(grp => {
    const cardsHtml = grp.matches.map(s => {
      let legend = null, rpDiff = null, wins = 0;
      let totalKills = 0, legendKills = 0, totalDmg = 0, legendDmg = 0;

      s.items.forEach(item => {
        const k = item[2], diff = Math.round((item[4] - item[3]) * 100) / 100;
        if (!isValidDelta(k, diff)) return;

        if (k.startsWith('legend.')) legend = k.split('.')[1];
        if (k === 'rank_score') rpDiff = (rpDiff || 0) + diff;
        else if (k === 'total.kills' || k === 'total.specialEvent_kills') totalKills += diff;
        else if (k.endsWith('.kills') || k.endsWith('.specialEvent_kills')) legendKills += diff;
        else if (k === 'total.damage' || k === 'total.specialEvent_damage') totalDmg += diff;
        else if (k.endsWith('.damage') || k.endsWith('.specialEvent_damage')) legendDmg += diff;
        else if (k.endsWith('.wins') && diff > 0 && diff <= 5) wins = Math.max(wins, diff);
      });

      const kills = totalKills > 0 ? totalKills : legendKills;
      const dmg = totalDmg > 0 ? totalDmg : legendDmg;

      const legendHtml = legend
        ? `<b>${esc(legend)} ${wins > 0 ? '\uD83C\uDFC6' : ''}</b>`
        : `<span class="mut" style="font-weight:600">Leggenda non disponibile</span> ${wins > 0 ? '\uD83C\uDFC6' : ''}`;

      const rpHtml = rpDiff !== null
        ? `<span class="badge ${rpDiff>=0?'up':'down'}">RP ${rpDiff>=0?'+':''}${rpDiff}</span>`
        : `<span class="badge mut">RP Non disponibili</span>`;

      return `<div class="match-card">
        <div>
          <div>${legendHtml}</div>
          <div class="time-pill">&#x1F552; ${fmtTime(s.ts)}</div>
        </div>
        <div class="row">${rpHtml}<span>Kill: <b>${kills}</b></span><span>Danni: <b>${dmg}</b></span></div>
      </div>`;
    }).join('');

    return `
      <div class="day-header">
        <span>${esc(grp.label)}</span>
        <span class="mut" style="text-transform:none;font-weight:500">${grp.matches.length} ${grp.matches.length === 1 ? 'partita' : 'partite'}</span>
      </div>
      ${cardsHtml}
    `;
  }).join('');
}

function renderOverview() {
  const uid = $('player').value, k = $('key').value;
  const minCutoff = overviewDays > 0 ? Math.floor(Date.now() / 1000) - overviewDays * 86400 : 0;
  const allRows = D.changes.filter(c => c[1] === uid && c[2] === k);
  const rows = minCutoff ? allRows.filter(c => c[0] >= minCutoff) : allRows;

  const lineColor = k === 'rank_score' ? '#d4af37' : '#e0463a';
  const styles = buildPointStyles(rows, lineColor);

  if (chart) chart.destroy();
  chart = new Chart($('chart'), {
    type: 'line',
    data: {
      datasets: [{
        label: labelKey(k),
        data: rows.map(r => ({ x: r[0] * 1000, y: r[4] })),
        tension: 0.15,
        pointRadius: styles.radii,
        pointBackgroundColor: styles.bgColors,
        pointBorderColor: styles.borderColors,
        pointBorderWidth: 1.5,
        borderWidth: 2,
        borderColor: lineColor,
        backgroundColor: 'rgba(224,70,58,0.1)',
        fill: true
      }]
    },
    plugins: [rankBandsPlugin, rpGuidesPlugin],
    options: {
      maintainAspectRatio: false,
      parsing: false,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      plugins: {
        zoom: mobileZoomOptions,
        tooltip: {
          callbacks: {
            title: items => items.length ? fmt(items[0].parsed.x / 1000) : ''
          }
        }
      },
      scales: {
        x: {
          type: 'linear',
          ticks: {
            maxTicksLimit: 5,
            maxRotation: 0,
            callback: v => {
              const d = new Date(v);
              return overviewDays > 0 && overviewDays <= 2
                ? d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
                : d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });
            }
          }
        },
        y: { grace: '10%' }
      }
    }
  });

  const ev = D.changes.filter(c => c[1] === uid).slice(-50).reverse();
  $('events').innerHTML = ev.map(e => {
    const d = e[3] == null ? null : e[4] - e[3];
    const c = d == null ? '' : (d > 0 ? 'up' : 'down');
    return `<tr><td>${fmt(e[0])}</td><td>${esc(labelKey(e[2]))}</td><td>${e[3]==null?'\u2014':e[3]}</td><td>${e[4]}</td><td class="${c}">${d==null?'':(d>0?'+':'')+Math.round(d*100)/100}</td></tr>`;
  }).join('');
}

function renderAll() {
  updateHeaderSub();
  renderCompare();
  renderRecap();
  renderMatches();
  renderOverview();
}

$('key').onchange = () => { store.set('apex_key', $('key').value); renderOverview(); };
$('period-recap').onchange = renderRecap;
loadData();
