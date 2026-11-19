if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

let D = { status: {}, changes: [], maps: null };
const FALLBACK_TIPS = {
  overtime: ["Oltre 5 ore di gioco oggi: è il momento giusto per staccare, prendere aria e riposare gli occhi!"],
  tiltMarathon: ["Oltre 20 partite e saldo in rosso: forse è il momento di staccare 10 minuti per resettare!"],
  lowRp: ["Prendi tu il Jumpmaster e scegli rotazioni più intelligenti!"],
  lowKills: ["Resta più vicino ai compagni e gioca dietro alle coperture!"],
  limbo: ["Sessione ancora aperta: servono un paio di partite fatte bene per prendere il largo!"],
  good: ["Buon saldo RP oggi, continua a gestire bene le rotazioni!"],
  dominant: ["Stai dominando la lobby tra RP e kill, continua così!"],
  idle: ["Ancora 0 partite oggi: vediamo come va la prima della sessione!"]
};
let COACH_TIPS = FALLBACK_TIPS;

const FALLBACK_STAT_MAP = {
  'selected_legend': 'Leggenda Selezionata',
  'rank_score': 'Punti Rango (RP)',
  'level': 'Livello Account',
  'kills': 'Uccisioni',
  'damage': 'Danni Inflitti',
  'wins': 'Vittorie'
};
let STAT_MAP = { ...FALLBACK_STAT_MAP };

const ALLOWED_GENERAL = new Set([
  'rank_score', 'level',
  'total.kills', 'total.specialEvent_kills',
  'total.damage', 'total.specialEvent_damage',
  'total.wins', 'total.games_played',
  'total.top_3', 'total.top_5',
  'total.headshots', 'total.finishers',
  'total.revives', 'total.respawns',
  'total.assists', 'total.knockdowns'
]);

const $ = id => document.getElementById(id);
const fmt = t => new Date(t * 1000).toLocaleString('it-IT', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
const fmtTime = t => new Date(t * 1000).toLocaleTimeString('it-IT', {hour:'2-digit',minute:'2-digit'});
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const store = {get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{localStorage.setItem(k,v)}catch(e){}}};

function isCompactChecked(scope) {
  const candidates = scope === 'compare'
    ? ['compare-compact', 'compact-compare', 'compare-compress', 'compress-compare']
    : ['overview-compact', 'compact-overview', 'overview-compress', 'compress-overview'];

  for (const id of candidates) {
    const el = $(id);
    if (el) return !!el.checked;
  }

  const container = $('tab-' + scope);
  if (container) {
    const cb = container.querySelector('input[type="checkbox"][id*="compact"], input[type="checkbox"][id*="compress"], input[type="checkbox"][data-compact]');
    if (cb) return !!cb.checked;
  }
  return false;
}

function createTimeCompressor(allTimestampsSec, enabled) {
  const sorted = [...new Set(allTimestampsSec)].sort((a, b) => a - b);
  const GAP_THRESHOLD = 2700;
  const COMPRESSED_GAP = 1500;

  if (!enabled || sorted.length < 2) {
    return {
      enabled: false,
      toPlotX: tsSec => tsSec * 1000,
      toRealTs: plotX => Math.round(plotX / 1000),
      breaks: []
    };
  }

  const mapped = [sorted[0]];
  const breaks = [];

  for (let i = 1; i < sorted.length; i++) {
    const diff = sorted[i] - sorted[i - 1];
    if (diff > GAP_THRESHOLD) {
      mapped.push(mapped[i - 1] + COMPRESSED_GAP);
      breaks.push((mapped[i - 1] + COMPRESSED_GAP / 2) * 1000);
    } else {
      mapped.push(mapped[i - 1] + diff);
    }
  }

  const toPlotX = (tsSec) => {
    if (tsSec <= sorted[0]) return mapped[0] * 1000;
    const lastIdx = sorted.length - 1;
    if (tsSec >= sorted[lastIdx]) return mapped[lastIdx] * 1000;

    let lo = 0, hi = lastIdx;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] === tsSec) return mapped[mid] * 1000;
      if (sorted[mid] < tsSec) lo = mid + 1;
      else hi = mid - 1;
    }

    const ratio = (tsSec - sorted[hi]) / (sorted[lo] - sorted[hi]);
    return (mapped[hi] + ratio * (mapped[lo] - mapped[hi])) * 1000;
  };

  const toRealTs = (plotX) => {
    const pSec = plotX / 1000;
    if (pSec <= mapped[0]) return sorted[0];
    const lastIdx = mapped.length - 1;
    if (pSec >= mapped[lastIdx]) return sorted[lastIdx];

    let lo = 0, hi = lastIdx;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (mapped[mid] === pSec) return sorted[mid];
      if (mapped[mid] < pSec) lo = mid + 1;
      else hi = mid - 1;
    }

    const ratio = (pSec - mapped[hi]) / (mapped[lo] - mapped[hi]);
    return Math.round(sorted[hi] + ratio * (sorted[lo] - sorted[hi]));
  };

  return { enabled: true, toPlotX, toRealTs, breaks };
}

