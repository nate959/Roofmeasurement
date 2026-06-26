// Core App State
let map;
let drawingManager;
let drawnShapes = [];
let activeTool = 'area'; 
let panorama;
let svService;

// Pricing Settings
let settings = {
  priceSquare: 230.00,
  priceTearOff: 50.00,
  wasteFactor: 10,
  pitchMultiplier: 1.118,
  
  priceRidge: 15.00,
  priceValley: 12.00,
  priceDrip: 4.00,
  priceStarter: 2.50,
  
  priceBoot: 35.00,
  priceVent: 45.00,
  priceDumpster: 500.00,
  priceFortified: 0.00
};

// Tool Buttons
const tools = {
  area: document.getElementById('btn-draw-area'),
  ridge: document.getElementById('btn-draw-ridge'),
  valley: document.getElementById('btn-draw-valley'),
  eave: document.getElementById('btn-draw-eave'),
  rake: document.getElementById('btn-draw-rake'),
  boot: document.getElementById('btn-pin-boot'),
  vent: document.getElementById('btn-pin-vent')
};

// UI Elements
const els = {
  btnClear: document.getElementById('btn-clear'),
  btnToggleSettings: document.getElementById('btn-toggle-settings'),
  settingsContent: document.getElementById('settings-content'),
  btnSaveSettings: document.getElementById('btn-save-settings'),
  
  // Tabs
  tabMap: document.getElementById('tab-map'),
  tabChecklist: document.getElementById('tab-checklist'),
  modMap: document.getElementById('module-map'),
  modChecklist: document.getElementById('module-checklist'),
  
  // Inputs
  inShingleSq: document.getElementById('in-shingle-sq'),
  inTearSq: document.getElementById('in-tear-sq'),
  inWaste: document.getElementById('in-waste'),
  inPitch: document.getElementById('in-pitch'),
  
  inRidgeFt: document.getElementById('in-ridge-ft'),
  inValleyFt: document.getElementById('in-valley-ft'),
  inDripFt: document.getElementById('in-drip-ft'),
  inStarterFt: document.getElementById('in-starter-ft'),
  
  inBootEa: document.getElementById('in-boot-ea'),
  inVentEa: document.getElementById('in-vent-ea'),
  inDumpster: document.getElementById('in-dumpster'),
  inFortified: document.getElementById('in-fortified'),
  
  // Results
  resSquares: document.getElementById('res-squares'),
  resRidge: document.getElementById('res-ridge'),
  resValley: document.getElementById('res-valley'),
  resEaves: document.getElementById('res-eaves'),
  resRakes: document.getElementById('res-rakes'),
  resBoots: document.getElementById('res-boots'),
  resVents: document.getElementById('res-vents'),
  resTotal: document.getElementById('res-total')
};

// Initialize Google Map
function initMap() {
  document.getElementById('loading').classList.add('hidden');

  const defaultLoc = { lat: 39.8283, lng: -98.5795 };
  map = new google.maps.Map(document.getElementById('map'), {
    center: defaultLoc, zoom: 19, mapTypeId: 'satellite', tilt: 0,
    disableDefaultUI: true, zoomControl: true,
  });

  svService = new google.maps.StreetViewService();
  panorama = new google.maps.StreetViewPanorama(document.getElementById('sv-pano'), {
      position: defaultLoc, pov: { heading: 0, pitch: 0 }, zoom: 1,
      disableDefaultUI: true, zoomControl: true, panControl: true
  });
  updateStreetView(defaultLoc);

  const input = document.getElementById('pac-input');
  const searchBox = new google.maps.places.SearchBox(input);
  
  map.addListener('bounds_changed', () => { searchBox.setBounds(map.getBounds()); });
  searchBox.addListener('places_changed', () => {
    const places = searchBox.getPlaces();
    if (places.length == 0) return;
    const bounds = new google.maps.LatLngBounds();
    places.forEach((place) => {
      if (!place.geometry || !place.geometry.location) return;
      if (place.geometry.viewport) bounds.union(place.geometry.viewport);
      else bounds.extend(place.geometry.location);
    });
    map.fitBounds(bounds);
    map.setZoom(21);
    
    // Update Street View Widget
    updateStreetView(places[0].geometry.location);
    
    document.getElementById('search-panel').classList.add('hidden');
  });

  initDrawingManager();
  initEventListeners();
  loadSettings();
}

