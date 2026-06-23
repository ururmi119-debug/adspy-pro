const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');

// ─── SECRETS (loaded from environment variables — set these on Render) ──────
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS_HASH = process.env.ADMIN_PASS_HASH; // pre-hashed with bcrypt, see note below
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL;
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;

if (!JWT_SECRET || !RAPIDAPI_KEY) {
  console.warn('⚠️  Missing required environment variables (JWT_SECRET / RAPIDAPI_KEY). Set them in Render > Environment.');
}

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: GMAIL_USER,
    pass: GMAIL_APP_PASSWORD
  }
});

function sendAlert(ip) {
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) return; // email not configured yet, skip silently
  transporter.sendMail({
    from: GMAIL_USER,
    to: NOTIFY_EMAIL,
    subject: 'AdSpy Pro - Unauthorized Access!',
    text: 'Unauthorized access attempt from IP: ' + ip
  }).catch(err => console.error('Email alert failed:', err.message));
}

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

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── META AD LIBRARY API PROXY (protected — requires login) ─────────────────
app.get('/api/ads', authMiddleware, async (req, res) => {
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

  // ─── Retry logic for RapidAPI 429 (rate limit) errors ─────────────────────
  const maxRetries = 2;
  let lastErr;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.get(
        'https://facebook-ads-library-scraper.p.rapidapi.com/v1/facebook-ads/search',
        {
          params: {
            searchQueries: search_terms,
            country: country,
            maxResults: limit,
            mode: 'sync'
          },
          headers: {
            'x-rapidapi-key': RAPIDAPI_KEY,
            'x-rapidapi-host': 'facebook-ads-library-scraper.p.rapidapi.com'
          },
          timeout: 15000
        }
      );
      const raw = response.data.data || [];
      const paging = response.data.paging || {};
      const ads = raw.map(ad => processAd(ad)).filter(Boolean);
      return res.json({ ads, total: ads.length, next_cursor: paging.cursors?.after || null, has_more: !!paging.next });
    } catch (err) {
      lastErr = err;
      const status = err.response?.status;

      // Rate limited — wait and retry with exponential backoff (2s, 4s)
      if (status === 429 && attempt < maxRetries) {
        const waitMs = 2000 * (attempt + 1);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }
      break; // any other error, or retries exhausted — stop trying
    }
  }

  // All retries exhausted, or a non-retryable error occurred
  const status = lastErr.response?.status;
  if (status === 429) {
    return res.status(429).json({
      error: 'RapidAPI rate limit reached. Please wait a minute and try again, or upgrade your RapidAPI plan.',
      code: 'RATE_LIMITED'
    });
  }
  const fbError = lastErr.response?.data?.error;
  if (fbError) return res.status(400).json({ error: fbError.message || fbError, code: fbError.code });
  res.status(500).json({ error: 'Server error: ' + lastErr.message });
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

function makeFallbackId(pageName, title, adText, snapshotUrl) {
  const raw = [pageName, title, adText, snapshotUrl].filter(Boolean).join('|');
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
  }
  return 'fid_' + Math.abs(hash) + '_' + raw.length;
}

function processAd(raw) {
  // RapidAPI "facebook-ads-library-scraper" returns a different shape than
  // Meta's official API. Actual fields confirmed from live response:
  // { libraryId, adUrl, pageName, searchQuery, sourceUrl, country, activeStatus, scrapedAt }
  const scrapedDate = raw.scrapedAt ? new Date(raw.scrapedAt) : new Date();
  const today = new Date();
  // This scraper doesn't expose real ad start/stop dates, so we treat scrape date
  // as a proxy and runningDays as "unknown" (0) rather than guessing.
  const runningDays = 0;
  const isActive = (raw.activeStatus || '').toLowerCase() === 'active';

  const adText = raw.pageName || '';
  const title = raw.pageName || '';
  const landingUrl = raw.sourceUrl || raw.adUrl || '';

  const countryCount = 1;
  const countries = raw.country || 'N/A';

  const creativeType = 'Image';
  const impressions = 'N/A';
  const engagementLevel = 'low';

  const ad = {
    id: raw.libraryId || makeFallbackId(raw.pageName, title, adText, raw.adUrl),
    pageName: raw.pageName || 'Unknown Page',
    pageId: raw.libraryId || '',
    adText: adText.slice(0, 300),
    title: title.slice(0, 120),
    landingUrl,
    isShopify: isShopifyUrl(landingUrl),
    startDate: scrapedDate.toLocaleDateString('en-US'),
    runningDays,
    isActive,
    creativeType,
    countries,
    countryCount,
    impressions,
    engagementLevel,
    spend: 'N/A',
    snapshotUrl: raw.adUrl || '',
    platforms: 'facebook',
    duplicateCount: 1,
    variationCount: 1,
    pageAdCount: 0,
    isReupload: false,
    collectedAt: new Date().toISOString()
  };
// 18+ Haram Content Filter
  const haramKeywords = [
    'adult','18+','xxx','porn','sex','nude','naked',
    'dating','hookup','escort','casino','gambling','bet',
    'alcohol','beer','wine','whiskey','lottery'
  ];
  const checkText = [adText, title, raw.pageName || ''].join(' ').toLowerCase();
  if (haramKeywords.some(k => checkText.includes(k))) return null;
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

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  if (!ADMIN_USER || !ADMIN_PASS_HASH) {
    return res.status(500).json({ error: 'Login not configured on server yet' });
  }
  if (username !== ADMIN_USER) {
    sendAlert(req.ip);
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const match = await bcrypt.compare(password, ADMIN_PASS_HASH);
  if (!match) {
    sendAlert(req.ip);
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ user: username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token });
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