function getPeriodBounds(period) {
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

  return { cutoff: Math.floor(start.getTime() / 1000), endCutoff };
}

function getDayExtraFlags({ rpD, kD, matchesD, playtimeMin }) {
  const isLowKills = matchesD > 0 && kD < matchesD * 0.6;
  const isOvertime = playtimeMin >= 300;
  const isTiltMarathon =
    (matchesD >= 40 && rpD < 0) ||
    (matchesD >= 30 && rpD <= -50) ||
    (matchesD >= 20 && rpD < -100 && isLowKills);

  return { isOvertime, isTiltMarathon };
}

function evaluateDayCategory({ rpD, kD, matchesD, isOnline }) {
  const isLowKills = matchesD > 0 && kD < matchesD * 0.6;
  const isDominantKills = matchesD > 0 && kD >= matchesD * 0.75;
  const isWarmupOrFlat = (matchesD <= 2 && rpD > -100 && rpD < 120) || (Math.abs(rpD) <= 45);

  if (matchesD === 0) {
    return { cat: 'idle', tag: isOnline ? 'Pre-partita' : 'In attesa (Offline)', cls: 'tip-idle' };
  }
  if (rpD <= -100) {
    return { cat: 'lowRp', tag: `Allarme RP (${rpD})`, cls: 'tip-rp' };
  }
  if (rpD < -45 && isLowKills) {
    return { cat: 'lowKills', tag: `Mira fredda (${kD} kill / ${matchesD} part.)`, cls: 'tip-kills' };
  }
  if (isWarmupOrFlat || rpD <= 45) {
    const rpSign = rpD >= 0 ? '+' : '';
    const tag = rpD < -45
      ? `Kill ok (${kD}/${matchesD}), RP ${rpD}`
      : `In bilico (${rpSign}${rpD} RP · ${matchesD} part.)`;
    return { cat: 'limbo', tag, cls: 'tip-kills' };
  }
  if (rpD >= 100 && isDominantKills) {
    return { cat: 'dominant', tag: `Dominio (+${rpD} RP · ${kD} kill)`, cls: 'tip-good' };
  }
  return { cat: 'good', tag: `In positivo (+${rpD} RP)`, cls: 'tip-good' };
}

function calcPlayerHistoricalBadges(uid) {
  const todayKey = getGamingDayInfo(Math.floor(Date.now() / 1000)).key;
  const daysMap = {};

  buildPlayerSessions(uid).forEach(s => {
    const dayKey = getGamingDayInfo(s.ts).key;
    if (dayKey === todayKey) return;

    if (!daysMap[dayKey]) daysMap[dayKey] = { rpD: 0, kD: 0, matchesD: 0, playtimeMin: 0 };
    daysMap[dayKey].playtimeMin += s.estMinutes;

    if (s.rpDiff !== null) {
      daysMap[dayKey].rpD = Math.round((daysMap[dayKey].rpD + s.rpDiff) * 100) / 100;
      daysMap[dayKey].matchesD += 1;
      daysMap[dayKey].kD += s.kills;
    }
  });

  const counts = { dominant: 0, good: 0, limbo: 0, lowKills: 0, lowRp: 0, tiltMarathon: 0, overtime: 0 };
  Object.values(daysMap).forEach(d => {
    if (d.matchesD === 0) return;
    const flags = getDayExtraFlags(d);
    if (flags.isOvertime) counts.overtime += 1;
    if (flags.isTiltMarathon) counts.tiltMarathon += 1;

    const res = evaluateDayCategory({ ...d, isOnline: false });
    if (counts[res.cat] !== undefined) counts[res.cat] += 1;
  });

  return counts;
}

function pickUniqueTip(cat, usedIndices, offset) {
  const pool = (COACH_TIPS[cat] && COACH_TIPS[cat].length) ? COACH_TIPS[cat] : FALLBACK_TIPS[cat];
  if (!usedIndices[cat]) usedIndices[cat] = new Set();

  let pick = Math.floor(Math.random() * pool.length);
  let tries = 0;
  while (usedIndices[cat].has(pick) && tries < pool.length) {
    pick = (pick + 1 + offset) % pool.length;
    tries++;
  }
  usedIndices[cat].add(pick);
  return pool[pick];
}

