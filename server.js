const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── META AD LIBRARY API PROXY ───────────────────────────────────────────────
app.get('/api/ads', async (req, res) => {
  const {
    access_token,
    search_terms,
    ad_type = 'ALL',
    country = 'US',
    limit = 50,
    after // pagination cursor
  } = req.query;

  if (!access_token) {
    return res.status(400).json({ error: 'access_token is required' });
  }
  if (!search_terms) {
    return res.status(400).json({ error: 'search_terms is required' });
  }

  const fields = [
    'id',
    'ad_creation_time',
    'ad_delivery_start_time',
    'ad_delivery_stop_time',
    'ad_snapshot_url',
    'page_name',
    'page_id',
    'creative_bodies',
    'creative_link_titles',
    'creative_link_descriptions',
    'creative_link_captions',
    'publisher_platforms',
    'delivery_by_region',
    'estimated_audience_size',
    'impressions',
    'spend',
    'currency'
  ].join(',');

  const params = {
    access_token,
    search_terms,
    ad_type,
    ad_reached_countries: JSON.stringify([country]),
    fields,
    limit: Math.min(parseInt(limit), 100),
  };

  if (after) params.after = after;

  try {
    const response = await axios.get(
      'https://graph.facebook.com/v19.0/ads_archive',
      { params, timeout: 15000 }
    );

    const raw = response.data.data || [];
    const paging = response.data.paging || {};

    // Process & enrich each ad
    const ads = raw.map(ad => processAd(ad));

    res.json({
      ads,
      total: ads.length,
      next_cursor: paging.cursors?.after || null,
      has_more: !!paging.next
    });

  } catch (err) {
    const fbError = err.response?.data?.error;
    if (fbError) {
      return res.status(400).json({
        error: fbError.message,
        code: fbError.code,
        type: fbError.type
      });
    }
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// ─── PROCESS & ENRICH AD DATA ────────────────────────────────────────────────
function processAd(raw) {
  const startDate = raw.ad_delivery_start_time
    ? new Date(raw.ad_delivery_start_time)
    : new Date(raw.ad_creation_time);
  const stopDate = raw.ad_delivery_stop_time
    ? new Date(raw.ad_delivery_stop_time)
    : null;
  const today = new Date();
  const runningDays = Math.floor((today - startDate) / (1000 * 60 * 60 * 24));
  const isActive = !stopDate || stopDate > today;

  const adText = [
    ...(raw.creative_bodies || []),
    ...(raw.creative_link_descriptions || [])
  ].join(' ').trim();

  const landingUrl = (raw.creative_link_captions || [])[0] || '';
  const title = (raw.creative_link_titles || [])[0] || '';

  // Creative type detection
  let creativeType = 'Image';
  if ((raw.creative_link_titles || []).length > 1) creativeType = 'Carousel';
  if ((raw.publisher_platforms || []).includes('instagram')) creativeType = creativeType + '+IG';

  // Impressions range
  let impressions = 'N/A';
  if (raw.impressions) {
    const lo = Number(raw.impressions.lower_bound);
    const hi = Number(raw.impressions.upper_bound);
    if (lo >= 1000000) impressions = `${(lo/1000000).toFixed(1)}M–${(hi/1000000).toFixed(1)}M`;
    else if (lo >= 1000) impressions = `${Math.round(lo/1000)}K–${Math.round(hi/1000)}K`;
    else impressions = `${lo}–${hi}`;
  }

  // Spend range
  let spend = 'N/A';
  if (raw.spend) {
    spend = `${raw.spend.lower_bound}–${raw.spend.upper_bound} ${raw.currency || 'USD'}`;
  }

  // Countries
  const countries = raw.delivery_by_region
    ? Object.keys(raw.delivery_by_region).slice(0, 4).join(', ')
    : 'N/A';

  const ad = {
    id: raw.id,
    pageName: raw.page_name || 'Unknown Page',
    pageId: raw.page_id || '',
    adText: adText.slice(0, 300),
    title: title.slice(0, 120),
    landingUrl,
    isShopify: isShopifyUrl(landingUrl),
    startDate: startDate.toLocaleDateString('en-US'),
    runningDays,
    isActive,
    creativeType,
    countries,
    impressions,
    spend,
    snapshotUrl: raw.ad_snapshot_url || '',
    platforms: (raw.publisher_platforms || ['facebook']).join(', '),
    collectedAt: new Date().toISOString()
  };

  // AI-like detection
  ad.model = detectModel(ad);
  ad.phase = detectPhase(ad);
  ad.score = calcScore(ad);

  return ad;
}

// ─── PHASE DETECTION LOGIC ───────────────────────────────────────────────────
function detectPhase(ad) {
  const { runningDays, isActive } = ad;
  if (!isActive && runningDays > 90)  return 'Cash Cow';
  if (runningDays >= 60 && isActive)   return 'HOT';
  if (runningDays >= 30 && isActive)   return 'Scaling';
  if (runningDays >= 14 && isActive)   return 'Winning';
  if (runningDays >= 7)                return 'Validating';
  return 'Testing';
}

// ─── MODEL DETECTION LOGIC ───────────────────────────────────────────────────
function detectModel(ad) {
  const text = [ad.adText, ad.title, ad.pageName, ad.landingUrl]
    .join(' ').toLowerCase();

  const scores = {
    POD: score(text, ['print', 'custom', 'personalized', 'islamic', 'muslim',
      'motivational', 'teacher', 'nurse', 'quote', 'tshirt', 't-shirt',
      'hoodie', 'mug', 'poster', 'shirt', 'apparel', 'wear', 'gift',
      'calligraphy', 'hijab', 'quran', 'faith']),
    Dropship: score(text, ['free shipping', 'order now', 'limited stock',
      'aliexpress', 'buy now', 'ships from', 'worldwide shipping',
      'add to cart', '% off today']),
    Jewelry: score(text, ['necklace', 'ring', 'bracelet', 'jewelry',
      'jewellery', 'pendant', 'gold', 'silver', 'gemstone', 'diamond',
      'earring', 'crystal', 'handcrafted']),
    Digital: score(text, ['download', 'ebook', 'course', 'digital',
      'template', 'preset', 'software', 'app', 'pdf', 'guide',
      'masterclass', 'instant access', 'canva']),
    Amazon: score(text, ['amazon', 'prime', 'asin', 'amazon.com']),
    'Sub Box': score(text, ['subscribe', 'subscription', 'monthly box',
      'box club', 'members', 'unboxing', 'curated box'])
  };

  const best = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  return best[0][1] > 0 ? best[0][0] : 'POD';
}

function score(text, keywords) {
  return keywords.reduce((acc, k) => acc + (text.includes(k) ? 1 : 0), 0);
}

// ─── WIN SCORE ───────────────────────────────────────────────────────────────
function calcScore(ad) {
  let s = 0;
  if (ad.isActive) s += 30;
  if (ad.runningDays >= 30) s += 25;
  if (ad.runningDays >= 60) s += 20;
  if (ad.isShopify) s += 15;
  if (ad.impressions !== 'N/A') s += 10;
  return Math.min(s, 100);
}

function isShopifyUrl(url) {
  return url.includes('myshopify.com') ||
    url.includes('.com/products') ||
    url.includes('.com/collections');
}

// ─── TOKEN VERIFY ENDPOINT ───────────────────────────────────────────────────
app.get('/api/verify-token', async (req, res) => {
  const { access_token } = req.query;
  if (!access_token) return res.status(400).json({ valid: false, error: 'No token' });
  try {
    const r = await axios.get('https://graph.facebook.com/v19.0/me', {
      params: { access_token, fields: 'id,name' },
      timeout: 8000
    });
    res.json({ valid: true, user: r.data });
  } catch (e) {
    res.json({ valid: false, error: e.response?.data?.error?.message || 'Invalid token' });
  }
});

// ─── HEALTH CHECK ────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '5.1.7', time: new Date().toISOString() });
});

// ─── SERVE FRONTEND ──────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🔍 AdSpy Pro v5.1.7 running on port ${PORT}`);
});
