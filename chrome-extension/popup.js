chrome.storage.local.get('adsData', function(r) {
  var ads = r.adsData || [];
  document.getElementById('t').textContent = ads.length;
  document.getElementById('h').textContent = ads.filter(function(a){return a.phase==='HOT';}).length;
  document.getElementById('w').textContent = ads.filter(function(a){return ['HOT','Legend','Cash Cow','Scaling','Winning'].indexOf(a.phase)>=0;}).length;
  document.getElementById('p').textContent = ads.filter(function(a){return a.model==='POD';}).length;
});

document.getElementById('openBtn').addEventListener('click', function() {
  chrome.tabs.create({url:'https://adspy-pro-vc7w.onrender.com'});
});

document.getElementById('clrBtn').addEventListener('click', function() {
  chrome.storage.local.set({adsData:[]});
  document.getElementById('t').textContent='0';
  document.getElementById('h').textContent='0';
  document.getElementById('w').textContent='0';
  document.getElementById('p').textContent='0';
});

document.getElementById('expBtn').addEventListener('click', function() {
  chrome.storage.local.get('adsData', function(r) {
    var ads = r.adsData || [];
    if(!ads.length){alert('No ads yet!');return;}
    var csv = 'Phase,Model,Score,Days,Text\n' + ads.map(function(a){
      return [a.phase,a.model,a.score,a.days,(a.text||'').slice(0,50).replace(/,/g,'')].join(',');
    }).join('\n');
    var url = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
    var link = document.createElement('a');
    link.href=url; link.download='adspy_export.csv'; link.click();
  });
});
