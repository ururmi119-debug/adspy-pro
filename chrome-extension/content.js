// AdRadar v5.2.0 - Full toolbar redesign: Scan/Filter/Compete/Large/Export/Gallery/Live/Auto + category & model chips
var API_BASE = 'https://adspy-pro-vc7w.onrender.com';

var ADSPY = {
  total:0, hot:0, winning:0, pod:0,
  phaseCounts:{Testing:0,Validating:0,Winning:0,Scaling:0,'Cash Cow':0,HOT:0,Legend:0},
  modelCounts:{Dropship:0,POD:0,Jewelry:0,Digital:0,Amazon:0,'Sub Box':0},
  shopifyCount:0, multiCount:0
};
var ADSPY_UI = { scanning:true, filterOn:true, competeOn:false, largeOn:false, galleryOn:false, liveOn:true, autoScrollOn:false, category:'All', model:null };
var processed = [];
var scanIntervalRef=null, mutationObsRef=null, autoScrollIntervalRef=null, syncIntervalRef=null, scanTimeout=null;

function calcScore(days, dups, countries) {
  var s = 0;
  if(days>=181)s+=30;else if(days>=91)s+=25;else if(days>=31)s+=20;else if(days>=11)s+=15;else if(days>=4)s+=10;else s+=5;
  if(dups>=30)s+=30;else if(dups>=11)s+=20;else if(dups>=4)s+=10;else if(dups>=2)s+=5;
  if(countries>=15)s+=30;else if(countries>=6)s+=20;else if(countries>=2)s+=10;
  if(days>=90)s+=30;else if(days>=60)s+=20;else if(days>=30)s+=10;
  return s;
}

function getPhase(days, dups, countries, score) {
  if(days<=14 && dups>=10 && countries>=3) return 'HOT';
  if(days>180 && score>150) return 'Legend';
  if(days>90 && score>110) return 'Cash Cow';
  if(score>=70 && (countries>3 || dups>5)) return 'Scaling';
  if(score>=40 && days>=11) return 'Winning';
  if(score>=20 && days<=10) return 'Validating';
  return 'Testing';
}

function getModel(text) {
  var t = (text||'').toLowerCase();
  var scores = {
    POD: ['print','custom','islamic','muslim','motivational','teacher','nurse','tshirt','hoodie','mug','poster','shirt','hijab','quran','mom','dad','dog','cat','faith','personalized','quote'].filter(function(k){return t.indexOf(k)>=0;}).length,
    Dropship: ['free shipping','order now','buy now','ships from','limited stock'].filter(function(k){return t.indexOf(k)>=0;}).length * 2,
    Jewelry: ['necklace','ring','bracelet','jewelry','pendant','gold','silver','diamond'].filter(function(k){return t.indexOf(k)>=0;}).length * 2,
    Digital: ['download','ebook','course','digital','template','canva','preset'].filter(function(k){return t.indexOf(k)>=0;}).length * 2,
    Amazon: ['amazon','prime','asin'].filter(function(k){return t.indexOf(k)>=0;}).length * 5,
    'Sub Box': ['subscribe','subscription','monthly box','box club'].filter(function(k){return t.indexOf(k)>=0;}).length * 3
  };
  var best = 'POD'; var bestScore = 0;
  for(var m in scores) { if(scores[m] > bestScore) { bestScore = scores[m]; best = m; } }
  return best;
}

function getColor(phase) {
  var c = {All:'#e2e8f0',HOT:'#ef4444',Legend:'#fbbf24','Cash Cow':'#f59e0b',Scaling:'#3b82f6',Winning:'#22c55e',Validating:'#8b5cf6',Testing:'#64748b',Shopify:'#95bf47',Multi:'#06b6d4'};
  return c[phase] || '#64748b';
}

function getEmoji(phase) {
  var e = {HOT:'🔥',Legend:'👑','Cash Cow':'💰',Scaling:'🚀',Winning:'✅',Validating:'🔬',Testing:'🧪'};
  return e[phase] || '📊';
}