function buildSquadTips(squadPlayers) {
  const box = $('squad-tips');
  if (!squadPlayers || !squadPlayers.length) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }

  const usedIndices = {};
  const perfCards = [];
  const extraCards = [];

  squadPlayers.forEach((item, idx) => {
    const name = esc(item.p.name || item.uid);
    const isOnline = item.p && (item.p.is_online || item.p.is_in_game);
    const metrics = {
      rpD: item.rpD,
      kD: item.kD,
      matchesD: item.matchesD,
      playtimeMin: item.playtimeD || 0,
      isOnline
    };

    const { cat, tag, cls } = evaluateDayCategory(metrics);
    const msg = pickUniqueTip(cat, usedIndices, idx);

    perfCards.push(`<div class="tip-box ${cls}">
      <div class="tip-head"><span>&#x1F399;&#xFE0F; Per ${name}</span><span>${esc(tag)}</span></div>
      <div>${esc(msg)}</div>
    </div>`);

    const { isOvertime, isTiltMarathon } = getDayExtraFlags(metrics);
    const rpSign = item.rpD >= 0 ? '+' : '';

    if (isTiltMarathon) {
      const tiltMsg = pickUniqueTip('tiltMarathon', usedIndices, idx);
      extraCards.push(`<div class="tip-box tip-rp">
        <div class="tip-head"><span>&#x1F300; Maratona Tilt &middot; ${name}</span><span>${rpSign}${item.rpD} RP &middot; ${item.matchesD} part.</span></div>
        <div>${esc(tiltMsg)}</div>
      </div>`);
    }

    if (isOvertime) {
      const otMsg = pickUniqueTip('overtime', usedIndices, idx);
      extraCards.push(`<div class="tip-box tip-overtime">
        <div class="tip-head"><span>&#x26A0;&#xFE0F; Oltre 5 ore &middot; ${name}</span><span>${esc(formatDuration(item.playtimeD || 0))} &middot; ${rpSign}${item.rpD} RP</span></div>
        <div>${esc(otMsg)}</div>
      </div>`);
    }
  });

  box.innerHTML = [...perfCards, ...extraCards].join('');
  box.classList.remove('hidden');
}

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
  if (key === 'selected_legend' || typeof diff !== 'number' || Number.isNaN(diff)) return false;
  if (key !== 'rank_score' && diff <= 0) return false;
  if ((key.endsWith('.kills') || key.endsWith('.specialEvent_kills')) && diff > 35) return false;
  if ((key.endsWith('.damage') || key.endsWith('.specialEvent_damage')) && diff > 8000) return false;
  if (key.endsWith('.games_played') && diff > 20) return false;
  return true;
}

