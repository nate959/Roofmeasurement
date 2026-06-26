// ─── State ────────────────────────────────────────────────────────────────────
let map, drawingManager, panorama, svService;
let drawnShapes = [];
let activeTool = 'area';

let settings = {
  priceSquare: 230.00, priceTearOff: 50.00,
  wasteFactor: 10,     pitchMultiplier: 1.118,
  priceRidge: 15.00,   priceValley: 12.00,
  priceDrip: 4.00,     priceStarter: 2.50,
  priceBoot: 35.00,    priceVent: 45.00,
  priceDumpster: 500.00, priceFortified: 0.00
};

// ─── Entry Point (called by Google Maps script) ───────────────────────────────
function initMap() {
  // Hide loader
  document.getElementById('loading').classList.add('hidden');

  // ── Map ──────────────────────────────────────────────────────────────────
  const defaultLoc = { lat: 30.6954, lng: -88.0399 }; // Mobile, AL area default
  map = new google.maps.Map(document.getElementById('map'), {
    center: defaultLoc,
    zoom: 19,
    mapTypeId: 'satellite',
    tilt: 0,
    disableDefaultUI: true,
    zoomControl: true
  });

  // ── Street View ───────────────────────────────────────────────────────────
  svService = new google.maps.StreetViewService();
  panorama = new google.maps.StreetViewPanorama(
    document.getElementById('sv-pano'),
    { position: defaultLoc, pov: { heading: 0, pitch: 0 }, zoom: 1,
      disableDefaultUI: true, zoomControl: true, panControl: true }
  );
  updateStreetView(defaultLoc);

  // ── Address Autocomplete ──────────────────────────────────────────────────
  const pacInput = document.getElementById('pac-input');
  const autocomplete = new google.maps.places.Autocomplete(pacInput, {
    fields: ['geometry', 'formatted_address', 'name']
  });

  // Prevent form submission on Enter
  pacInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') e.preventDefault();
  });

  autocomplete.addListener('place_changed', function() {
    const place = autocomplete.getPlace();
    if (!place || !place.geometry || !place.geometry.location) {
      showToast('Address not found — pick a suggestion from the dropdown.', 'error');
      return;
    }
    if (place.geometry.viewport) {
      map.fitBounds(place.geometry.viewport);
    } else {
      map.setCenter(place.geometry.location);
    }
    map.setZoom(21);
    updateStreetView(place.geometry.location);
    document.getElementById('search-panel').classList.add('hidden');
    pacInput.value = place.formatted_address || place.name || '';
  });

  // ── Drawing Manager ───────────────────────────────────────────────────────
  initDrawingManager();

  // ── Event Listeners ───────────────────────────────────────────────────────
  initEventListeners();

  // ── Load saved pricing ────────────────────────────────────────────────────
  loadSettings();
}

// ─── Drawing Manager ──────────────────────────────────────────────────────────
function initDrawingManager() {
  drawingManager = new google.maps.drawing.DrawingManager({
    drawingMode: null,
    drawingControl: false,
    polygonOptions:  { fillColor: '#22d3ee', fillOpacity: 0.35, strokeWeight: 2, strokeColor: '#06b6d4', clickable: true, editable: true, zIndex: 1 },
    polylineOptions: { strokeColor: '#fbbf24', strokeWeight: 4, editable: true, clickable: true },
    markerOptions:   { draggable: true, clickable: true }
  });
  drawingManager.setMap(map);

  google.maps.event.addListener(drawingManager, 'overlaycomplete', function(e) {
    const shape = e.overlay;
    shape.type = activeTool;

    // Click to delete
    google.maps.event.addListener(shape, 'click', function() {
      if (confirm('Delete this measurement?')) {
        shape.setMap(null);
        drawnShapes = drawnShapes.filter(s => s !== shape);
        calculateTotals();
      }
    });

    // Live recalculate on edit
    if (e.type === google.maps.drawing.OverlayType.POLYGON ||
        e.type === google.maps.drawing.OverlayType.POLYLINE) {
      google.maps.event.addListener(shape.getPath(), 'set_at',    calculateTotals);
      google.maps.event.addListener(shape.getPath(), 'insert_at', calculateTotals);
      if (e.type === google.maps.drawing.OverlayType.POLYGON) {
        google.maps.event.addListener(shape.getPath(), 'remove_at', calculateTotals);
      }
    }

    // Return to pointer after drawing
    drawingManager.setDrawingMode(null);
    setActiveToolBtn(null);
    drawnShapes.push(shape);
    calculateTotals();
  });
}