function initDrawingManager() {
  drawingManager = new google.maps.drawing.DrawingManager({
    drawingMode: google.maps.drawing.OverlayType.POLYGON,
    drawingControl: false,
    polygonOptions: { fillColor: '#22d3ee', fillOpacity: 0.4, strokeWeight: 2, strokeColor: '#06b6d4', clickable: true, editable: true, zIndex: 1 }
  });
  drawingManager.setMap(map);

  google.maps.event.addListener(drawingManager, 'overlaycomplete', function(e) {
    const newShape = e.overlay;
    newShape.type = activeTool; 

    // Interactivity
    google.maps.event.addListener(newShape, 'click', function() {
      if (confirm('Delete this measurement/pin?')) {
        newShape.setMap(null);
        drawnShapes = drawnShapes.filter(s => s !== newShape);
        calculateTotals();
      }
    });

    if (e.type === google.maps.drawing.OverlayType.POLYGON || e.type === google.maps.drawing.OverlayType.POLYLINE) {
        google.maps.event.addListener(newShape.getPath(), 'set_at', calculateTotals);
        google.maps.event.addListener(newShape.getPath(), 'insert_at', calculateTotals);
        if(e.type === google.maps.drawing.OverlayType.POLYGON) {
            google.maps.event.addListener(newShape.getPath(), 'remove_at', calculateTotals);
        }
    }

    drawingManager.setDrawingMode(null); 
    setActiveToolBtn(null);
    drawnShapes.push(newShape);
    calculateTotals();
  });
}

function updateStreetView(location) {
    svService.getPanorama({ location: location, radius: 50 }, (data, status) => {
        if (status === 'OK') {
            document.getElementById('sv-error').classList.add('hidden');
            document.getElementById('sv-pano').classList.remove('hidden');
            panorama.setPano(data.location.pano);
            
            const heading = google.maps.geometry.spherical.computeHeading(data.location.latLng, location);
            panorama.setPov({ heading: heading, pitch: 0 });
            panorama.setVisible(true);
        } else {
            document.getElementById('sv-error').classList.remove('hidden');
            document.getElementById('sv-pano').classList.add('hidden');
        }
    });
}

function setDrawingMode(toolType) {
  activeTool = toolType;
  
  let mode;
  let polyOptions = {};
  let mkOptions = {};

  if (toolType === 'area') {
    mode = google.maps.drawing.OverlayType.POLYGON;
  } else if (['ridge', 'valley', 'eave', 'rake'].includes(toolType)) {
    mode = google.maps.drawing.OverlayType.POLYLINE;
    if(toolType === 'ridge') polyOptions = { strokeColor: '#fbbf24', strokeWeight: 4, editable: true };
    if(toolType === 'valley') polyOptions = { strokeColor: '#c026d3', strokeWeight: 4, editable: true }; // Purple
    if(toolType === 'eave') polyOptions = { strokeColor: '#2563eb', strokeWeight: 4, editable: true }; // Blue
    if(toolType === 'rake') polyOptions = { strokeColor: '#ef4444', strokeWeight: 4, editable: true }; // Red
  } else if (['boot', 'vent'].includes(toolType)) {
    mode = google.maps.drawing.OverlayType.MARKER;
    const iconUrl = toolType === 'boot' ? 'http://maps.google.com/mapfiles/ms/icons/blue-dot.png' : 'http://maps.google.com/mapfiles/ms/icons/red-dot.png';
    mkOptions = { draggable: true, icon: iconUrl };
  }

  drawingManager.setOptions({
    drawingMode: mode,
    polylineOptions: polyOptions,
    markerOptions: mkOptions
  });
}

