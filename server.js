const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const { Pool } = require('pg');

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
// ─── POSTGRES DATABASE CONNECTION ────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.on('error', (err) => {
  console.error('Unexpected Postgres pool error:', err.message);
});

pool.connect()
  .then(client => {
    console.log('✅ Connected to Postgres (adradar-db)');
    client.release();
  })
  .catch(err => {
    console.error('❌ Postgres connection failed:', err.message);
  });
// ─── DATABASE MIGRATION: create ads table if it doesn't exist ───────────────
const createAdsTableQuery = `
  CREATE TABLE IF NOT EXISTS ads (
    id              TEXT PRIMARY KEY,
    page_name       TEXT,
    page_id         TEXT,
    ad_text         TEXT,
    title           TEXT,
    landing_url     TEXT,
    advertiser_domain TEXT,
    thumbnail_url   TEXT,
    creative_type   TEXT,
    running_days    INTEGER,
    is_meta_active  BOOLEAN,
    phase           TEXT,
    score           INTEGER,
    confidence      INTEGER,
    phase_reason    TEXT,
    model           TEXT,
    countries       TEXT,
    country_count   INTEGER,
    platforms       TEXT,
    source          TEXT,
    status          TEXT DEFAULT 'active',
    first_seen_at   TIMESTAMP DEFAULT NOW(),
    last_seen_at    TIMESTAMP DEFAULT NOW(),
    archived_at     TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_status ON ads(status);
  CREATE INDEX IF NOT EXISTS idx_source ON ads(source);
  CREATE INDEX IF NOT EXISTS idx_phase ON ads(phase);
`;