function getModelIcon(model) {
  var m = {Dropship:'📦',POD:'🎁',Jewelry:'💎',Digital:'⚡',Amazon:'🛒','Sub Box':'📬'};
  return m[model] || '📦';
}

function isShopifyUrl(url) {
  if(!url) return false;
  var u = url.toLowerCase();
  return u.indexOf('myshopify.com')>=0 || u.indexOf('.com/products')>=0 || u.indexOf('.com/collections')>=0;
}

function isMultiVersion(text) {
  return /multiple versions/i.test(text||'');
}

function parseDays(text) {
  var m = text.match(/Started running on ([A-Za-z]+ \d{1,2},?\s*\d{4})/);
  if(m) {
    try {
      var d = new Date(m[1]);
      if(!isNaN(d.getTime())) {
        var days = Math.floor((Date.now() - d.getTime()) / 86400000);
        if(days >= 0 && days < 3650) return days;
      }
    } catch(e) {}
  }
  return -1;
}

function parseLandingUrl(card) {
  try {
    var links = card.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute('href') || '';
      if (href.indexOf('l.facebook.com') >= 0) {
        var m = href.match(/u=([^&]+)/);
        if (m) {
          var decoded = decodeURIComponent(m[1]);
          return decoded.replace(/^https?:\/\//, '').split('?')[0];
        }
      } else if (href && href.indexOf('facebook.com') < 0 && href.indexOf('fbcdn') < 0) {
        return href.replace(/^https?:\/\//, '').split('?')[0];
      }
    }
  } catch(e) {}
  return '';
}

function parseThumbnail(card) {
  try {
    var imgs = card.querySelectorAll('img');
    var best = null, bestArea = 0;
    for (var i = 0; i < imgs.length; i++) {
      var im = imgs[i];
      var w = im.naturalWidth || im.width || 0;
      var h = im.naturalHeight || im.height || 0;
      var area = w * h;
      if (area > bestArea) { bestArea = area; best = im; }
    }
    if (best && best.src && bestArea > 0) return best.src;
    if (imgs.length && imgs[0].src) return imgs[0].src;
    var video = card.querySelector('video');
    if (video && video.poster) return video.poster;
  } catch(e) {}
  return '';
}

function parsePageName(card, fallbackText) {
  try {
    var candidates = card.querySelectorAll('span, strong, a');
    for (var i = 0; i < candidates.length; i++) {
      var t = (candidates[i].innerText || '').trim();
      if (t.length >= 2 && t.length <= 60 &&
          t.indexOf('Started running') < 0 &&
          t.indexOf('Library ID') < 0 &&
          !/^\d+$/.test(t)) {
        return t;
      }
    }
  } catch(e) {}
  return (fallbackText || 'Unknown Page').slice(0, 60);
}

function makeBadge(phase, model, conf, days) {
  var color = getColor(phase);
  var emoji = getEmoji(phase);
  var daysText = days >= 0 ? ' · ' + days + 'd' : '';
  return '<div class="adspy-badge-v2" style="position:absolute;top:6px;left:6px;z-index:9999;background:rgba(8,10,18,0.95);border:1px solid ' + color + '55;border-radius:8px;padding:6px 9px;min-width:120px;font-family:Arial,sans-serif;pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,0.6);transform-origin:top left;">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">' +
    '<span style="background:' + color + '22;color:' + color + ';border:1px solid ' + color + '44;padding:2px 7px;border-radius:4px;font-size:10px;font-weight:800;text-transform:uppercase;">' + emoji + ' ' + phase + '</span>' +
    '<span style="font-size:9px;color:#64748b;margin-left:6px;">' + conf + '%</span>' +
    '</div>' +
    '<div style="font-size:9px;background:rgba(255,255,255,0.07);color:#94a3b8;padding:1px 6px;border-radius:3px;display:inline-block;">' + model + daysText + '</div>' +
    '</div>';
}

// ═══════════════════════════════════
// TOAST (top status popup)
// ═══════════════════════════════════
function showToast(title, subtitle, duration) {
  var existing = document.getElementById('adspy-toast');
  if(existing) existing.remove();
  if(!document.getElementById('adspy-spin-style')) {
    var st=document.createElement('style'); st.id='adspy-spin-style';
    st.textContent='@keyframes adspy-spin{to{transform:rotate(360deg)}} .adspy-large-mode .adspy-badge-v2{transform:scale(1.35)}';
    document.head.appendChild(st);
  }
  var t = document.createElement('div');
  t.id='adspy-toast';
  t.style.cssText='position:fixed;top:24px;left:50%;transform:translateX(-50%);z-index:2147483647;background:rgba(10,12,20,0.97);border:1px solid rgba(255,255,255,0.12);border-radius:14px;padding:20px 30px;min-width:220px;text-align:center;font-family:Arial,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,0.7);';
  t.innerHTML = '<div style="font-size:15px;font-weight:800;color:#fbbf24;margin-bottom:12px;">🔍 Ad<span style="color:#3b82f6">Radar</span></div>' +
    '<div style="width:22px;height:22px;border:3px solid rgba(251,191,36,0.25);border-top-color:#fbbf24;border-radius:50%;margin:0 auto 12px;animation:adspy-spin 0.8s linear infinite;"></div>' +
    '<div style="font-size:13px;font-weight:700;color:#fff;margin-bottom:3px;">'+title+'</div>' +
    (subtitle?('<div style="font-size:11px;color:#94a3b8;">'+subtitle+'</div>'):'');
  document.body.appendChild(t);
  setTimeout(function(){ if(t.parentNode) t.remove(); }, duration||1400);
}

// ═══════════════════════════════════
// TOOLBAR (persistent bottom bar)
// ═══════════════════════════════════
var CAT_CHIPS = ['All','Testing','Validating','Winning','Scaling','Cash Cow','Shopify','Multi','HOT'];
var MODEL_CHIPS = ['Dropship','POD','Jewelry','Digital','Amazon','Sub Box'];
var btnRefs = {};
var chipRefs = {};
var modelChipRefs = {};

function styleBtn(el, active, accent) {
  accent = accent || '#3b82f6';
  var isLight = (accent === '#ffffff');
  el.style.cssText = 'display:flex;align-items:center;gap:5px;padding:6px 12px;border-radius:20px;font-size:11px;font-weight:700;cursor:pointer;user-select:none;border:1px solid ' + (active?accent+'aa':'rgba(255,255,255,0.1)') + ';background:' + (active?(isLight?'#fff':accent+'22'):'rgba(255,255,255,0.05)') + ';color:' + (active?(isLight?'#111':accent):'#cbd5e1') + ';white-space:nowrap;transition:all .15s;';
}

function styleChip(el, active, color) {
  var isLight = (color === '#e2e8f0' || color === '#ffffff');
  el.style.cssText = 'display:inline-flex;align-items:center;gap:5px;padding:5px 11px;border-radius:14px;font-size:10px;font-weight:700;cursor:pointer;user-select:none;white-space:nowrap;border:1px solid ' + (active?color+'88':'rgba(255,255,255,0.08)') + ';background:' + (active?(isLight?'#e2e8f0':color+'22'):'rgba(255,255,255,0.04)') + ';color:' + (active?(isLight?'#111':color):'#94a3b8') + ';';
}

function makePanel() {
  if(document.getElementById('adspy-panel-v2')) return;

  var wrap = document.createElement('div');
  wrap.id = 'adspy-panel-v2';
  wrap.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483647;background:rgba(10,10,10,0.96);border:1px solid rgba(255,255,255,0.08);border-radius:18px;padding:12px 16px;font-family:Arial,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,0.7);max-width:1100px;margin:0 auto;';

  // Row 1: toolbar
  var row1 = document.createElement('div');
  row1.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;';

  var brand = document.createElement('div');
  brand.style.cssText = 'font-size:13px;font-weight:800;color:#fff;margin-right:4px;white-space:nowrap;cursor:pointer;';
  brand.innerHTML = '🔍 Ad<span style="color:#3b82f6">Radar</span> <span style="font-size:9px;color:#475569;font-weight:400;">v5.2.0</span>';
  brand.title = 'Open Dashboard';
  brand.addEventListener('click', function(){ window.open(API_BASE, '_blank'); });
  row1.appendChild(brand);

  var btnAccents = { scan:'#fbbf24', filter:'#22c55e', compete:'#ec4899', large:'#ffffff', gallery:'#fbbf24', live:'#06b6d4', auto:'#3b82f6' };

  function addBtn(key, label, onClick) {
    var b = document.createElement('div');
    b.textContent = label;
    styleBtn(b, false, btnAccents[key]);
    b.addEventListener('click', onClick);
    row1.appendChild(b);
    btnRefs[key] = b;
  }

  addBtn('scan', '🔄 Scan', function(){ setScanning(!ADSPY_UI.scanning); });
  addBtn('dashboard', '📊 Dashboard', function(){ window.open(API_BASE, '_blank'); });
  addBtn('filter', '⚡ Filter', function(){ toggleFilterPanel(); });
  addBtn('compete', '🎗 Compete', function(){ toggleCompete(); });
  styleBtn(btnRefs.dashboard, true, '#3b82f6');

  var starBox = document.createElement('div');
  starBox.style.cssText = 'display:flex;align-items:center;gap:4px;padding:6px 10px;border-radius:7px;background:rgba(255,255,255,0.04);font-size:11px;font-weight:700;color:#fbbf24;white-space:nowrap;';
  starBox.innerHTML = '⭐ <span id="ap2-total">0</span>';
  row1.appendChild(starBox);

  addBtn('help', '❓', function(){ showToast('Quick guide','Scan=on/off · Filter=chips · Compete=dupes · Auto=scroll', 2600); });
  addBtn('large', '▦ Large', function(){ toggleLarge(); });
  addBtn('export', '⬇ Export', function(){ exportCSVFromExtension(); });
  addBtn('gallery', '🖼 Gallery', function(){ toggleGallery(); });
  addBtn('live', '📡 Live', function(){ toggleLive(); });
  addBtn('auto', '⚡ Auto', function(){ toggleAutoScroll(); });
  addBtn('clear', '🗑', function(){ clearData(); });

  wrap.appendChild(row1);

  // Row 2: category chips
  var filterRows = document.createElement('div');
  filterRows.id = 'adspy-filter-rows';
  filterRows.style.cssText = 'display:' + (ADSPY_UI.filterOn?'flex':'none') + ';flex-direction:column;gap:6px;margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.06);';

  var catRow = document.createElement('div');
  catRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;align-items:center;';
  CAT_CHIPS.forEach(function(cat){
    var chip = document.createElement('div');
    var color = getColor(cat);
    chip.innerHTML = (cat==='HOT'?'🔥 ':'') + cat + ' <span style="opacity:.7" id="ap2-cat-' + cat.replace(/\s/g,'') + '">0</span>';
    styleChip(chip, ADSPY_UI.category===cat, color);
    chip.addEventListener('click', function(c){ return function(){ selectCategory(c); }; }(cat));
    catRow.appendChild(chip);
    chipRefs[cat] = chip;
  });
  filterRows.appendChild(catRow);

  var modelRow = document.createElement('div');
  modelRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;align-items:center;';
  var modelLbl = document.createElement('span');
  modelLbl.textContent = 'MODEL:';
  modelLbl.style.cssText = 'font-size:9px;color:#475569;font-weight:700;letter-spacing:.05em;margin-right:2px;';
  modelRow.appendChild(modelLbl);
  MODEL_CHIPS.forEach(function(m){
    var chip = document.createElement('div');
    chip.innerHTML = getModelIcon(m) + ' ' + m + ' <span style="opacity:.7" id="ap2-model-' + m.replace(/\s/g,'') + '">0</span>';
    styleChip(chip, ADSPY_UI.model===m, '#3b82f6');
    chip.addEventListener('click', function(mm){ return function(){ selectModel(mm); }; }(m));
    modelRow.appendChild(chip);
    modelChipRefs[m] = chip;
  });
  filterRows.appendChild(modelRow);

  wrap.appendChild(filterRows);
  document.body.appendChild(wrap);
  updateToolbarActiveStates();
}

