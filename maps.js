window.ApexMaps = (() => {
  const MAP_REGISTRY = [
    {
      id: 'storm_point',
      name: 'Passo della Tempesta',
      label: 'Passo della Tempesta',
      jsonPaths: ['maps/storm_point.json', 'storm_point.json'],
      imgPaths: ['maps/storm_point_map.jpg', 'storm_point_map.jpg']
    },
    {
      id: 'kings_canyon',
      name: 'Canyon dei Re',
      label: 'Canyon dei Re',
      jsonPaths: ['maps/kings_canyon.json', 'kings_canyon.json'],
      imgPaths: ['maps/kings_canyon_map.jpg', 'kings_canyon_map.jpg']
    },
    {
      id: 'olympus',
      name: 'Olympus',
      label: 'Olympus',
      jsonPaths: ['maps/olympus.json', 'olympus.json'],
      imgPaths: ['maps/olympus_map.jpg', 'olympus_map.jpg']
    },
    {
      id: 'e_district',
      name: 'E-District',
      label: 'E-District',
      jsonPaths: ['maps/e_district.json', 'e_district.json'],
      imgPaths: ['maps/e_district_map.jpg', 'e_district_map.jpg']
    },
    {
      id: 'worlds_edge',
      name: 'Confini del Mondo',
      label: 'Confini del Mondo',
      jsonPaths: ['maps/worlds_edge.json', 'worlds_edge.json'],
      imgPaths: ['maps/worlds_edge_map.jpg', 'worlds_edge_map.jpg']
    },
    {
      id: 'broken_moon',
      name: 'Luna Distrutta',
      label: 'Luna Distrutta',
      jsonPaths: ['maps/broken_moon.json', 'broken_moon.json'],
      imgPaths: ['maps/broken_moon_map.jpg', 'broken_moon_map.jpg']
    },
  ];

  function findMapEntry(rawName) {
    if (!rawName) return null;
    const slug = String(rawName)
      .toLowerCase()
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
    const low = String(rawName).toLowerCase();
    return MAP_REGISTRY.find(m =>
      m.id === slug ||
      low.includes(m.name.toLowerCase()) ||
      low.includes(m.id.replace(/_/g, ' '))
    ) || null;
  }

  const LAYER_DEFS = [
    { key: 'pois',             label: 'Zone',        color: '#7dd3fc', defaultOn: true,  group: 'zone' },
    { key: 'verticalZiplines', label: 'Torri di Lancio',     color: '#d42000', defaultOn: true,  group: 'mob'  },
    { key: 'ringConsoles',     label: 'Console Anello',     color: '#8ce2ed', defaultOn: false,  group: 'comp' },
    { key: 'surveyBeacons',    label: 'Trasmettitori di Rilevamento',    color: '#b484e1', defaultOn: false,  group: 'comp' },
    { key: 'respawnBeacons',   label: 'Trasmettitore di Rientro',   color: '#22c55e', defaultOn: true,  group: 'comp' },
    { key: 'replicators',      label: 'Replicatori',       color: '#1678e0', defaultOn: true,  group: 'comp' },
    { key: 'lootBins',         label: 'Capsule Rifornimento',         color: '#cbd5e1', defaultOn: false, group: 'loot' },
    { key: 'arsenal',          label: 'Arsenali',           color: '#f79d5e', defaultOn: false, group: 'loot' },
    { key: 'harvesters',       label: 'Depositi EVO',    color: '#ffee36', defaultOn: false, group: 'loot' },
    { key: 'chargeTowers',     label: 'Torri di Ricarica',     color: '#fabd15', defaultOn: false,  group: 'mob'  },
    { key: 'invalidEndZones',  label: 'Zone di Chiusura Invalide', color: '#dc2626', defaultOn: false, group: 'other' }
    //{ key: 'ziplines',         label: 'Zipline',          color: '#c4b878', defaultOn: false, group: 'mob'  },
    //{ key: 'endLocation',      label: 'End Zones',         color: '#bef264', defaultOn: true,  group: 'comp' },
    //{ key: 'gravityCannons',   label: 'Cannoni Gravitazionali',   color: '#c084fc', defaultOn: true,  group: 'mob'  },
    //{ key: 'skydiveLaunchers', label: 'Palloni', color: '#ec4899', defaultOn: true,  group: 'mob'  },
    //{ key: 'lootHotZones',     label: 'Loot Hot Zones',    color: '#f59e0b', defaultOn: false, group: 'loot' },
  ];

  const STORAGE_KEY = 'apex_map_layers_v1';
  const cache = {};
  let currentMapId = MAP_REGISTRY[0].id;
  let liveRotation = null;
  let initialized = false;
  let selectedPoi = null;

  // Stato viewport (pan & zoom)
  const view = { scale: 1, tx: 0, ty: 0, dragging: false, lastX: 0, lastY: 0, moved: false, pinchDist: 0 };

  // Stato visibilità layer
  let enabledLayers = loadSavedLayers();

  function loadSavedLayers() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    const def = {};
    LAYER_DEFS.forEach(l => { def[l.key] = l.defaultOn; });
    return def;
  }

  function saveLayers() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(enabledLayers)); } catch (e) {}
  }

  async function fetchFirstJson(paths) {
    for (const p of paths) {
      try {
        const res = await fetch(p + '?v=' + Date.now());
        if (res.ok) return await res.json();
      } catch (e) {}
    }
    throw new Error('Impossibile caricare il JSON della mappa');
  }

  function loadFirstImage(paths) {
    return new Promise((resolve, reject) => {
      let idx = 0;
      const tryNext = () => {
        if (idx >= paths.length) return reject(new Error('Impossibile caricare immagine mappa'));
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => { idx++; tryNext(); };
        img.src = paths[idx];
      };
      tryNext();
    });
  }

  function pointInPoly(px, py, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1];
      const xj = poly[j][0], yj = poly[j][1];
      const intersect = ((yi > py) !== (yj > py)) &&
        (px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-9) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function buildPoiIndex(data, imgW, imgH) {
    const layers = data.layers || {};
    const pois = (layers.pois || []).map(p => {
      const polyPx = (p.polygon || []).map(pt => [pt[1] * (imgW / 256), -pt[0] * (imgH / 256)]);
      let sx = 0, sy = 0;
      polyPx.forEach(([x, y]) => { sx += x; sy += y; });
      const cx = polyPx.length ? sx / polyPx.length : 0;
      const cy = polyPx.length ? sy / polyPx.length : 0;

      const countIn = key => (layers[key] || []).filter(item =>
        pointInPoly(item.x * (imgW / 16384), item.y * (imgH / 16384), polyPx)
      ).length;

      return {
        name: p.name,
        polyPx,
        cx,
        cy,
        stats: {
          endLocation: countIn('endLocation'),
          ringConsoles: countIn('ringConsoles'),
          surveyBeacons: countIn('surveyBeacons'),
          respawnBeacons: countIn('respawnBeacons'),
          replicators: countIn('replicators'),
          harvesters: countIn('harvesters'),
          arsenal: countIn('arsenal'),
          lootBins: countIn('lootBins')
        }
      };
    });
    return pois;
  }

  async function ensureMapLoaded(mapId) {
    if (cache[mapId]) return cache[mapId];
    const meta = MAP_REGISTRY.find(m => m.id === mapId) || MAP_REGISTRY[0];
    const [data, img] = await Promise.all([
      fetchFirstJson(meta.jsonPaths),
      loadFirstImage(meta.imgPaths)
    ]);
    const pois = buildPoiIndex(data, img.naturalWidth || 1024, img.naturalHeight || 1024);
    cache[mapId] = { meta, data, img, pois };
    return cache[mapId];
  }

  function buildUI() {
    if (initialized) return;
    const root = document.getElementById('tab-maps');
    if (!root) return;
    initialized = true;

    root.innerHTML = `
      <div class="card" style="padding:12px">
        <div class="row" style="justify-content:space-between;margin-bottom:10px">
          <div class="row" style="flex:1;min-width:180px">
            <select id="map-selector" style="max-width:260px">
              ${MAP_REGISTRY.map(m => `<option value="${m.id}">${m.label}</option>`).join('')}
            </select>
            <span id="map-live-badge" class="badge hidden" style="color:var(--up);border-color:rgba(30,166,83,.45)"></span>
          </div>
          <div class="row" style="gap:4px">
            <button class="refresh-btn range-btn" data-preset="comp">Ranked</button>
            <button class="refresh-btn range-btn" data-preset="loot">Loot</button>
            <button class="refresh-btn range-btn" data-preset="all">Tutto</button>
            <button class="refresh-btn range-btn" data-preset="none">Pulito</button>
          </div>
        </div>

        <div id="map-layer-toggles" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px"></div>

        <div id="map-canvas-wrap" style="position:relative;width:100%;aspect-ratio:1/1;max-height:74vh;background:#0b0d10;border:1px solid var(--bd);border-radius:10px;overflow:hidden;touch-action:none;cursor:grab">
          <canvas id="map-canvas" style="width:100%;height:100%;display:block"></canvas>
          <div style="position:absolute;top:10px;right:10px;display:flex;flex-direction:column;gap:5px;z-index:5">
            <button class="refresh-btn" id="map-zoom-in" style="padding:5px 10px;font-weight:700">+</button>
            <button class="refresh-btn" id="map-zoom-out" style="padding:5px 10px;font-weight:700">&minus;</button>
            <button class="refresh-btn" id="map-zoom-reset" style="padding:5px 8px;font-size:11px">Reset</button>
          </div>
          <div id="map-status-msg" class="mut" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(18,20,24,.75)">Caricamento mappa...</div>
        </div>

        <div id="map-poi-info" class="player-meta hidden" style="margin-top:10px;margin-bottom:0"></div>
      </div>
    `;

    const sel = document.getElementById('map-selector');
    sel.value = currentMapId;
    sel.onchange = () => {
      currentMapId = sel.value;
      selectedPoi = null;
      resetView();
      refreshMapView();
    };

    root.querySelectorAll('[data-preset]').forEach(btn => {
      btn.onclick = () => applyPreset(btn.dataset.preset);
    });

    document.getElementById('map-zoom-in').onclick = () => zoomAt(1.35);
    document.getElementById('map-zoom-out').onclick = () => zoomAt(1 / 1.35);
    document.getElementById('map-zoom-reset').onclick = () => { resetView(); draw(); };

    bindCanvasEvents();
  }

  function applyPreset(preset) {
    LAYER_DEFS.forEach(l => {
      if (preset === 'all') enabledLayers[l.key] = true;
      else if (preset === 'none') enabledLayers[l.key] = (l.key === 'pois');
      else if (preset === 'comp') enabledLayers[l.key] = (l.group === 'zone' || l.group === 'comp' || l.group === 'mob');
      else if (preset === 'loot') enabledLayers[l.key] = (l.group === 'zone' || l.group === 'loot');
    });
    saveLayers();
    renderLayerToggles();
    draw();
  }

  function renderLayerToggles() {
    const box = document.getElementById('map-layer-toggles');
    if (!box) return;
    const entry = cache[currentMapId];
    const layers = entry ? (entry.data.layers || {}) : {};

    box.innerHTML = LAYER_DEFS.map(l => {
      const active = !!enabledLayers[l.key];
      const count = Array.isArray(layers[l.key]) ? layers[l.key].length : 0;
      return `
        <button type="button" data-layer="${l.key}" style="
          display:inline-flex;align-items:center;gap:5px;
          padding:4px 8px;border-radius:7px;font-size:11px;cursor:pointer;
          background:${active ? 'rgba(255,255,255,.07)' : 'var(--bg)'};
          color:${active ? 'var(--fg)' : 'var(--mut)'};
          border:1px solid ${active ? l.color : 'var(--bd)'};
          opacity:${active ? '1' : '0.65'};
        ">
          <span style="width:8px;height:8px;border-radius:50%;background:${l.color};display:inline-block"></span>
          <span>${l.label}</span>
          <span style="opacity:.7">(${count})</span>
        </button>
      `;
    }).join('');

    box.querySelectorAll('[data-layer]').forEach(btn => {
      btn.onclick = () => {
        const k = btn.dataset.layer;
        enabledLayers[k] = !enabledLayers[k];
        saveLayers();
        renderLayerToggles();
        draw();
      };
    });
  }

  function updateLiveBadge() {
    const badge = document.getElementById('map-live-badge');
    if (!badge) return;
    if (!liveRotation || !liveRotation.ranked_current) {
      badge.classList.add('hidden');
      return;
    }
    const activeRanked = findMapEntry(liveRotation.ranked_current);
    if (activeRanked && activeRanked.id === currentMapId) {
      badge.textContent = 'Attiva ora in Ranked';
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }

  function resetView() {
    view.scale = 1;
    view.tx = 0;
    view.ty = 0;
  }

  function clampView(cw, ch) {
    const minTx = cw * (1 - view.scale);
    const minTy = ch * (1 - view.scale);
    view.tx = Math.min(0, Math.max(minTx, view.tx));
    view.ty = Math.min(0, Math.max(minTy, view.ty));
  }

  function zoomAt(factor, cx, cy) {
    const canvas = document.getElementById('map-canvas');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = cx !== undefined ? cx : rect.width / 2;
    const py = cy !== undefined ? cy : rect.height / 2;

    const newScale = Math.min(6, Math.max(1, view.scale * factor));
    const ratio = newScale / view.scale;
    view.tx = px - (px - view.tx) * ratio;
    view.ty = py - (py - view.ty) * ratio;
    view.scale = newScale;
    clampView(rect.width, rect.height);
    draw();
  }

  function handleMapClick(clientX, clientY) {
    const entry = cache[currentMapId];
    const canvas = document.getElementById('map-canvas');
    if (!entry || !canvas) return;

    const rect = canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;

    // Converti coordinate schermo -> coordinate immagine base (1024x1024)
    const imgW = entry.img.naturalWidth || 1024;
    const imgH = entry.img.naturalHeight || 1024;
    const mapX = ((sx - view.tx) / view.scale) * (imgW / rect.width);
    const mapY = ((sy - view.ty) / view.scale) * (imgH / rect.height);

    const hit = entry.pois.find(p => pointInPoly(mapX, mapY, p.polyPx)) || null;
    selectedPoi = hit;
    renderPoiInfo();
    draw();
  }

  function renderPoiInfo() {
    const box = document.getElementById('map-poi-info');
    if (!box) return;
    if (!selectedPoi) {
      box.classList.add('hidden');
      return;
    }
    const s = selectedPoi.stats;
    box.classList.remove('hidden');
    box.innerHTML = `
      <div>
        <div style="font-weight:700;font-size:14px;color:#7dd3fc">${selectedPoi.name}</div>
        <div class="mut">Clicca su un altro POI per ispezionarlo</div>
      </div>
      <div class="row" style="gap:6px;font-size:12px">
        <span class="badge">End Zones: <b>${s.endLocation}</b></span>
        <span class="badge">Ring Console: <b>${s.ringConsoles}</b></span>
        <span class="badge">Survey: <b>${s.surveyBeacons}</b></span>
        <span class="badge">Replicator: <b>${s.replicators}</b></span>
        <span class="badge">EVO: <b>${s.harvesters}</b></span>
        <span class="badge">Loot Bins: <b>${s.lootBins}</b></span>
      </div>
    `;
  }

  function bindCanvasEvents() {
    const canvas = document.getElementById('map-canvas');
    const wrap = document.getElementById('map-canvas-wrap');
    if (!canvas || !wrap) return;

    wrap.addEventListener('wheel', e => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX - rect.left, e.clientY - rect.top);
    }, { passive: false });

    wrap.addEventListener('mousedown', e => {
      if (e.target.tagName === 'BUTTON') return;
      view.dragging = true;
      view.moved = false;
      view.lastX = e.clientX;
      view.lastY = e.clientY;
      wrap.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', e => {
      if (!view.dragging) return;
      const dx = e.clientX - view.lastX;
      const dy = e.clientY - view.lastY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) view.moved = true;
      view.lastX = e.clientX;
      view.lastY = e.clientY;
      const rect = canvas.getBoundingClientRect();
      view.tx += dx;
      view.ty += dy;
      clampView(rect.width, rect.height);
      draw();
    });

    window.addEventListener('mouseup', e => {
      if (!view.dragging) return;
      view.dragging = false;
      wrap.style.cursor = 'grab';
      if (!view.moved) handleMapClick(e.clientX, e.clientY);
    });

    // Touch drag & pinch-to-zoom
    wrap.addEventListener('touchstart', e => {
      if (e.target.tagName === 'BUTTON') return;
      if (e.touches.length === 1) {
        view.dragging = true;
        view.moved = false;
        view.lastX = e.touches[0].clientX;
        view.lastY = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        view.dragging = false;
        view.pinchDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
      }
    }, { passive: true });

    wrap.addEventListener('touchmove', e => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      if (e.touches.length === 1 && view.dragging) {
        const dx = e.touches[0].clientX - view.lastX;
        const dy = e.touches[0].clientY - view.lastY;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) view.moved = true;
        view.lastX = e.touches[0].clientX;
        view.lastY = e.touches[0].clientY;
        view.tx += dx;
        view.ty += dy;
        clampView(rect.width, rect.height);
        draw();
      } else if (e.touches.length === 2 && view.pinchDist > 0) {
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
        const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
        zoomAt(dist / view.pinchDist, cx, cy);
        view.pinchDist = dist;
      }
    }, { passive: false });

    wrap.addEventListener('touchend', e => {
      if (view.dragging && !view.moved && e.changedTouches.length === 1) {
        handleMapClick(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
      }
      if (e.touches.length === 0) {
        view.dragging = false;
        view.pinchDist = 0;
      }
    });

    window.addEventListener('resize', draw);
  }

  function draw() {
    const canvas = document.getElementById('map-canvas');
    const entry = cache[currentMapId];
    if (!canvas || !entry) return;

    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    ctx.save();
    ctx.translate(view.tx, view.ty);
    ctx.scale(view.scale, view.scale);

    const W = rect.width;
    const H = rect.height;
    const imgW = entry.img.naturalWidth || 1024;
    const imgH = entry.img.naturalHeight || 1024;
    const sx = W / 16384;
    const sy = H / 16384;
    const invZ = 1 / Math.sqrt(view.scale); // Mantiene icone leggibili anche zoomando

    ctx.drawImage(entry.img, 0, 0, W, H);
    const layers = entry.data.layers || {};

    // 1. Invalid End Zones
    if (enabledLayers.invalidEndZones) {
      ctx.fillStyle = 'rgba(220, 38, 38, 0.1)';
      ctx.strokeStyle = 'rgba(220, 38, 38, 0.65)';
      ctx.lineWidth = 0.8 * invZ;
      (layers.invalidEndZones || []).forEach(z => {
        ctx.beginPath();
        ctx.arc(z.x * sx, z.y * sy, (z.radius || 100) * sx, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });
    }

    // 2. Loot Hot Zones
    if (enabledLayers.lootHotZones) {
      ctx.fillStyle = 'rgba(245, 158, 11, 0.14)';
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.65)';
      ctx.lineWidth = 1.5 * invZ;
      (layers.lootHotZones || []).forEach(z => {
        ctx.beginPath();
        ctx.arc(z.x * sx, z.y * sy, (z.radius || 600) * sx, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });
    }

    // 3. POI Polygons
    if (enabledLayers.pois) {
      entry.pois.forEach(p => {
        const isSel = selectedPoi && selectedPoi.name === p.name;
        ctx.beginPath();
        p.polyPx.forEach(([px, py], i) => {
          const x = (px / imgW) * W;
          const y = (py / imgH) * H;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.fillStyle = isSel ? 'rgba(56, 189, 248, 0.2)' : 'rgba(56, 189, 248, 0.05)';
        ctx.strokeStyle = isSel ? '#38bdf8' : 'rgba(125, 211, 252, 0.55)';
        ctx.lineWidth = (isSel ? 1.5 : 0.8) * invZ;
        ctx.fill();
        ctx.stroke();
      });
    }

    // 4. Ziplines
    if (enabledLayers.ziplines) {
      ctx.strokeStyle = 'rgba(253, 224, 71, 0.78)';
      ctx.lineWidth = 1.1 * invZ;
      (layers.ziplines || []).forEach(line => {
        if (!Array.isArray(line) || line.length < 2) return;
        ctx.beginPath();
        line.forEach((pt, i) => {
          if (i === 0) ctx.moveTo(pt.x * sx, pt.y * sy);
          else ctx.lineTo(pt.x * sx, pt.y * sy);
        });
        ctx.stroke();
      });
    }

    // 5. Loot Bins
    if (enabledLayers.lootBins) {
      ctx.fillStyle = 'rgba(203, 213, 225, 0.6)';
      const r = 1.4 * invZ;
      (layers.lootBins || []).forEach(b => {
        ctx.beginPath();
        ctx.arc(b.x * sx, b.y * sy, r, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // Helper disegni puntuali
    const drawDots = (items, fill, stroke, radius) => {
      ctx.fillStyle = fill;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 0.8 * invZ;
      const r = radius * invZ;
      (items || []).forEach(it => {
        ctx.beginPath();
        ctx.arc(it.x * sx, it.y * sy, r, 0, Math.PI * 2);
        ctx.fill();
        if (stroke) ctx.stroke();
      });
    };

    if (enabledLayers.harvesters)     drawDots(layers.harvesters,     '#ffee36', '#0f172a', 3.6);
    if (enabledLayers.arsenal)        drawDots(layers.arsenal,        '#f79d5e', '#0f172a', 3.6);
    if (enabledLayers.verticalZiplines) drawDots(layers.verticalZiplines, '#d42000', '#ffffff', 7.0);
    if (enabledLayers.gravityCannons) drawDots(layers.gravityCannons, '#c084fc', '#0f172a', 4.2);
    if (enabledLayers.skydiveLaunchers) drawDots(layers.skydiveLaunchers, '#ec4899', '#ffffff', 5.0);
    if (enabledLayers.replicators)    drawDots(layers.replicators,    '#1678e0', '#0f172a', 4.2);
    if (enabledLayers.respawnBeacons) drawDots(layers.respawnBeacons, '#22c55e', '#0f172a', 4.2);
    if (enabledLayers.surveyBeacons)  drawDots(layers.surveyBeacons,  '#b484e1', '#ffffff', 4.2);
    if (enabledLayers.ringConsoles)   drawDots(layers.ringConsoles,   '#8ce2ed', '#ffffff', 4.2);
    if (enabledLayers.chargeTowers)   drawDots(layers.chargeTowers,   '#fabd15', '#0f172a', 5.8);

    // 6. End Locations (Final Rings)
    if (enabledLayers.endLocation) {
      ctx.fillStyle = 'rgba(163, 230, 53, 0.16)';
      ctx.strokeStyle = 'rgba(190, 242, 100, 0.92)';
      ctx.lineWidth = 1.8 * invZ;
      (layers.endLocation || []).forEach(z => {
        const cx = z.x * sx, cy = z.y * sy;
        ctx.beginPath();
        ctx.arc(cx, cy, (z.radius || 480) * sx, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });
    }

    // 7. Etichette POI
    if (enabledLayers.pois) {
      const fontSize = Math.max(8, Math.round(10.5 * invZ));
      ctx.font = `700 ${fontSize}px system-ui, -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      entry.pois.forEach(p => {
        const cx = (p.cx / imgW) * W;
        const cy = (p.cy / imgH) * H;
        const metrics = ctx.measureText(p.name);
        const padX = 4 * invZ, padY = 2.5 * invZ;
        const bw = metrics.width + padX * 2;
        const bh = fontSize + padY * 2;

        ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
        ctx.fillRect(cx - bw / 2, cy - bh / 2, bw, bh);
        ctx.fillStyle = '#f8fafc';
        ctx.fillText(p.name, cx, cy + 0.5 * invZ);
      });
    }

    ctx.restore();
  }

  async function refreshMapView() {
    buildUI();
    renderLayerToggles();
    updateLiveBadge();
    const msg = document.getElementById('map-status-msg');
    if (msg) {
      msg.textContent = 'Caricamento mappa...';
      msg.classList.remove('hidden');
    }
    try {
      await ensureMapLoaded(currentMapId);
      if (msg) msg.classList.add('hidden');
      renderLayerToggles();
      renderPoiInfo();
      draw();
    } catch (e) {
      if (msg) msg.textContent = 'Asset mappa non trovati (verifica storm_point.json e storm_point_map.jpg)';
    }
  }

  return {
    onMapsLoaded(mapsObj) {
      liveRotation = mapsObj || null;
      if (liveRotation && liveRotation.ranked_current) {
        const match = findMapEntry(liveRotation.ranked_current);
        if (match && !initialized) currentMapId = match.id;
      }
      updateLiveBadge();
    },
    onTabOpened() {
      refreshMapView();
    },
    openMapTab(targetMapName) {
      const target = targetMapName || (liveRotation && liveRotation.ranked_current);
      const match = findMapEntry(target);
      if (match && currentMapId !== match.id) {
        currentMapId = match.id;
        selectedPoi = null;
        resetView();
        const sel = document.getElementById('map-selector');
        if (sel) sel.value = currentMapId;
      }
      const btn = document.querySelector('.tab[data-tab="maps"]');
      if (btn) btn.click();
    }
  };
})();
