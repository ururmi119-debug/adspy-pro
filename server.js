const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');

const JWT_SECRET = 'adspypro_secret_2026';
const ADMIN_USER = 'urmi';
const ADMIN_PASS = bcrypt.hashSync('adspy2026', 10);
const NOTIFY_EMAIL = 'urmiislamomi119@gmail.com';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'urmiislamomi119@gmail.com',
    pass: 'YOUR_APP_PASSWORD'
  }
});

function authMiddleware(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) {
    sendAlert(req.ip);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    sendAlert(req.ip);
    res.status(401).json({ error: 'Invalid token' });
  }
}

function sendAlert(ip) {
  transporter.sendMail({
    from: 'urmiislamomi119@gmail.com',
    to: NOTIFY_EMAIL,
    subject: 'AdSpy Pro - Unauthorized Access!',
    text: 'Unauthorized access attempt from IP: ' + ip
  });
}
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
    search_terms,
    ad_type = 'ALL',
    country = 'US',
    limit = 50,
    after
  } = req.query;

  if (!search_terms) return res.status(400).json({ error: 'search_terms is required' });

  const fields = [
    'id','ad_creation_time','ad_delivery_start_time','ad_delivery_stop_time',
    'ad_snapshot_url','page_name','page_id','creative_bodies','creative_link_titles',
    'creative_link_descriptions','creative_link_captions','publisher_platforms',
    'delivery_by_region','estimated_audience_size','impressions','spend','currency'
  ].join(',');

  const params = new URLSearchParams({
    search_type: 'KEYWORD_UNORDERED',
    ad_reached_countries: JSON.stringify([country]),
    search_terms,
    ad_type,
    fields,
    limit: String(Math.min(parseInt(limit), 100)),
  });
  if (after) params.append('after', after);

  try {
    const response = await axios.get(
      `https://www.facebook.com/ads/library/api/?${params.toString()}`,
      { timeout: 15000 }
    );
    const raw = response.data.data || [];
    const paging = response.data.paging || {};
    const ads = raw.map(ad => processAd(ad));
    res.json({ ads, total: ads.length, next_cursor: paging.cursors?.after || null, has_more: !!paging.next });
  } catch (err) {
    const fbError = err.response?.data?.error;
    if (fbError) return res.status(400).json({ error: fbError.message, code: fbError.code });
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});
function calcAdvancedScore(ad) {
  let score = 0;
  const days = ad.runningDays || 0;
  const duplicates = ad.duplicateCount || 1;
  const countries = ad.countryCount || 1;
  const variations = ad.variationCount || 1;
  const pageAds = ad.pageAdCount || 0;

  if (days >= 181)      score += 30;
  else if (days >= 91)  score += 25;
  else if (days >= 31)  score += 20;
  else if (days >= 11)  score += 15;
  else if (days >= 4)   score += 10;
  else                  score += 5;

  if (duplicates >= 30)      score += 30;
  else if (duplicates >= 11) score += 20;
  else if (duplicates >= 4)  score += 10;
  else if (duplicates >= 2)  score += 5;

  if (countries >= 15)     score += 30;
  else if (countries >= 6) score += 20;
  else if (countries >= 2) score += 10;

  if (pageAds >= 200)      score += 25;
  else if (pageAds >= 51)  score += 15;
  else if (pageAds >= 11)  score += 5;

  if (variations >= 15)     score += 30;
  else if (variations >= 6) score += 20;
  else if (variations >= 2) score += 10;

  if (days >= 90)      score += 30;
  else if (days >= 60) score += 20;
  else if (days >= 30) score += 10;

  if (ad.isReupload) score += 15;

  if (ad.engagementLevel === 'high')   score += 20;
  else if (ad.engagementLevel === 'medium') score += 10;

  return score;
}

function detectPhase(ad) {
  const days = ad.runningDays || 0;
  const duplicates = ad.duplicateCount || 1;
  const countries = ad.countryCount || 1;
  const score = ad.rawScore || 0;

  if (days <= 14 && duplicates >= 10 && countries >= 3) return 'HOT';
  if (days > 180 && score > 150) return 'Legend';
  if (days > 90 && score > 110) return 'Cash Cow';
  if (score >= 70 && (countries > 3 || duplicates > 5)) return 'Scaling';
  if (score >= 40 && days >= 11) return 'Winning';
  if (score >= 20 && days <= 10) return 'Validating';
  return 'Testing';
}

function calcConfidence(score) {
  return Math.round(Math.min(score / 150, 1) * 100);
}

function getPhaseReason(ad) {
  const reasons = [];
  if (ad.duplicateCount > 1)  reasons.push(ad.duplicateCount + ' duplicates');
  if (ad.countryCount > 1)    reasons.push(ad.countryCount + ' countries');
  if (ad.runningDays > 0)     reasons.push(ad.runningDays + ' days active');
  if (ad.isShopify)           reasons.push('Shopify store');
  return reasons.slice(0, 3).join(', ') || 'New ad';
}