function updateToolbarActiveStates() {
  if(btnRefs.scan) { btnRefs.scan.textContent = ADSPY_UI.scanning ? '⏸ Scan' : '▶ Scan'; styleBtn(btnRefs.scan, ADSPY_UI.scanning, '#fbbf24'); }
  if(btnRefs.filter) { btnRefs.filter.textContent = ADSPY_UI.filterOn ? '⚡ Filter ✓' : '⚡ Filter'; styleBtn(btnRefs.filter, ADSPY_UI.filterOn, '#22c55e'); }
  if(btnRefs.compete) styleBtn(btnRefs.compete, ADSPY_UI.competeOn, '#ec4899');
  if(btnRefs.large) styleBtn(btnRefs.large, ADSPY_UI.largeOn, '#ffffff');
  if(btnRefs.gallery) styleBtn(btnRefs.gallery, ADSPY_UI.galleryOn, '#fbbf24');
  if(btnRefs.live) styleBtn(btnRefs.live, ADSPY_UI.liveOn, '#06b6d4');
  if(btnRefs.auto) styleBtn(btnRefs.auto, ADSPY_UI.autoScrollOn, '#3b82f6');
  var rows = document.getElementById('adspy-filter-rows');
  if(rows) rows.style.display = ADSPY_UI.filterOn ? 'flex' : 'none';
}