// ─── Set Drawing Mode ─────────────────────────────────────────────────────────
function setDrawingMode(toolType) {
  activeTool = toolType;
  let mode, polyOptions = {}, mkOptions = {};

  if (toolType === 'area') {
    mode = google.maps.drawing.OverlayType.POLYGON;
    polyOptions = { fillColor: '#22d3ee', fillOpacity: 0.35, strokeWeight: 2, strokeColor: '#06b6d4', editable: true };
  } else if (['ridge', 'valley', 'eave', 'rake'].includes(toolType)) {
    mode = google.maps.drawing.OverlayType.POLYLINE;
    const colors = { ridge: '#fbbf24', valley: '#c026d3', eave: '#3b82f6', rake: '#ef4444' };
    polyOptions = { strokeColor: colors[toolType], strokeWeight: 4, editable: true };
  } else if (toolType === 'boot' || toolType === 'vent') {
    mode = google.maps.drawing.OverlayType.MARKER;
    const iconUrl = toolType === 'boot'
      ? 'https://maps.google.com/mapfiles/ms/icons/blue-dot.png'
      : 'https://maps.google.com/mapfiles/ms/icons/red-dot.png';
    mkOptions = { draggable: true, icon: iconUrl };
  }

  drawingManager.setOptions({
    drawingMode: mode,
    polygonOptions:  polyOptions,
    polylineOptions: polyOptions,
    markerOptions:   mkOptions
  });
}

// ─── Street View ──────────────────────────────────────────────────────────────
function updateStreetView(location) {
  svService.getPanorama({ location: location, radius: 100 }, function(data, status) {
    const pano = document.getElementById('sv-pano');
    const err  = document.getElementById('sv-error');
    if (status === 'OK') {
      err.classList.add('hidden');
      pano.classList.remove('hidden');
      panorama.setPano(data.location.pano);
      const heading = google.maps.geometry.spherical.computeHeading(data.location.latLng, location);
      panorama.setPov({ heading: heading, pitch: 5 });
      panorama.setVisible(true);
    } else {
      err.classList.remove('hidden');
      pano.classList.add('hidden');
    }
  });
}