function initEventListeners() {
  Object.keys(tools).forEach(key => {
    tools[key].addEventListener('click', () => { setDrawingMode(key); setActiveToolBtn(tools[key]); });
  });

  document.getElementById('btn-toggle-sv').addEventListener('click', () => {
    document.getElementById('sv-widget').classList.toggle('hidden');
  });
  
  // Print Event Listener (Multiple Buttons now)
  document.querySelectorAll('.btn-print').forEach(btn => {
      btn.addEventListener('click', () => {
          document.getElementById('print-date').innerText = new Date().toLocaleDateString();
          // Adjust title based on active view
          if(els.modChecklist.classList.contains('active-module')){
              document.getElementById('print-title').innerText = 'Fortified Compliance Checklist';
          } else {
              document.getElementById('print-title').innerText = 'Roof Measurement Estimate';
          }
          window.print();
      });
  });
  
  // Tab Controllers
  els.tabMap.addEventListener('click', () => {
      els.tabMap.classList.add('active');
      els.tabChecklist.classList.remove('active');
      els.modMap.classList.remove('hidden');
      els.modMap.classList.add('active-module');
      els.modChecklist.classList.add('hidden');
      els.modChecklist.classList.remove('active-module');
  });

  els.tabChecklist.addEventListener('click', () => {
      els.tabChecklist.classList.add('active');
      els.tabMap.classList.remove('active');
      els.modChecklist.classList.remove('hidden');
      els.modChecklist.classList.add('active-module');
      els.modMap.classList.add('hidden');
      els.modMap.classList.remove('active-module');
  });
  
  els.btnClear.addEventListener('click', () => {
    if(confirm('Clear all drawings and measurements?')) {
      drawnShapes.forEach(shape => shape.setMap(null));
      drawnShapes = [];
      calculateTotals();
    }
  });

  els.btnToggleSettings.addEventListener('click', () => { els.settingsContent.classList.toggle('hidden'); });
  els.btnSaveSettings.addEventListener('click', saveSettings);

  const inputs = [els.inShingleSq, els.inTearSq, els.inWaste, els.inPitch, els.inRidgeFt, els.inValleyFt, els.inDripFt, els.inStarterFt, els.inBootEa, els.inVentEa, els.inDumpster, els.inFortified];
  inputs.forEach(input => input.addEventListener('change', calculateTotals));

  // Allow pressing Escape to cancel drawing
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      drawingManager.setDrawingMode(null);
      setActiveToolBtn(null);
    }
  });
}

function setActiveToolBtn(activeBtn) {
  Object.values(tools).forEach(btn => btn.classList.remove('active'));
  if(activeBtn) activeBtn.classList.add('active');
}

/* Data Logic */

function loadSettings() {
  const saved = localStorage.getItem('eagleEyeProData');
  if (saved) settings = { ...settings, ...JSON.parse(saved) };
  
  els.inShingleSq.value = settings.priceSquare.toFixed(2);
  els.inTearSq.value = settings.priceTearOff.toFixed(2);
  els.inWaste.value = settings.wasteFactor;
  els.inPitch.value = settings.pitchMultiplier;
  
  els.inRidgeFt.value = settings.priceRidge.toFixed(2);
  els.inValleyFt.value = settings.priceValley.toFixed(2);
  els.inDripFt.value = settings.priceDrip.toFixed(2);
  els.inStarterFt.value = settings.priceStarter.toFixed(2);
  
  els.inBootEa.value = settings.priceBoot.toFixed(2);
  els.inVentEa.value = settings.priceVent.toFixed(2);
  els.inDumpster.value = settings.priceDumpster.toFixed(2);
  els.inFortified.value = (settings.priceFortified || 0).toFixed(2);
  
  calculateTotals();
}