function renderChipStates() {
  CAT_CHIPS.forEach(function(cat){
    var chip = chipRefs[cat];
    if(chip) styleChip(chip, ADSPY_UI.category===cat, getColor(cat));
    var countEl = document.getElementById('ap2-cat-' + cat.replace(/\s/g,''));
    if(countEl) {
      if(cat==='All') countEl.textContent = ADSPY.total;
      else if(cat==='Shopify') countEl.textContent = ADSPY.shopifyCount;
      else if(cat==='Multi') countEl.textContent = ADSPY.multiCount;
      else countEl.textContent = ADSPY.phaseCounts[cat] || 0;
    }
  });
  MODEL_CHIPS.forEach(function(m){
    var chip = modelChipRefs[m];
    if(chip) styleChip(chip, ADSPY_UI.model===m, '#3b82f6');
    var countEl = document.getElementById('ap2-model-' + m.replace(/\s/g,''));
    if(countEl) countEl.textContent = ADSPY.modelCounts[m] || 0;
  });
}

function updatePanel() {
  var t = document.getElementById('ap2-total');
  if(t) t.textContent = ADSPY.total;
  renderChipStates();
}

// ═══════════════════════════════════
// TOOLBAR ACTIONS
// ═══════════════════════════════════
function setScanning(on) {
  ADSPY_UI.scanning = on;
  if(on) {
    if(!scanIntervalRef) scanIntervalRef = setInterval(scan, 4000);
    if(!mutationObsRef) {
      mutationObsRef = new MutationObserver(function(){ clearTimeout(scanTimeout); scanTimeout = setTimeout(scan, 800); });
      mutationObsRef.observe(document.body, {childList:true, subtree:true});
    }
    showToast('Scanning resumed','Watching for new ads');
  } else {
    if(scanIntervalRef){ clearInterval(scanIntervalRef); scanIntervalRef=null; }
    if(mutationObsRef){ mutationObsRef.disconnect(); mutationObsRef=null; }
    showToast('Scan paused','Click Scan to resume');
  }
  updateToolbarActiveStates();
}