function getRealtimeBadge(p) {
  if (!p) return '<span class="dot dot-off"></span>Offline';
  const st = (p.state_text || '').trim();
  const stLower = st.toLowerCase();

  if (p.is_in_game || stLower.includes('match') || stLower.includes('partita') || stLower.includes('game')) {
    return `<span class="dot dot-game"></span>${esc(st || 'In partita')}`;
  }
  if (p.is_online || (st && stLower !== 'offline')) {
    return `<span class="dot dot-lobby"></span>${esc(st || 'In lobby')}`;
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
    const comp = chart.$compressor;
    ctx.save();

    if (comp && comp.enabled && comp.breaks.length) {
      comp.breaks.forEach(bx => {
        const xPos = x.getPixelForValue(bx);
        if (xPos >= left && xPos <= right) {
          ctx.beginPath();
          ctx.setLineDash([2, 4]);
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
          ctx.lineWidth = 1;
          ctx.moveTo(xPos, top);
          ctx.lineTo(xPos, bottom);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      });
    }

    const minRealMs = comp ? comp.toRealTs(x.min) * 1000 : x.min;
    const maxRealMs = comp ? comp.toRealTs(x.max) * 1000 : x.max;
    if (minRealMs && maxRealMs && maxRealMs > minRealMs) {
      const d = new Date(minRealMs);
      d.setHours(4, 0, 0, 0);
      if (d.getTime() < minRealMs) d.setDate(d.getDate() + 1);

      while (d.getTime() <= maxRealMs) {
        const plotVal = comp ? comp.toPlotX(Math.floor(d.getTime() / 1000)) : d.getTime();
        const xPos = x.getPixelForValue(plotVal);
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
let compareDays = 1;
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
    const [dataRes, tipsRes, transRes] = await Promise.all([
      fetch('data.json?t=' + Date.now()),
      fetch('tips.json?t=' + Date.now()).catch(() => null),
      fetch('translations.json?t=' + Date.now()).catch(() => null)
    ]);
    const raw = await dataRes.json();
    if (tipsRes && tipsRes.ok) {
      try {
        COACH_TIPS = await tipsRes.json();
      } catch (e) {
        console.error('Errore JSON in tips.json:', e);
      }
    }
    if (transRes && transRes.ok) {
      try {
        const customTrans = await transRes.json();
        STAT_MAP = { ...FALLBACK_STAT_MAP, ...customTrans };
      } catch (e) {
        console.error('Errore JSON in translations.json:', e);
      }
    }
    D.status = raw.status || {};
    D.changes = (raw.changes || []).filter(c => {
      if (c[2] === 'selected_legend') return typeof c[4] === 'string' && c[4].length > 0;
      return c[3] === null || Math.round(c[3] * 100) !== Math.round(c[4] * 100);
    });
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
  const keys = [...new Set(D.changes.filter(c => c[1] === uid && c[2] !== 'selected_legend').map(c => c[2]))];
  const prev = $('key').value;
  $('key').innerHTML = '';

  const generalKeys = [];
  const legendGroups = {};

  keys.forEach(k => {
    if (k.startsWith('legend.')) {
      const leg = k.split('.')[1];
      if (!legendGroups[leg]) legendGroups[leg] = [];
      legendGroups[leg].push(k);
    } else if (ALLOWED_GENERAL.has(k)) {
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

  const validKeys = [...generalKeys, ...Object.values(legendGroups).flat()];
  const sk = prev || store.get('apex_key');
  $('key').value = validKeys.includes(sk) ? sk : (validKeys.includes('rank_score') ? 'rank_score' : (validKeys[0] || ''));
}

function calcPeriodStats(uid, period) {
  const { cutoff, endCutoff } = getPeriodBounds(period);
  const agg = {};

  D.changes.filter(c => c[1] === uid && c[0] >= cutoff && c[0] < endCutoff && c[3] !== null && c[2] !== 'selected_legend').forEach(r => {
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

function calcRankedCombatStats(uid, period) {
  const { cutoff, endCutoff } = getPeriodBounds(period);
  const rankedSessions = buildPlayerSessions(uid)
    .filter(s => s.ts >= cutoff && s.ts < endCutoff && s.rpDiff !== null);

  return {
    kills: rankedSessions.reduce((acc, s) => acc + s.kills, 0),
    dmg: rankedSessions.reduce((acc, s) => acc + s.dmg, 0),
    matches: rankedSessions.length
  };
}

function calcLegendBreakdown(uid, period) {
  const { cutoff, endCutoff } = getPeriodBounds(period);
  const sessions = buildPlayerSessions(uid).filter(s => s.ts >= cutoff && s.ts < endCutoff);

  const byLegend = {};
  let totalWithLegend = 0;

  sessions.forEach(s => {
    if (!s.legend) return;
    if (!byLegend[s.legend]) {
      byLegend[s.legend] = { matches: 0, ranked: 0, positive: 0 };
    }
    byLegend[s.legend].matches += 1;
    totalWithLegend += 1;

    if (s.rpDiff !== null) {
      byLegend[s.legend].ranked += 1;
      if (s.rpDiff > 0) byLegend[s.legend].positive += 1;
    }
  });

  Object.keys(byLegend).forEach(leg => {
    const item = byLegend[leg];
    item.usagePct = totalWithLegend > 0 ? Math.round((item.matches / totalWithLegend) * 100) : 0;
    item.successPct = item.ranked > 0 ? Math.round((item.positive / item.ranked) * 100) : null;
  });

  return byLegend;
}

function getSegmentStyle(hexColor) {
  const isPause = (ctx) => {
    const t0 = ctx.p0.raw && ctx.p0.raw.realTs != null ? ctx.p0.raw.realTs * 1000 : ctx.p0.parsed.x;
    const t1 = ctx.p1.raw && ctx.p1.raw.realTs != null ? ctx.p1.raw.realTs * 1000 : ctx.p1.parsed.x;
    return Math.abs(t1 - t0) > 2700000;
  };

  return {
    borderColor: (ctx) => {
      if (!isPause(ctx)) return hexColor;
      return hexColor.length === 7 ? hexColor + '78' : hexColor;
    },
    borderWidth: (ctx) => (isPause(ctx) ? 1.8 : 2.5)
  };
}

function renderCompare() {
  const uids = Object.keys(D.status);
  const colors = ['#e0463a', '#3b7be3', '#1ea653', '#d4af37', '#a349e5'];
  const isRelative = $('compare-relative') && $('compare-relative').checked;
  const isCompact = isCompactChecked('compare');
  const minCutoff = compareDays > 0 ? Math.floor(Date.now() / 1000) - compareDays * 86400 : 0;

  const squadPlayers = uids.map((u, origIdx) => {
    const p = D.status[u] || {};
    const rpRows = D.changes.filter(c => c[1] === u && c[2] === 'rank_score');
    const curRp = rpRows.length ? rpRows[rpRows.length - 1][4] : -1;
    const dAgg = calcPeriodStats(u, 'day');
    const rankedCombat = calcRankedCombatStats(u, 'day');
    const rpD = dAgg['rank_score'] ? dAgg['rank_score'].delta : 0;
    const kD = rankedCombat.kills;
    const matchesD = dAgg['rank_score'] ? dAgg['rank_score'].count : 0;
    const playtimeD = calcPlaytimeMinutes(u, 'day');
    return { uid: u, p, curRp, rpD, kD, matchesD, playtimeD, color: colors[origIdx % colors.length] };
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

  const playerRowsMap = {};
  const allFilteredTs = [];

  squadPlayers.forEach(item => {
    const allRp = D.changes.filter(c => c[1] === item.uid && c[2] === 'rank_score');
    let rows = minCutoff ? allRp.filter(c => c[0] >= minCutoff) : allRp;
    if (!rows.length && allRp.length) rows = [allRp[allRp.length - 1]];
    playerRowsMap[item.uid] = rows;
    rows.forEach(r => allFilteredTs.push(r[0]));
  });

  const comp = createTimeCompressor(allFilteredTs, isCompact);

  const datasets = squadPlayers.map(item => {
    const rows = playerRowsMap[item.uid] || [];
    const baseVal = (isRelative && rows.length) ? rows[0][4] : 0;
    const styles = buildPointStyles(rows, item.color);

    return {
      label: item.p.name || item.uid,
      data: rows.map(r => ({
        x: comp.toPlotX(r[0]),
        y: Math.round((r[4] - baseVal) * 100) / 100,
        realTs: r[0]
      })),
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
            title: items => {
              if (!items.length) return '';
              const raw = items[0].raw;
              const ts = raw && raw.realTs != null ? raw.realTs : comp.toRealTs(items[0].parsed.x);
              return fmt(ts);
            },
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
              const d = new Date(comp.toRealTs(v) * 1000);
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
  compareChart.$compressor = comp;
  compareChart.update('none');
}

function renderRecap() {
  const uid = $('player-recap').value;
  const pObj = D.status[uid] || {};
  const p = $('period-recap').value;
  const agg = calcPeriodStats(uid, p);
  const rankedCombat = calcRankedCombatStats(uid, p);
  const legStats = calcLegendBreakdown(uid, p);

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

  const badgeBox = $('recap-badges');
  if (badgeBox) {
    const b = calcPlayerHistoricalBadges(uid);
    const badgeItems = [
      { icon: '👑', label: 'Dominio', val: b.dominant },
      { icon: '📈', label: 'In positivo', val: b.good },
      { icon: '⚖️', label: 'In bilico', val: b.limbo },
      { icon: '🎯', label: 'Mira fredda', val: b.lowKills },
      { icon: '📉', label: 'Allarme RP', val: b.lowRp },
      { icon: '🌀', label: 'Maratona Tilt', val: b.tiltMarathon },
      { icon: '⏳', label: 'Oltre 5h', val: b.overtime }
    ].filter(x => x.val > 0);

    if (badgeItems.length) {
      badgeBox.innerHTML = `
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--mut);margin-bottom:6px">
          Chiusure Giornata Storiche
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${badgeItems.map(x => `<span class="hist-badge">${x.icon} ${x.label}: <b>${x.val}</b></span>`).join('')}
        </div>
      `;
      badgeBox.classList.remove('hidden');
    } else {
      badgeBox.classList.add('hidden');
    }
  }

  const rp = agg['rank_score'] ? agg['rank_score'].delta : 0;
  const rankedMatches = agg['rank_score'] ? agg['rank_score'].count : 0;
  const kills = rankedCombat.kills;
  const dmg = rankedCombat.dmg;
  const playtime = formatDuration(calcPlaytimeMinutes(uid, p));

  $('recap-kpis').innerHTML = `
    <div class="kpi"><div class="kpi-title">Variazione RP</div><div class="kpi-val ${rp>=0?'up':'down'}">${rp>=0?'+':''}${rp}</div></div>
    <div class="kpi"><div class="kpi-title">Uccisioni Ranked</div><div class="kpi-val">${kills}</div></div>
    <div class="kpi"><div class="kpi-title">Danni Ranked</div><div class="kpi-val">${dmg.toLocaleString('it-IT')}</div></div>
    <div class="kpi"><div class="kpi-title">Partite Ranked</div><div class="kpi-val">${rankedMatches}</div></div>
    <div class="kpi"><div class="kpi-title">Tempo Stimato</div><div class="kpi-val">~${playtime}</div></div>
  `;

  const generalKeys = [];
  const legendGroups = {};

  Object.keys(agg).forEach(k => {
    if (k.startsWith('legend.')) {
      const lName = k.split('.')[1];
      if (!legendGroups[lName]) legendGroups[lName] = [];
      legendGroups[lName].push(k);
    } else if (ALLOWED_GENERAL.has(k)) {
      generalKeys.push(k);
    }
  });

  Object.keys(legStats).forEach(lName => {
    if (!legendGroups[lName]) legendGroups[lName] = [];
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
    const st = legStats[lName];
    let metaBadge = '';
    if (st) {
      const usageTxt = `Uso: <b style="color:var(--fg)">${st.usagePct}%</b> (${st.matches})`;
      const succTxt = st.successPct !== null
        ? ` &middot; Successo RP: <b style="color:${st.successPct >= 50 ? 'var(--ok)' : 'var(--bad)'}">${st.successPct}%</b> (${st.positive}/${st.ranked})`
        : '';
      metaBadge = `<span style="float:right;text-transform:none;font-weight:500;color:var(--mut);font-size:11px">${usageTxt}${succTxt}</span>`;
    }

    htmlRows += `<tr class="group-row"><td colspan="4">Leggenda: ${esc(lName)}${metaBadge}</td></tr>`;
    if (legendGroups[lName].length) {
      legendGroups[lName].sort((a, b) => shortStatLabel(a).localeCompare(shortStatLabel(b))).forEach(k => {
        const d = agg[k].delta;
        htmlRows += `<tr><td>${esc(shortStatLabel(k))}</td><td>${agg[k].first}</td><td>${agg[k].last}</td><td class="${d>=0?'up':'down'}">${d>=0?'+':''}${d}</td></tr>`;
      });
    } else {
      htmlRows += `<tr><td colspan="4" class="mut">Nessun tracker specifico avanzato nel periodo</td></tr>`;
    }
  });

  $('recap-table').innerHTML = htmlRows || '<tr><td colspan="4" class="mut">Nessun dato nel periodo.</td></tr>';
}

function renderMatches() {
  const uid = $('player-matches').value;
  const pStatus = D.status[uid] || {};
  const list = buildPlayerSessions(uid).reverse().slice(0, 80);

  if (!list.length) {
    $('matches-list').innerHTML = '<div class="mut">Nessuna partita rilevata ancora.</div>';
    return;
  }

  const dayGroups = [];
  list.forEach(s => {
    const dayInfo = getGamingDayInfo(s.ts);
    let grp = dayGroups[dayGroups.length - 1];
    if (!grp || grp.key !== dayInfo.key) {
      grp = { key: dayInfo.key, label: dayInfo.label, matches: [], totalMin: 0 };
      dayGroups.push(grp);
    }
    grp.matches.push(s);
    grp.totalMin += s.estMinutes;
  });

  $('matches-list').innerHTML = dayGroups.map(grp => {
    const cardsHtml = grp.matches.map(s => {
      let legend = s.legend;
      let isGuessedLegend = false;

      if (!legend && pStatus.selected_legend && pStatus.last_ok && Math.abs(pStatus.last_ok - s.ts) <= 5400) {
        const hasOtherAfter = list.some(other => other.ts > s.ts && other.legend && other.legend !== pStatus.selected_legend);
        if (!hasOtherAfter) {
          legend = pStatus.selected_legend;
          isGuessedLegend = true;
        }
      }

      const legendHtml = legend
        ? `<b${isGuessedLegend ? ' title="Leggenda attiva rilevata in lobby"' : ''}>${esc(legend)} ${s.wins > 0 ? '\uD83C\uDFC6' : ''}</b>`
        : `<span class="mut" style="font-weight:600">Leggenda non disponibile</span> ${s.wins > 0 ? '\uD83C\uDFC6' : ''}`;

      const rpHtml = s.rpDiff !== null
        ? `<span class="badge ${s.rpDiff>=0?'up':'down'}">RP ${s.rpDiff>=0?'+':''}${s.rpDiff}</span>`
        : `<span class="badge mut">RP Non disponibili</span>`;

      return `<div class="match-card">
        <div>
          <div>${legendHtml}</div>
          <div class="time-pill">&#x1F552; ${fmtTime(s.ts)} <span class="mut" style="font-weight:500;margin-left:3px">(~${s.estMinutes}m)</span></div>
        </div>
        <div class="row">${rpHtml}<span>Kill: <b>${s.kills}</b></span><span>Danni: <b>${s.dmg}</b></span></div>
      </div>`;
    }).join('');

    return `
      <div class="day-header">
        <span>${esc(grp.label)}</span>
        <span class="mut" style="text-transform:none;font-weight:500">${grp.matches.length} ${grp.matches.length === 1 ? 'partita' : 'partite'} &middot; ~${formatDuration(grp.totalMin)}</span>
      </div>
      ${cardsHtml}
    `;
  }).join('');
}

function renderOverview() {
  const uid = $('player').value, k = $('key').value;
  const isCompact = isCompactChecked('overview');
  const minCutoff = overviewDays > 0 ? Math.floor(Date.now() / 1000) - overviewDays * 86400 : 0;
  const allRows = D.changes.filter(c => c[1] === uid && c[2] === k);
  const rows = minCutoff ? allRows.filter(c => c[0] >= minCutoff) : allRows;

  const comp = createTimeCompressor(rows.map(r => r[0]), isCompact);
  const lineColor = k === 'rank_score' ? '#d4af37' : '#e0463a';
  const styles = buildPointStyles(rows, lineColor);

  if (chart) chart.destroy();
  chart = new Chart($('chart'), {
    type: 'line',
    data: {
      datasets: [{
        label: labelKey(k),
        data: rows.map(r => ({ x: comp.toPlotX(r[0]), y: r[4], realTs: r[0] })),
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
            title: items => {
              if (!items.length) return '';
              const raw = items[0].raw;
              const ts = raw && raw.realTs != null ? raw.realTs : comp.toRealTs(items[0].parsed.x);
              return fmt(ts);
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
              const d = new Date(comp.toRealTs(v) * 1000);
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
  chart.$compressor = comp;
  chart.update('none');

  const ev = D.changes.filter(c => c[1] === uid).slice(-50).reverse();
  $('events').innerHTML = ev.map(e => {
    if (e[2] === 'selected_legend') {
      return `<tr><td>${fmt(e[0])}</td><td>${esc(labelKey(e[2]))}</td><td>${e[3] ? esc(e[3]) : '\u2014'}</td><td><b>${esc(e[4])}</b></td><td class="mut">\u2014</td></tr>`;
    }
    const d = e[3] == null ? null : e[4] - e[3];
    const c = d == null ? '' : (d > 0 ? 'up' : 'down');
    return `<tr><td>${fmt(e[0])}</td><td>${esc(labelKey(e[2]))}</td><td>${e[3]==null?'\u2014':e[3]}</td><td>${e[4]}</td><td class="${c}">${d==null?'':(d>0?'+':'')+Math.round(d*100)/100}</td></tr>`;
  }).join('');
}

function estimateMinByOutcome(rpDiff, kills) {
  if (rpDiff !== null) {
    if (rpDiff >= 250) return 22;
    if (rpDiff >= 140) return 20;
    if (rpDiff >= 60) return 17;
    if (rpDiff > 0) return 14;
    if (rpDiff >= -15) return 13;
    if (rpDiff >= -35) return 9;
    return 4;
  }
  if (kills >= 3) return 15;
  if (kills >= 1) return 10;
  return 7;
}

function estimateMatchMinutes(curSession, prevSession, rpDiff, kills) {
  let est = estimateMinByOutcome(rpDiff, kills);

  if (prevSession) {
    const gapSec = curSession.ts - prevSession.ts;
    if (gapSec > 0 && gapSec <= 1680) {
      const gapMin = Math.round(gapSec / 60);
      const minFloor = (rpDiff !== null && rpDiff >= 140) ? 18 : 3;
      est = Math.min(23, Math.max(minFloor, gapMin));
    }
  }

  if (rpDiff !== null && rpDiff < -10 && est > 16) {
    est = Math.floor(est / 3);
  }

  return est;
}

function formatDuration(totalMinutes) {
  if (!totalMinutes || totalMinutes <= 0) return '0m';
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

function buildPlayerSessions(uid) {
  const ev = D.changes.filter(c => c[1] === uid && c[3] !== null && c[2] !== 'selected_legend');
  const legendTimeline = D.changes
    .filter(c => c[1] === uid && c[2] === 'selected_legend' && typeof c[4] === 'string' && c[4].length > 0)
    .sort((a, b) => a[0] - b[0]);

  const seenLegends = new Set();
  const sessions = [];

  ev.forEach(c => {
    const k = c[2];
    const isLegendKey = k.startsWith('legend.');
    const legName = isLegendKey ? k.split('.')[1] : null;
    const isFirstTimeLegend = isLegendKey && !seenLegends.has(legName);
    if (isLegendKey) seenLegends.add(legName);

    const last = sessions[sessions.length - 1];
    const hasRpInLast = last && last.items.some(i => i[2] === 'rank_score');
    const lastLegItem = last && last.items.find(i => i[2].startsWith('legend.'));
    const lastLegName = lastLegItem ? lastLegItem[2].split('.')[1] : null;
    const isRpNow = k === 'rank_score';
    const isLegendOrTrackerNow = isLegendKey || k.startsWith('total.');

    let recentLegendSwitch = false;
    let legendSwitchedBetween = false;
    if (legendTimeline.length) {
      recentLegendSwitch = legendTimeline.some(lt => lt[0] <= c[0] && (c[0] - lt[0]) <= 180);
      if (last) {
        legendSwitchedBetween = legendTimeline.some(lt => lt[0] > last.startTs + 15 && lt[0] <= c[0]);
      }
    }

    let maxGap = 480;
    if (hasRpInLast && isRpNow) {
      maxGap = 10;
    } else if (!hasRpInLast && isRpNow) {
      maxGap = 1320;
    } else if (hasRpInLast && !lastLegName && isLegendOrTrackerNow) {
      maxGap = 360;
    } else if (hasRpInLast && lastLegName && isLegendOrTrackerNow) {
      maxGap = 60;
    }

    const sameLegend = !lastLegName || !legName || lastLegName === legName;

    if (last && !legendSwitchedBetween && sameLegend && (c[0] - last.ts) <= maxGap) {
      last.items.push(c);
      if (!(hasRpInLast && !isRpNow && (c[0] - last.ts) > 60)) {
        last.ts = c[0];
      }
    } else {
      sessions.push({
        startTs: c[0],
        ts: c[0],
        items: [c],
        isFirstTimeLegend,
        recentLegendSwitch
      });
    }
  });

  const syncTimestamps = new Set(
    sessions
      .filter(s => s.isFirstTimeLegend && s.recentLegendSwitch && !s.items.some(i => i[2] === 'rank_score'))
      .map(s => s.ts)
  );

  return sessions
    .filter(s => !syncTimestamps.has(s.ts))
    .map((s, idx, validSessions) => {
      let legend = null, rpDiff = null, wins = 0;
      let totalKills = 0, legendKills = 0, totalDmg = 0, legendDmg = 0;

      s.items.forEach(item => {
        const k = item[2], diff = Math.round((item[4] - item[3]) * 100) / 100;
        if (!isValidDelta(k, diff)) return;

        if (k.startsWith('legend.')) legend = k.split('.')[1];
        if (k === 'rank_score') rpDiff = (rpDiff || 0) + diff;
        else if (k === 'total.kills' || k === 'total.specialEvent_kills') totalKills += diff;
        else if (k.endsWith('.kills') || k.endsWith('.specialEvent_kills')) legendKills += diff;
        else if (k === 'total.damage' || k.endsWith('total.specialEvent_damage')) totalDmg += diff;
        else if (k.endsWith('.damage') || k.endsWith('.specialEvent_damage')) legendDmg += diff;
        else if (k.endsWith('.wins') && diff > 0 && diff <= 5) wins = Math.max(wins, diff);
      });

      if (!legend && legendTimeline.length) {
        let activeLeg = null;
        for (let i = 0; i < legendTimeline.length; i++) {
          if (legendTimeline[i][0] <= s.ts + 90) {
            activeLeg = legendTimeline[i][4];
          } else {
            break;
          }
        }
        if (activeLeg) legend = activeLeg;
      }

      const kills = totalKills > 0 ? totalKills : legendKills;
      const dmg = totalDmg > 0 ? totalDmg : legendDmg;
      const prev = idx > 0 ? validSessions[idx - 1] : null;
      const estMinutes = estimateMatchMinutes(s, prev, rpDiff, kills);

      return { ts: s.ts, legend, rpDiff, wins, kills, dmg, estMinutes };
    });
}

function calcPlaytimeMinutes(uid, period) {
  const { cutoff, endCutoff } = getPeriodBounds(period);
  return buildPlayerSessions(uid)
    .filter(s => s.ts >= cutoff && s.ts < endCutoff)
    .reduce((acc, s) => acc + s.estMinutes, 0);
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