function saveSettings() {
  settings.priceSquare = parseFloat(els.inShingleSq.value) || 0;
  settings.priceTearOff = parseFloat(els.inTearSq.value) || 0;
  settings.wasteFactor = parseFloat(els.inWaste.value) || 0;
  settings.pitchMultiplier = parseFloat(els.inPitch.value) || 1.0;
  
  settings.priceRidge = parseFloat(els.inRidgeFt.value) || 0;
  settings.priceValley = parseFloat(els.inValleyFt.value) || 0;
  settings.priceDrip = parseFloat(els.inDripFt.value) || 0;
  settings.priceStarter = parseFloat(els.inStarterFt.value) || 0;
  
  settings.priceBoot = parseFloat(els.inBootEa.value) || 0;
  settings.priceVent = parseFloat(els.inVentEa.value) || 0;
  settings.priceDumpster = parseFloat(els.inDumpster.value) || 0;
  settings.priceFortified = parseFloat(els.inFortified.value) || 0;
  
  localStorage.setItem('eagleEyeProData', JSON.stringify(settings));
  calculateTotals();
  
  const btn = els.btnSaveSettings;
  const original = btn.innerText;
  btn.innerText = 'Saved!'; btn.style.background = '#10b981';
  setTimeout(() => { btn.innerText = original; btn.style.background = ''; }, 1500);
}

function calculateTotals() {
  let totals = { area: 0, ridge: 0, valley: 0, eave: 0, rake: 0, boot: 0, vent: 0 };

  drawnShapes.forEach(shape => {
    if (!shape.getMap()) return;
    if (shape.type === 'area') totals.area += google.maps.geometry.spherical.computeArea(shape.getPath());
    else if (['ridge', 'valley', 'eave', 'rake'].includes(shape.type)) totals[shape.type] += google.maps.geometry.spherical.computeLength(shape.getPath());
    else if (shape.type === 'boot') totals.boot++;
    else if (shape.type === 'vent') totals.vent++;
  });

  const pPitch = parseFloat(els.inPitch.value) || 1.0;
  const pWaste = parseFloat(els.inWaste.value) || 0;

  const netSqFeet = totals.area * 10.7639 * pPitch;
  const netSquares = netSqFeet / 100;
  const grossSquares = netSquares * (1 + (pWaste / 100));
  
  const ridgeFt = totals.ridge * 3.28084;
  const valleyFt = totals.valley * 3.28084;
  const eaveFt = totals.eave * 3.28084;
  const rakeFt = totals.rake * 3.28084;
  const totalDripFt = eaveFt + rakeFt;

  els.resSquares.innerText = grossSquares.toFixed(2);
  els.resRidge.innerText = ridgeFt.toFixed(2);
  els.resValley.innerText = valleyFt.toFixed(2);
  els.resEaves.innerText = eaveFt.toFixed(2);
  els.resRakes.innerText = rakeFt.toFixed(2);
  els.resBoots.innerText = totals.boot;
  els.resVents.innerText = totals.vent;

  // Costs
  const cShingle = parseFloat(els.inShingleSq.value) || 0;
  const cTear = parseFloat(els.inTearSq.value) || 0;
  const costMaterial = grossSquares * cShingle;
  const costLabor = netSquares * cTear; // Tear off is usually based on Net Size
  
  const costRidge = ridgeFt * (parseFloat(els.inRidgeFt.value) || 0);
  const costValley = valleyFt * (parseFloat(els.inValleyFt.value) || 0);
  
  const cDrip = parseFloat(els.inDripFt.value) || 0;
  const costDrip = totalDripFt * cDrip;
  
  const cStarter = parseFloat(els.inStarterFt.value) || 0;
  const costStarter = totalDripFt * cStarter; 
  
  const costBoot = totals.boot * (parseFloat(els.inBootEa.value) || 0);
  const costVent = totals.vent * (parseFloat(els.inVentEa.value) || 0);
  
  const costDumpster = parseFloat(els.inDumpster.value) || 0;
  const costFortified = parseFloat(els.inFortified.value) || 0;
  
  const grandTotal = costMaterial + costLabor + costRidge + costValley + costDrip + costStarter + costBoot + costVent + costDumpster + costFortified;

  els.resTotal.innerText = '$' + grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