function toggleFilterPanel() {
  ADSPY_UI.filterOn = !ADSPY_UI.filterOn;
  if(!ADSPY_UI.filterOn) { ADSPY_UI.category='All'; ADSPY_UI.model=null; }
  applyFilters();
  updateToolbarActiveStates();
  renderChipStates();
}

function toggleCompete() {
  ADSPY_UI.competeOn = !ADSPY_UI.competeOn;
  applyFilters();
  updateToolbarActiveStates();
  showToast(ADSPY_UI.competeOn?'Compete mode on':'Compete mode off', ADSPY_UI.competeOn?'Showing ads with duplicate versions':'');
}

function selectCategory(cat) {
  ADSPY_UI.category = (ADSPY_UI.category===cat && cat!=='All') ? 'All' : cat;
  ADSPY_UI.filterOn = true;
  applyFilters();
  updateToolbarActiveStates();
  renderChipStates();
}

function selectModel(m) {
  ADSPY_UI.model = (ADSPY_UI.model===m) ? null : m;
  ADSPY_UI.filterOn = true;
  applyFilters();
  updateToolbarActiveStates();
  renderChipStates();
}

function applyFilters() {
  for(var i=0;i<processed.length;i++) {
    var card = processed[i];
    var show = true;
    if(ADSPY_UI.filterOn && ADSPY_UI.category && ADSPY_UI.category !== 'All') {
      if(ADSPY_UI.category === 'Shopify') show = card.dataset.shopify === '1';
      else if(ADSPY_UI.category === 'Multi') show = card.dataset.multi === '1';
      else show = card.dataset.phase === ADSPY_UI.category;
    }
    if(show && ADSPY_UI.filterOn && ADSPY_UI.model) show = card.dataset.model === ADSPY_UI.model;
    if(show && ADSPY_UI.competeOn) show = card.dataset.multi === '1' || parseInt(card.dataset.dups||'1',10) >= 2;
    card.style.display = show ? '' : 'none';
  }
}

