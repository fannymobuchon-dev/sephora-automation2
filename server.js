const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const BROWSERLESS_TOKEN = '2U4dyiq4fNAmHFT6f5cc1b077f9fac7e56f6b1a7aa0010f41';
const NOTION_TOKEN = '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';
const NOTION_DATABASE_ID = '317a64aa-d96d-80ff-bd5a-d3da770be758';

async function extractBannerUrls(domain) {
  try {
    const code = `
      const page = await browser.newPage();
      await page.goto('https://www.sephora.${domain}/', { waitUntil: 'networkidle2', timeout: 30000 });

      const urls = await page.evaluate(() => {
        const mainBanner = document.querySelector('[data-layer-banner-action="main banner"]');
        const ub1 = document.querySelector('[data-layer-banner-action="main under banner 1"]');
        const ub2 = document.querySelector('[data-layer-banner-action="main under banner 2"]');

        return {
          mainBannerUrl: mainBanner?.querySelector('a')?.href || null,
          ub1Url: ub1?.querySelector('a')?.href || null,
          ub2Url: ub2?.querySelector('a')?.href || null,
        };
      });

      await page.close();
      return urls;
    `;

    const response = await axios.post(
      `https://chrome.browserless.io/function?token=${BROWSERLESS_TOKEN}`,
      { code }
    );

    return response.data;
  } catch (error) {
    console.error('Erreur extraction URLs:', error.message);
    return { mainBannerUrl: null, ub1Url: null, ub2Url: null };
  }
}

async function capturePageScreenshot(url) {
  try {
    const response = await axios.post(
      `https://chrome.browserless.io/screenshot?token=${BROWSERLESS_TOKEN}`,
      {
        url: url,
        fullPage: true,
      },
      {
        responseType: 'arraybuffer'
      }
    );

    return response.data;
  } catch (error) {
    console.error('Erreur capture page:', error.message);
    return null;
  }
}

async function uploadToImgur(imageBuffer) {
  try {
    const formData = new FormData();
    formData.append('image', new Blob([imageBuffer]));

    const response = await axios.post('https://api.imgur.com/3/image', formData, {
      headers: {
        'Authorization': 'Client-ID 515fbc084588583',
      },
    });

    return response.data.data.link;
  } catch (error) {
    console.error('Erreur Imgur:', error.message);
    return null;
  }
}

app.post('/capture', async (req, res) => {
  let { country, domain } = req.body;
  const notionToken = NOTION_TOKEN;
  const notionDatabaseId = NOTION_DATABASE_ID;

  console.log(`Démarrage capture pour ${country}...`);
  console.log(`Données reçues:`, { country, domain });

  try {
    // 1. Capturer la homepage
    console.log(`Capture homepage: https://www.sephora.${domain}/`);
    const homepageScreenshot = await capturePageScreenshot(`https://www.sephora.${domain}/`);
    const homepageUrl = homepageScreenshot ? await uploadToImgur(homepageScreenshot) : null;
    console.log(`✓ Homepage capturée: ${homepageUrl}`);

    // 2. Extraire les URLs des bannières
    console.log(`Extraction URLs pour ${domain}...`);
    const bannerUrls = await extractBannerUrls(domain);
    console.log(`✓ URLs extraites:`, bannerUrls);

    // 3. Capturer les pages de redirection
    let redirectMainUrl = null;
    let redirectUb1Url = null;
    let redirectUb2Url = null;

    if (bannerUrls.mainBannerUrl) {
      console.log(`Capture redirection Main: ${bannerUrls.mainBannerUrl}`);
      const screenshot = await capturePageScreenshot(bannerUrls.mainBannerUrl);
      redirectMainUrl = screenshot ? await uploadToImgur(screenshot) : null;
      console.log(`✓ Redirection Main capturée: ${redirectMainUrl}`);
    }

    if (bannerUrls.ub1Url) {
      console.log(`Capture redirection UB1: ${bannerUrls.ub1Url}`);
      const screenshot = await capturePageScreenshot(bannerUrls.ub1Url);
      redirectUb1Url = screenshot ? await uploadToImgur(screenshot) : null;
      console.log(`✓ Redirection UB1 capturée: ${redirectUb1Url}`);
    }

    if (bannerUrls.ub2Url) {
      console.log(`Capture redirection UB2: ${bannerUrls.ub2Url}`);
      const screenshot = await capturePageScreenshot(bannerUrls.ub2Url);
      redirectUb2Url = screenshot ? await uploadToImgur(screenshot) : null;
      console.log(`✓ Redirection UB2 capturée: ${redirectUb2Url}`);
    }

    // 4. Envoyer à Notion
    const weekNumber = Math.ceil((new Date().getDate() - new Date().getDay() + 4) / 7);
    
    if (notionToken && notionDatabaseId) {
      console.log(`Envoi à Notion - DB: ${notionDatabaseId}`);
      
      const notionPayload = {
        parent: { database_id: notionDatabaseId },
        properties: {
          'Name': { title: [{ text: { content: `${country}_S${weekNumber}` } }] },
          'Semaine': { number: weekNumber },
          'Pays': { rich_text: [{ text: { content: country } }] },
          'Homepage': { url: homepageUrl },
          'Redirection Main': { url: redirectMainUrl },
          'Redirection UB1': { url: redirectUb1Url },
          'Redirection UB2': { url: redirectUb2Url },
        },
      };

      const notionResponse = await axios.post('https://api.notion.com/v1/pages', notionPayload, {
        headers: {
          'Authorization': `Bearer ${notionToken}`,
          'Notion-Version': '2022-06-28',
        },
      });

      console.log(`✓ Données envoyées à Notion pour ${country}`);
    }

    res.json({
      success: true,
      country,
      homepageUrl,
      redirectMainUrl,
      redirectUb1Url,
      redirectUb2Url,
    });
  } catch (error) {
    console.error(`✗ Erreur pour ${country}:`, error.message);
    console.error(`Stack:`, error.stack);
    res.status(500).json({ error: error.message });
  }
});

app.get('/', (req, res) => {
  res.send('Serveur Sephora Automation est actif ! 🚀');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Serveur lancé sur le port ${PORT}`);
});