// ─── Event Listeners ──────────────────────────────────────────────────────────
function initEventListeners() {

  // Drawing tool buttons
  const toolMap = {
    'btn-draw-area':  'area',
    'btn-draw-ridge': 'ridge',
    'btn-draw-valley':'valley',
    'btn-draw-eave':  'eave',
    'btn-draw-rake':  'rake',
    'btn-pin-boot':   'boot',
    'btn-pin-vent':   'vent'
  };
  Object.entries(toolMap).forEach(([id, tool]) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.addEventListener('click', function() {
      setDrawingMode(tool);
      setActiveToolBtn(btn);
    });
  });

  // Search toggle
  const btnSearch = document.getElementById('btn-search');
  if (btnSearch) {
    btnSearch.addEventListener('click', function() {
      const panel = document.getElementById('search-panel');
      panel.classList.toggle('hidden');
      if (!panel.classList.contains('hidden')) {
        document.getElementById('pac-input').focus();
      }
    });
  }

  // Street View toggle
  const btnSV = document.getElementById('btn-toggle-sv');
  if (btnSV) {
    btnSV.addEventListener('click', function() {
      document.getElementById('sv-widget').classList.toggle('hidden');
    });
  }

  // Clear all
  const btnClear = document.getElementById('btn-clear');
  if (btnClear) {
    btnClear.addEventListener('click', function() {
      if (confirm('Clear all drawings and measurements?')) {
        drawnShapes.forEach(s => s.setMap(null));
        drawnShapes = [];
        calculateTotals();
      }
    });
  }

  // Settings toggle
  const btnToggleSettings = document.getElementById('btn-toggle-settings');
  if (btnToggleSettings) {
    btnToggleSettings.addEventListener('click', function() {
      document.getElementById('settings-content').classList.toggle('hidden');
    });
  }

  // Save settings
  const btnSave = document.getElementById('btn-save-settings');
  if (btnSave) btnSave.addEventListener('click', saveSettings);

  // Live recalculate on pricing input change
  const inputIds = [
    'in-shingle-sq','in-tear-sq','in-waste','in-pitch',
    'in-ridge-ft','in-valley-ft','in-drip-ft','in-starter-ft',
    'in-boot-ea','in-vent-ea','in-dumpster','in-fortified'
  ];
  inputIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', calculateTotals);
  });

  // Tab: Estimate Map
  const tabMap = document.getElementById('tab-map');
  const tabChecklist = document.getElementById('tab-checklist');
  const modMap = document.getElementById('module-map');
  const modChecklist = document.getElementById('module-checklist');

  if (tabMap) {
    tabMap.addEventListener('click', function() {
      tabMap.classList.add('active');
      tabChecklist.classList.remove('active');
      modMap.classList.remove('hidden');
      modMap.classList.add('active-module');
      modChecklist.classList.add('hidden');
      modChecklist.classList.remove('active-module');
    });
  }

  // Tab: Fortified Checklist
  if (tabChecklist) {
    tabChecklist.addEventListener('click', function() {
      tabChecklist.classList.add('active');
      tabMap.classList.remove('active');
      modChecklist.classList.remove('hidden');
      modChecklist.classList.add('active-module');
      modMap.classList.add('hidden');
      modMap.classList.remove('active-module');
    });
  }

  // Print / Export buttons (both map and checklist)
  document.querySelectorAll('.btn-print').forEach(function(btn) {
    btn.addEventListener('click', function() {
      const dateEl = document.getElementById('print-date');
      const titleEl = document.getElementById('print-title');
      if (dateEl) dateEl.innerText = new Date().toLocaleDateString();
      if (titleEl) {
        titleEl.innerText = modChecklist && modChecklist.classList.contains('active-module')
          ? 'IBHS FORTIFIED Compliance Checklist'
          : 'Roof Measurement Estimate';
      }
      window.print();
    });
  });

  // Escape cancels drawing
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      drawingManager.setDrawingMode(null);
      setActiveToolBtn(null);
    }
  });
}

// ─── Active Tool Button Highlight ─────────────────────────────────────────────
function setActiveToolBtn(activeBtn) {
  const toolIds = ['btn-draw-area','btn-draw-ridge','btn-draw-valley','btn-draw-eave','btn-draw-rake','btn-pin-boot','btn-pin-vent'];
  toolIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });
  if (activeBtn) activeBtn.classList.add('active');
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function loadSettings() {
  try {
    const saved = localStorage.getItem('eagleEyeProData');
    if (saved) settings = Object.assign({}, settings, JSON.parse(saved));
  } catch(e) {}

  setValue('in-shingle-sq', settings.priceSquare.toFixed(2));
  setValue('in-tear-sq',    settings.priceTearOff.toFixed(2));
  setValue('in-waste',      settings.wasteFactor);
  setValue('in-pitch',      settings.pitchMultiplier);
  setValue('in-ridge-ft',   settings.priceRidge.toFixed(2));
  setValue('in-valley-ft',  settings.priceValley.toFixed(2));
  setValue('in-drip-ft',    settings.priceDrip.toFixed(2));
  setValue('in-starter-ft', settings.priceStarter.toFixed(2));
  setValue('in-boot-ea',    settings.priceBoot.toFixed(2));
  setValue('in-vent-ea',    settings.priceVent.toFixed(2));
  setValue('in-dumpster',   settings.priceDumpster.toFixed(2));
  setValue('in-fortified',  (settings.priceFortified || 0).toFixed(2));

  calculateTotals();
}