function toggleLarge() {
  ADSPY_UI.largeOn = !ADSPY_UI.largeOn;
  document.body.classList.toggle('adspy-large-mode', ADSPY_UI.largeOn);
  updateToolbarActiveStates();
  showToast(ADSPY_UI.largeOn ? 'Applying large creative...' : 'Reverting to normal size', ADSPY_UI.largeOn ? 'Laying out ad cards' : '', 1600);
}

function toggleGallery() {
  ADSPY_UI.galleryOn = !ADSPY_UI.galleryOn;
  for(var i=0;i<processed.length;i++) {
    var card = processed[i];
    if(ADSPY_UI.galleryOn) {
      card.style.outline = '2px solid ' + getColor(card.dataset.phase);
      card.style.outlineOffset = '2px';
    } else {
      card.style.outline = '';
      card.style.outlineOffset = '';
    }
  }
  updateToolbarActiveStates();
  showToast(ADSPY_UI.galleryOn ? 'Gallery mode on' : 'Gallery mode off', ADSPY_UI.galleryOn ? 'Highlighting ads by phase color' : '', 1600);
}

function toggleLive() {
  ADSPY_UI.liveOn = !ADSPY_UI.liveOn;
  if(ADSPY_UI.liveOn) {
    if(!syncIntervalRef) syncIntervalRef = setInterval(function(){ syncToServer(); }, 30000);
    showToast('Live sync on','Auto-syncing to AdRadar every 30s');
  } else {
    if(syncIntervalRef){ clearInterval(syncIntervalRef); syncIntervalRef=null; }
    showToast('Live sync off','Use Sync Now in the popup to sync manually');
  }
  updateToolbarActiveStates();
}

function toggleAutoScroll() {
  ADSPY_UI.autoScrollOn = !ADSPY_UI.autoScrollOn;
  if(ADSPY_UI.autoScrollOn) {
    autoScrollIntervalRef = setInterval(function(){ window.scrollBy(0, 600); }, 1200);
    showToast('Auto-scroll on','Loading more ads automatically');
  } else {
    if(autoScrollIntervalRef){ clearInterval(autoScrollIntervalRef); autoScrollIntervalRef=null; }
    showToast('Auto-scroll off','');
  }
  updateToolbarActiveStates();
}

function clearData() {
  chrome.storage.local.set({adsData:[], syncedIds:[]});
  ADSPY = {
    total:0, hot:0, winning:0, pod:0,
    phaseCounts:{Testing:0,Validating:0,Winning:0,Scaling:0,'Cash Cow':0,HOT:0,Legend:0},
    modelCounts:{Dropship:0,POD:0,Jewelry:0,Digital:0,Amazon:0,'Sub Box':0},
    shopifyCount:0, multiCount:0
  };
  for(var i=0;i<processed.length;i++) {
    var b = processed[i].querySelector('.adspy-badge-v2');
    if(b) b.remove();
    processed[i].style.display = '';
    processed[i].style.outline = '';
  }
  processed = [];
  ADSPY_UI.category = 'All'; ADSPY_UI.model = null; ADSPY_UI.competeOn = false;
  updatePanel();
  showToast('Data cleared','Scanned ads reset to zero');
}

