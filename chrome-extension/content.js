// AdSpy Pro v5.1.8 - Fixed card detection (walks up to parent container)
var ADSPY = { total:0, hot:0, winning:0, pod:0 };
var processed = [];

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
  var c = {HOT:'#ef4444',Legend:'#fbbf24','Cash Cow':'#f59e0b',Scaling:'#3b82f6',Winning:'#22c55e',Validating:'#8b5cf6',Testing:'#64748b'};
  return c[phase] || '#64748b';
}

function getEmoji(phase) {
  var e = {HOT:'🔥',Legend:'👑','Cash Cow':'💰',Scaling:'🚀',Winning:'✅',Validating:'🔬',Testing:'🧪'};
  return e[phase] || '📊';
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

function makeBadge(phase, model, conf, days) {
  var color = getColor(phase);
  var emoji = getEmoji(phase);
  var daysText = days >= 0 ? ' · ' + days + 'd' : '';
  return '<div class="adspy-badge-v2" style="position:absolute;top:6px;left:6px;z-index:9999;background:rgba(8,10,18,0.95);border:1px solid ' + color + '55;border-radius:8px;padding:6px 9px;min-width:120px;font-family:Arial,sans-serif;pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,0.6);">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">' +
    '<span style="background:' + color + '22;color:' + color + ';border:1px solid ' + color + '44;padding:2px 7px;border-radius:4px;font-size:10px;font-weight:800;text-transform:uppercase;">' + emoji + ' ' + phase + '</span>' +
    '<span style="font-size:9px;color:#64748b;margin-left:6px;">' + conf + '%</span>' +
    '</div>' +
    '<div style="font-size:9px;background:rgba(255,255,255,0.07);color:#94a3b8;padding:1px 6px;border-radius:3px;display:inline-block;">' + model + daysText + '</div>' +
    '</div>';
}

function makePanel() {
  if(document.getElementById('adspy-panel-v2')) return;
  var el = document.createElement('div');
  el.id = 'adspy-panel-v2';
  el.style.cssText = 'position:fixed;bottom:18px;right:18px;z-index:2147483647;background:rgba(8,10,20,0.96);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:12px 14px;min-width:160px;font-family:Arial,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,0.7);';
  el.innerHTML = '<div style="font-size:12px;font-weight:700;color:#fff;margin-bottom:10px;">🔍 AdSpy<span style="color:#3b82f6;">Pro</span></div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">' +
    '<div style="background:#0f172a;border-radius:6px;padding:6px 8px;"><div style="font-size:16px;font-weight:700;color:#e2e8f0;" id="ap2-total">0</div><div style="font-size:9px;color:#334155;">Scanned</div></div>' +
    '<div style="background:#0f172a;border-radius:6px;padding:6px 8px;"><div style="font-size:16px;font-weight:700;color:#ef4444;" id="ap2-hot">0</div><div style="font-size:9px;color:#334155;">🔥 HOT</div></div>' +
    '<div style="background:#0f172a;border-radius:6px;padding:6px 8px;"><div style="font-size:16px;font-weight:700;color:#22c55e;" id="ap2-win">0</div><div style="font-size:9px;color:#334155;">✅ Win+</div></div>' +
    '<div style="background:#0f172a;border-radius:6px;padding:6px 8px;"><div style="font-size:16px;font-weight:700;color:#06b6d4;" id="ap2-pod">0</div><div style="font-size:9px;color:#334155;">🎁 POD</div></div>' +
    '</div>' +
    '<div style="font-size:9px;color:#22c55e;text-align:center;padding-top:6px;margin-top:6px;border-top:1px solid rgba(255,255,255,0.06);" id="ap2-status">● Scanning...</div>';
  document.body.appendChild(el);
}

function updatePanel() {
  var t = document.getElementById('ap2-total');
  var h = document.getElementById('ap2-hot');
  var w = document.getElementById('ap2-win');
  var p = document.getElementById('ap2-pod');
  var s = document.getElementById('ap2-status');
  if(t) t.textContent = ADSPY.total;
  if(h) h.textContent = ADSPY.hot;
  if(w) w.textContent = ADSPY.winning;
  if(p) p.textContent = ADSPY.pod;
  if(s) s.textContent = '● ' + ADSPY.total + ' ads scanned';
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

  try {
    card.insertAdjacentHTML('afterbegin', makeBadge(phase, model, conf, days));
  } catch(e) {}

  ADSPY.total++;
  if(phase === 'HOT') ADSPY.hot++;
  if(['HOT','Legend','Cash Cow','Scaling','Winning'].indexOf(phase) >= 0) ADSPY.winning++;
  if(model === 'POD') ADSPY.pod++;
  updatePanel();

  try {
    chrome.storage.local.get('adsData', function(r) {
      var saved = r.adsData || [];
      saved.push({phase:phase, model:model, score:score, confidence:conf, days:actualDays,
        text: text.slice(0,150), pageUrl: window.location.href,
        collectedAt: new Date().toISOString()});
      if(saved.length > 500) saved = saved.slice(-500);
      chrome.storage.local.set({adsData: saved});
    });
  } catch(e) {}
}

// ── SMART FINDER v5.1.8 - walks UP from the small date-div to find the real card ──
function findCards() {
  var allDivs = document.getElementsByTagName('div');
  for(var i = 0; i < allDivs.length; i++) {
    var el = allDivs[i];

    var text = el.innerText || '';
    if(text.indexOf('Started running on') < 0) continue;

    // Make sure THIS div is the innermost one containing the date text
    // (skip big wrapper divs that merely contain a date-div somewhere inside)
    var childDivs = el.getElementsByTagName('div');
    var childHasDate = false;
    for(var j = 0; j < childDivs.length; j++) {
      if((childDivs[j].innerText||'').indexOf('Started running on') >= 0) {
        childHasDate = true;
        break;
      }
    }
    if(childHasDate) continue; // not the innermost date div, skip — its parent walk will be handled below

    // Walk UP from this small date-div until we find a card-sized container
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
setInterval(scan, 4000);

var scanTimeout;
var obs = new MutationObserver(function() {
  clearTimeout(scanTimeout);
  scanTimeout = setTimeout(scan, 800);
});
obs.observe(document.body, {childList:true, subtree:true});