function saveSettings() {
  settings.priceSquare    = getVal('in-shingle-sq');
  settings.priceTearOff   = getVal('in-tear-sq');
  settings.wasteFactor    = getVal('in-waste');
  settings.pitchMultiplier= getVal('in-pitch') || 1.0;
  settings.priceRidge     = getVal('in-ridge-ft');
  settings.priceValley    = getVal('in-valley-ft');
  settings.priceDrip      = getVal('in-drip-ft');
  settings.priceStarter   = getVal('in-starter-ft');
  settings.priceBoot      = getVal('in-boot-ea');
  settings.priceVent      = getVal('in-vent-ea');
  settings.priceDumpster  = getVal('in-dumpster');
  settings.priceFortified = getVal('in-fortified');

  localStorage.setItem('eagleEyeProData', JSON.stringify(settings));
  calculateTotals();

  const btn = document.getElementById('btn-save-settings');
  if (btn) {
    const orig = btn.innerText;
    btn.innerText = '✔ Saved!';
    btn.style.background = '#10b981';
    setTimeout(function() { btn.innerText = orig; btn.style.background = ''; }, 1500);
  }
}

// ─── Calculation ──────────────────────────────────────────────────────────────
function calculateTotals() {
  let totals = { area: 0, ridge: 0, valley: 0, eave: 0, rake: 0, boot: 0, vent: 0 };

  drawnShapes.forEach(function(shape) {
    if (!shape.getMap()) return;
    if (shape.type === 'area') {
      totals.area += google.maps.geometry.spherical.computeArea(shape.getPath());
    } else if (['ridge','valley','eave','rake'].includes(shape.type)) {
      totals[shape.type] += google.maps.geometry.spherical.computeLength(shape.getPath());
    } else if (shape.type === 'boot') totals.boot++;
    else if (shape.type === 'vent')   totals.vent++;
  });

  const pitch  = getVal('in-pitch') || 1.0;
  const waste  = getVal('in-waste') || 0;

  const netSqFt    = totals.area * 10.7639 * pitch;
  const netSq      = netSqFt / 100;
  const grossSq    = netSq * (1 + waste / 100);

  const ridgeFt  = totals.ridge  * 3.28084;
  const valleyFt = totals.valley * 3.28084;
  const eaveFt   = totals.eave   * 3.28084;
  const rakeFt   = totals.rake   * 3.28084;
  const dripFt   = eaveFt + rakeFt;

  setText('res-squares', grossSq.toFixed(2));
  setText('res-ridge',   ridgeFt.toFixed(2));
  setText('res-valley',  valleyFt.toFixed(2));
  setText('res-eaves',   eaveFt.toFixed(2));
  setText('res-rakes',   rakeFt.toFixed(2));
  setText('res-boots',   totals.boot);
  setText('res-vents',   totals.vent);

  const costMat     = grossSq  * getVal('in-shingle-sq');
  const costTear    = netSq    * getVal('in-tear-sq');
  const costRidge   = ridgeFt  * getVal('in-ridge-ft');
  const costValley  = valleyFt * getVal('in-valley-ft');
  const costDrip    = dripFt   * getVal('in-drip-ft');
  const costStarter = dripFt   * getVal('in-starter-ft');
  const costBoot    = totals.boot * getVal('in-boot-ea');
  const costVent    = totals.vent * getVal('in-vent-ea');
  const costDump    = getVal('in-dumpster');
  const costFort    = getVal('in-fortified');

  const total = costMat + costTear + costRidge + costValley + costDrip + costStarter + costBoot + costVent + costDump + costFort;
  setText('res-total', '$' + total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getVal(id) {
  const el = document.getElementById(id);
  return el ? (parseFloat(el.value) || 0) : 0;
}
function setValue(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.innerText = val;
}
function showToast(msg, type) {
  const t = document.createElement('div');
  t.style.cssText = `position:fixed;bottom:100px;left:50%;transform:translateX(-50%);
    background:${type==='error'?'#ef4444':'#10b981'};color:#fff;padding:12px 24px;
    border-radius:8px;font-family:Inter,sans-serif;font-weight:600;font-size:14px;
    z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.4);`;
  t.innerText = msg;
  document.body.appendChild(t);
  setTimeout(function() { t.remove(); }, 3500);
}