function exportCSVFromExtension() {
  chrome.storage.local.get('adsData', function(r) {
    var data = r.adsData || [];
    if(!data.length) { showToast('Nothing to export','Scan some ads first'); return; }
    var header = ['Page','Phase','Model','Days','Score','Confidence','Shopify','Multi','Duplicates','Countries','LandingURL','AdText'];
    var rows = data.map(function(a) {
      return [
        a.pageName||'', a.phase||'', a.model||'', a.days||0, a.score||0, a.confidence||0,
        a.isShopify?'Yes':'No', a.isMulti?'Yes':'No', a.duplicates||1, a.countryCount||1,
        a.landingUrl||'', '"' + (a.adText||'').replace(/"/g,'""') + '"'
      ].join(',');
    });
    var csv = [header.join(','), ...rows].join('\n');
    var blob = new Blob([csv], {type:'text/csv'});
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'adradar_extension_export.csv';
    link.click();
    URL.revokeObjectURL(url);
    showToast('Export ready','CSV downloading now');
  });
}

// ═══════════════════════════════════
// CARD PROCESSING
// ═══════════════════════════════════
function makeAdId(pageName, text, landingUrl) {
  var raw = (pageName||'') + '|' + (text||'').slice(0,100) + '|' + (landingUrl||'');
  var hash = 0;
  for (var i = 0; i < raw.length; i++) {
    hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
  }
  return 'ext_' + Math.abs(hash) + '_' + raw.length;
}

function processCard(card) {
  if(processed.indexOf(card) >= 0) return;
  processed.push(card);

  var cs = window.getComputedStyle(card);
  if(cs.position === 'static') card.style.position = 'relative';

  var text = card.innerText || '';
  var days = parseDays(text);
  var actualDays = days >= 0 ? days : 0;

  var dupMatch = text.match(/(\d+)\s+ads?\s+use\s+this/i);
  var dups = dupMatch ? parseInt(dupMatch[1]) : 1;

  var ctrMatch = text.match(/(\d+)\s+countr/i);
  var countries = ctrMatch ? parseInt(ctrMatch[1]) : 1;

  var score = calcScore(actualDays, dups, countries);
  var phase = getPhase(actualDays, dups, countries, score);
  var model = getModel(text);
  var conf = Math.round(Math.min(score/150, 1)*100);

  var landingUrl = parseLandingUrl(card);
  var thumbnailUrl = parseThumbnail(card);
  var pageName = parsePageName(card, text.split('\n')[0]);
  var shopify = isShopifyUrl(landingUrl);
  var multi = isMultiVersion(text) || dups >= 2;

  card.dataset.phase = phase;
  card.dataset.model = model;
  card.dataset.shopify = shopify ? '1' : '0';
  card.dataset.multi = multi ? '1' : '0';
  card.dataset.dups = dups;

  try {
    card.insertAdjacentHTML('afterbegin', makeBadge(phase, model, conf, days));
  } catch(e) {}

  if(ADSPY_UI.galleryOn) { card.style.outline = '2px solid ' + getColor(phase); card.style.outlineOffset = '2px'; }

  ADSPY.total++;
  if(phase === 'HOT') ADSPY.hot++;
  if(['HOT','Legend','Cash Cow','Scaling','Winning'].indexOf(phase) >= 0) ADSPY.winning++;
  if(model === 'POD') ADSPY.pod++;
  ADSPY.phaseCounts[phase] = (ADSPY.phaseCounts[phase]||0) + 1;
  ADSPY.modelCounts[model] = (ADSPY.modelCounts[model]||0) + 1;
  if(shopify) ADSPY.shopifyCount++;
  if(multi) ADSPY.multiCount++;
  updatePanel();

  var adId = makeAdId(pageName, text, landingUrl);

  try {
    chrome.storage.local.get('adsData', function(r) {
      var saved = r.adsData || [];
      saved.push({
        id: adId,
        phase: phase,
        model: model,
        score: score,
        confidence: conf,
        days: actualDays,
        runningDays: actualDays,
        pageName: pageName,
        landingUrl: landingUrl,
        text: text.slice(0,150),
        adText: text.slice(0,300),
        pageUrl: window.location.href,
        isActive: true,
        thumbnailUrl: thumbnailUrl,
        creativeType: 'Image',
        countries: countries,
        countryCount: countries,
        isShopify: shopify,
        isMulti: multi,
        duplicates: dups,
        platforms: 'facebook',
        collectedAt: new Date().toISOString()
      });
      if(saved.length > 500) saved = saved.slice(-500);
      chrome.storage.local.set({adsData: saved});
    });
  } catch(e) {}

  applyFilters();
}

// ═══════════════════════════════════
// SYNC TO SERVER
// ═══════════════════════════════════
function syncToServer(callback) {
  chrome.storage.local.get(['adradar_token', 'adsData', 'syncedIds'], function(r) {
    var token = r.adradar_token;
    if (!token) { if (callback) callback(false); return; }

    var allAds = r.adsData || [];
    var syncedIds = r.syncedIds || [];
    var syncedSet = {};
    for (var i = 0; i < syncedIds.length; i++) syncedSet[syncedIds[i]] = true;

    var pending = allAds.filter(function(a) { return a.id && !syncedSet[a.id]; });
    if (!pending.length) { if (callback) callback(true); return; }

    var batch = pending.slice(0, 50);

    fetch(API_BASE + '/api/extension/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({ ads: batch })
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      var newSyncedIds = syncedIds.concat(batch.map(function(a){ return a.id; }));
      if (newSyncedIds.length > 2000) newSyncedIds = newSyncedIds.slice(-2000);
      chrome.storage.local.set({
        syncedIds: newSyncedIds,
        lastSyncStatus: 'ok',
        lastSyncTime: new Date().toISOString()
      }, function() {
        if (callback) callback(true);
      });
    })
    .catch(function() {
      chrome.storage.local.set({ lastSyncStatus: 'err' }, function() {
        if (callback) callback(false);
      });
    });
  });
}