function processAd(raw) {
  const startDate = raw.ad_delivery_start_time
    ? new Date(raw.ad_delivery_start_time)
    : new Date(raw.ad_creation_time);
  const stopDate = raw.ad_delivery_stop_time ? new Date(raw.ad_delivery_stop_time) : null;
  const today = new Date();
  const runningDays = Math.floor((today - startDate) / (1000 * 60 * 60 * 24));
  const isActive = !stopDate || stopDate > today;

  const adText = [...(raw.creative_bodies || []), ...(raw.creative_link_descriptions || [])].join(' ').trim();
  const landingUrl = (raw.creative_link_captions || [])[0] || '';
  const title = (raw.creative_link_titles || [])[0] || '';

  const countryCount = raw.delivery_by_region ? Object.keys(raw.delivery_by_region).length : 1;
  const countries = raw.delivery_by_region
    ? Object.keys(raw.delivery_by_region).slice(0, 5).join(', ')
    : 'N/A';

  let creativeType = 'Image';
  if ((raw.creative_link_titles || []).length > 1) creativeType = 'Carousel';

  let impressions = 'N/A';
  if (raw.impressions) {
    const lo = Number(raw.impressions.lower_bound);
    const hi = Number(raw.impressions.upper_bound);
    if (lo >= 1000000) impressions = (lo/1000000).toFixed(1) + 'M–' + (hi/1000000).toFixed(1) + 'M';
    else if (lo >= 1000) impressions = Math.round(lo/1000) + 'K–' + Math.round(hi/1000) + 'K';
    else impressions = lo + '–' + hi;
  }

  let engagementLevel = 'low';
  if (raw.impressions) {
    const lo = Number(raw.impressions.lower_bound);
    if (lo >= 1000000) engagementLevel = 'high';
    else if (lo >= 100000) engagementLevel = 'medium';
  }

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
    countryCount,
    impressions,
    engagementLevel,
    spend: raw.spend ? raw.spend.lower_bound + '–' + raw.spend.upper_bound + ' ' + (raw.currency || 'USD') : 'N/A',
    snapshotUrl: raw.ad_snapshot_url || '',
    platforms: (raw.publisher_platforms || ['facebook']).join(', '),
    duplicateCount: 1,
    variationCount: 1,
    pageAdCount: 0,
    isReupload: false,
    collectedAt: new Date().toISOString()
  };

  ad.rawScore = calcAdvancedScore(ad);
  ad.phase = detectPhase(ad);
  ad.confidence = calcConfidence(ad.rawScore);
  ad.phaseReason = getPhaseReason(ad);
  ad.model = detectModel(ad);
  ad.score = ad.rawScore;

  return ad;
}

function detectModel(ad) {
  const text = [ad.adText, ad.title, ad.pageName, ad.landingUrl].join(' ').toLowerCase();

  const scores = {
    POD: scoreKw(text, ['print','custom','personalized','islamic','muslim','motivational',
      'teacher','nurse','quote','tshirt','t-shirt','hoodie','mug','poster','shirt',
      'apparel','wear','gift','calligraphy','hijab','quran','faith','god']),
    Dropship: scoreKw(text, ['free shipping','order now','limited stock','aliexpress',
      'buy now','ships from','worldwide shipping','add to cart','% off today','flash sale']),
    Jewelry: scoreKw(text, ['necklace','ring','bracelet','jewelry','jewellery','pendant',
      'gold','silver','gemstone','diamond','earring','crystal','handcrafted','925']),
    Digital: scoreKw(text, ['download','ebook','course','digital','template','preset',
      'software','app','pdf','guide','masterclass','instant access','canva','notion']),
    Amazon: scoreKw(text, ['amazon','prime','asin','amazon.com','fulfilled by']),
    'Sub Box': scoreKw(text, ['subscribe','subscription','monthly box','box club',
      'members','unboxing','curated box','mystery box'])
  };

  const best = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  return best[0][1] > 0 ? best[0][0] : 'POD';
}

function scoreKw(text, keywords) {
  return keywords.reduce((acc, k) => acc + (text.includes(k) ? 1 : 0), 0);
}

function isShopifyUrl(url) {
  return url.includes('myshopify.com') || url.includes('.com/products') || url.includes('.com/collections');
}

app.get('/api/verify-token', async (req, res) => {
  const { access_token } = req.query;
  if (!access_token) return res.status(400).json({ valid: false, error: 'No token' });
  try {
    const r = await axios.get('https://graph.facebook.com/v21.0/me', {
      params: { access_token, fields: 'id,name' }, timeout: 8000
    });
    res.json({ valid: true, user: r.data });
  } catch (e) {
    res.json({ valid: false, error: e.response?.data?.error?.message || 'Invalid token' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '5.1.7', engine: 'Advanced AI v2', time: new Date().toISOString() });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log('AdSpy Pro v5.1.7 running on port ' + PORT);
});
