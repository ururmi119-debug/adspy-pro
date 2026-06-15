const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.static('public'));
app.use(express.json());

// ✅ No token needed - Public endpoint
app.get('/api/search', async (req, res) => {
  const { keyword, country = 'US', limit = 20 } = req.query;
  
  try {
    const response = await axios.get(
      'https://www.facebook.com/ads/library/api/', {
      params: {
        ad_type: 'ALL',
        country: country,
        search_terms: keyword,
        fields: 'id,ad_creation_time,ad_creative_bodies,page_name,impressions',
        limit: limit,
        // ✅ App Token use করো (ads_read লাগে না এই fields এর জন্য)
        access_token: process.env.META_APP_TOKEN
      }
    });
    
    res.json({
      success: true,
      count: response.data.data?.length || 0,
      ads: response.data.data || []
    });
    
  } catch (error) {
    res.json({
      success: false,
      error: error.response?.data?.error?.message || 'Error occurred'
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