try {
  chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
    if (msg && msg.type === 'ADRADAR_MANUAL_SYNC') {
      syncToServer(function(ok) { sendResponse({ ok: ok }); });
      return true;
    }
  });
} catch(e) {}

// ── SMART FINDER v5.1.8 - walks UP from the small date-div to find the real card ──
function findCards() {
  var allDivs = document.getElementsByTagName('div');
  for(var i = 0; i < allDivs.length; i++) {
    var el = allDivs[i];

    var text = el.innerText || '';
    if(text.indexOf('Started running on') < 0) continue;

    var childDivs = el.getElementsByTagName('div');
    var childHasDate = false;
    for(var j = 0; j < childDivs.length; j++) {
      if((childDivs[j].innerText||'').indexOf('Started running on') >= 0) {
        childHasDate = true;
        break;
      }
    }
    if(childHasDate) continue;

    var card = el;
    var hops = 0;
    while(card && hops < 10) {
      if(card.offsetWidth >= 200 && card.offsetWidth <= 800 &&
         card.offsetHeight >= 250 && card.offsetHeight <= 1400) {
        break;
      }
      card = card.parentElement;
      hops++;
    }

    if(!card) continue;
    if(processed.indexOf(card) >= 0) continue;

    processCard(card);
  }
}

function scan() {
  makePanel();
  findCards();
}

setTimeout(scan, 1500);
setTimeout(scan, 3000);
setTimeout(scan, 5000);
setTimeout(scan, 8000);
setTimeout(function(){ setScanning(true); }, 1600);
setTimeout(function(){ syncToServer(); }, 10000);
syncIntervalRef = setInterval(function(){ syncToServer(); }, 30000);