pool.query(createAdsTableQuery)
  .then(() => console.log('✅ ads table is ready'))
  .catch(err => console.error('❌ Migration failed:', err.message));

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
    subject: 'AdRadar - Unauthorized Access!',
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
          'https://facebook-ads-library-scraper-api.p.rapidapi.com/search/ads',
          {
            params: {
              query: search_terms,
              search_type: 'keyword_unordered',
              ad_type: 'all',
              status: 'ACTIVE',
              country: country,
              media_type: 'ALL',
              sort_by: 'total_impressions',
              trim: false
            },
            headers: {
              'x-rapidapi-key': RAPIDAPI_KEY,
              'x-rapidapi-host': 'facebook-ads-library-scraper-api.p.rapidapi.com'
            },
            timeout: 15000
          }
        );
        const raw = response.data.searchResults || [];
        const paging = {};
      
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
  // New API "facebook-ads-library-scraper-api" returns Meta-style nested shape.
  const snap = raw.snapshot || {};

  const startDateRaw = raw.start_date ? new Date(raw.start_date * 1000) : new Date();
  const endDateRaw = raw.end_date ? new Date(raw.end_date * 1000) : null;
  const today = new Date();

  let runningDays = 0;
  if (raw.total_active_time) {
    runningDays = Math.round(raw.total_active_time / 86400);
  } else if (raw.start_date) {
    const endPoint = (endDateRaw && raw.is_active === false) ? endDateRaw : today;
    runningDays = Math.max(0, Math.round((endPoint - startDateRaw) / 86400000));
  }

  const isActive = raw.is_active === true;
  const pageName = snap.page_name || snap.current_page_name || raw.page_name || 'Unknown Page';
  const adText = (snap.body?.text || '').toString();
  const title = snap.title || pageName;
  const landingUrl = snap.link_url || '';

  // ─── Real image/thumbnail extraction ─────────────────────────────────────
  const firstImage = (snap.images && snap.images[0]) || {};
  const firstVideo = (snap.videos && snap.videos[0]) || {};
  const thumbnailUrl =
    firstImage.resized_image_url ||
    firstImage.original_image_url ||
    firstVideo.video_preview_image_url ||
    snap.page_profile_picture_url ||
    '';

  let creativeType = 'Image';
  if (snap.videos && snap.videos.length > 0) creativeType = 'Video';
  else if (snap.display_format) creativeType = snap.display_format;

  const countries = (raw.targeted_or_reached_countries && raw.targeted_or_reached_countries.join(', ')) || 'N/A';
  const countryCount = (raw.targeted_or_reached_countries && raw.targeted_or_reached_countries.length) || 1;
  const impressions = raw.impressions_with_index?.impressions_text || 'N/A';
  const engagementLevel = 'low';

  const ad = {
    id: raw.ad_archive_id || makeFallbackId(pageName, title, adText, landingUrl),
    pageName,
    pageId: raw.page_id || '',
    adText: adText.slice(0, 300),
    title: title.slice(0, 120),
    landingUrl,
    isShopify: isShopifyUrl(landingUrl),
    startDate: startDateRaw.toLocaleDateString('en-US'),
    runningDays,
    isActive,
    creativeType,
    countries,
    countryCount,
    impressions,
    engagementLevel,
    spend: raw.spend || 'N/A',
    snapshotUrl: landingUrl,
    thumbnailUrl,
    platforms: (raw.publisher_platform && raw.publisher_platform.join(', ')) || 'facebook',
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
  const checkText = [adText, title, pageName].join(' ').toLowerCase();
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
// ─── EXTRACT ADVERTISER DOMAIN FROM A URL ────────────────────────────────────
function extractDomain(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

// ─── EXTENSION SYNC ENDPOINT ──────────────────────────────────────────────────
// Receives ads scraped by the Chrome Extension and upserts them into Postgres.
app.post('/api/extension/sync', authMiddleware, async (req, res) => {
  const { ads } = req.body;

  if (!Array.isArray(ads) || ads.length === 0) {
    return res.status(400).json({ error: 'ads array is required and must not be empty' });
  }

  const upsertQuery = `
    INSERT INTO ads (
      id, page_name, page_id, ad_text, title, landing_url, advertiser_domain,
      thumbnail_url, creative_type, running_days, is_meta_active, phase, score,
      confidence, phase_reason, model, countries, country_count, platforms,
      source, status, first_seen_at, last_seen_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7,
      $8, $9, $10, $11, $12, $13,
      $14, $15, $16, $17, $18, $19,
      $20, $21, NOW(), NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      running_days   = EXCLUDED.running_days,
      is_meta_active = EXCLUDED.is_meta_active,
      phase          = EXCLUDED.phase,
      score          = EXCLUDED.score,
      confidence     = EXCLUDED.confidence,
      phase_reason   = EXCLUDED.phase_reason,
      last_seen_at   = NOW(),
      status         = 'active',
      archived_at    = NULL
    WHERE ads.status = 'archived' OR ads.id = EXCLUDED.id;
  `;

  let synced = 0;
  let failed = 0;

  for (const ad of ads) {
    try {
      const advertiserDomain = extractDomain(ad.landingUrl);
      await pool.query(upsertQuery, [
        ad.id,
        ad.pageName || null,
        ad.pageId || null,
        ad.adText || null,
        ad.title || null,
        ad.landingUrl || null,
        advertiserDomain,
        ad.thumbnailUrl || null,
        ad.creativeType || null,
        ad.runningDays || 0,
        ad.isActive ?? true,
        ad.phase || null,
        ad.score || 0,
        ad.confidence || 0,
        ad.phaseReason || null,
        ad.model || null,
        ad.countries || null,
        ad.countryCount || 1,
        ad.platforms || null,
        'extension',
        'active'
      ]);
      synced++;
    } catch (err) {
      console.error('Sync error for ad', ad.id, ':', err.message);
      failed++;
    }
  }

  res.json({ synced, failed, total: ads.length });
});

// ─── AUTO-ARCHIVE: ads not seen in 30+ days get archived ────────────────────
async function autoArchiveStaleAds() {
  try {
    const result = await pool.query(`
      UPDATE ads
      SET status = 'archived', archived_at = NOW()
      WHERE status = 'active'
        AND source = 'extension'
        AND last_seen_at < NOW() - INTERVAL '30 days'
    `);
    if (result.rowCount > 0) {
      console.log(`📦 Auto-archived ${result.rowCount} stale extension ads`);
    }
  } catch (err) {
    console.error('Auto-archive error:', err.message);
  }
}

// Run once on server start, then every 24 hours
autoArchiveStaleAds();
setInterval(autoArchiveStaleAds, 24 * 60 * 60 * 1000);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '5.1.7', engine: 'Advanced AI v2', time: new Date().toISOString() });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log('AdRadar v5.1.7 running on port ' + PORT);
});
