var API_BASE = 'https://adspy-pro-vc7w.onrender.com';

function $(id) { return document.getElementById(id); }

// ── VIEW SWITCHING ──
function showLogin() {
  $('loginView').style.display = 'block';
  $('mainView').style.display = 'none';
}
function showMain() {
  $('loginView').style.display = 'none';
  $('mainView').style.display = 'block';
  refreshStats();
}

// ── INIT: check if we already have a token ──
chrome.storage.local.get('adradar_token', function(r) {
  if (r.adradar_token) {
    showMain();
  } else {
    showLogin();
  }
});

// ── LOGIN ──
$('loginBtn').addEventListener('click', function() {
  var u = $('loginUser').value.trim();
  var p = $('loginPass').value;
  var errEl = $('loginErr');
  errEl.style.display = 'none';

  if (!u || !p) {
    errEl.textContent = 'Enter username and password';
    errEl.style.display = 'block';
    return;
  }

  $('loginBtn').textContent = 'Signing in...';
  $('loginBtn').disabled = true;

  fetch(API_BASE + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u, password: p })
  })
  .then(function(res) { return res.json().then(function(data) { return { ok: res.ok, data: data }; }); })
  .then(function(result) {
    $('loginBtn').textContent = '🔐 Sign In';
    $('loginBtn').disabled = false;
    if (!result.ok || !result.data.token) {
      errEl.textContent = result.data.error || 'Login failed';
      errEl.style.display = 'block';
      return;
    }
    chrome.storage.local.set({ adradar_token: result.data.token }, function() {
      showMain();
    });
  })
  .catch(function() {
    $('loginBtn').textContent = '🔐 Sign In';
    $('loginBtn').disabled = false;
    errEl.textContent = 'Network error, try again';
    errEl.style.display = 'block';
  });
});

// ── LOGOUT ──
$('logoutBtn').addEventListener('click', function() {
  chrome.storage.local.remove('adradar_token', function() {
    showLogin();
  });
});

// ── REFRESH STATS FROM LOCAL DATA ──
function refreshStats() {
  chrome.storage.local.get(['adsData', 'lastSyncStatus', 'lastSyncTime'], function(r) {
    var ads = r.adsData || [];
    $('t').textContent = ads.length;
    $('h').textContent = ads.filter(function(a){return a.phase==='HOT';}).length;
    $('w').textContent = ads.filter(function(a){return ['HOT','Legend','Cash Cow','Scaling','Winning'].indexOf(a.phase)>=0;}).length;
    $('p').textContent = ads.filter(function(a){return a.model==='POD';}).length;

    var dot = $('syncDot');
    var txt = $('syncTxt');
    if (r.lastSyncStatus === 'ok') {
      dot.className = 'syncDot ok';
      txt.textContent = r.lastSyncTime ? 'Synced ' + timeAgo(r.lastSyncTime) : 'Synced';
    } else if (r.lastSyncStatus === 'err') {
      dot.className = 'syncDot err';
      txt.textContent = 'Sync failed - check connection';
    } else {
      dot.className = 'syncDot';
      txt.textContent = 'Not synced yet';
    }
  });
}

function timeAgo(iso) {
  var diff = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return diff + 's ago';
  if (diff < 3600) return Math.round(diff/60) + 'm ago';
  return Math.round(diff/3600) + 'h ago';
}

// ── OPEN DASHBOARD ──
$('openBtn').addEventListener('click', function() {
  chrome.tabs.create({url: API_BASE});
});

// ── MANUAL SYNC BUTTON: ask content.js (via background) to push now ──
$('syncBtn').addEventListener('click', function() {
  $('syncBtn').textContent = '☁️ Syncing...';
  chrome.runtime.sendMessage({ type: 'ADRADAR_MANUAL_SYNC' }, function() {
    setTimeout(function() {
      $('syncBtn').textContent = '☁️ Sync Now';
      refreshStats();
    }, 1500);
  });
});

// ── CLEAR DATA ──
$('clrBtn').addEventListener('click', function() {
  if (!confirm('Clear all locally scanned ads? (Already-synced ads stay safe in the database)')) return;
  chrome.storage.local.set({ adsData: [], syncedIds: [] }, function() {
    refreshStats();
  });
});

// ── EXPORT CSV ──
$('expBtn').addEventListener('click', function() {
  chrome.storage.local.get('adsData', function(r) {
    var ads = r.adsData || [];
    if (!ads.length) { alert('No ads yet!'); return; }
    var csv = 'Phase,Model,Score,Days,PageName,LandingURL,Text\n' + ads.map(function(a){
      return [a.phase, a.model, a.score, a.days, (a.pageName||''), (a.landingUrl||''), (a.text||'').slice(0,50).replace(/,/g,'')].join(',');
    }).join('\n');
    var url = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
    var link = document.createElement('a');
    link.href = url; link.download = 'adradar_export.csv'; link.click();
  });
});
