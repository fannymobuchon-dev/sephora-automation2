const express = require('express');
const puppeteer = require('puppeteer');
const axios = require('axios');

const app = express();
app.use(express.json());

async function extractBannerUrls(browser, domain) {
  try {
    const page = await browser.newPage();
    await page.goto(`https://www.sephora.${domain}/`, { waitUntil: 'networkidle2', timeout: 30000 });

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
  } catch (error) {
    console.error('Erreur extraction URLs:', error.message);
    return { mainBannerUrl: null, ub1Url: null, ub2Url: null };
  }
}

async function capturePageScreenshot(browser, url) {
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    const screenshot = await page.screenshot({ fullPage: true });
    await page.close();
    return screenshot;
  } catch (error) {
    console.error('Erreur capture page:', error.message);
    return null;
  }
}

async function uploadToImgur(buffer) {
  try {
    const formData = new FormData();
    formData.append('image', new Blob([buffer]));

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
  const { country, domain, notionToken, notionDatabaseId } = req.body;

  console.log(`Démarrage capture pour ${country}...`);

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    const homepageScreenshot = await capturePageScreenshot(browser, `https://www.sephora.${domain}/`);
    const homepageUrl = homepageScreenshot ? await uploadToImgur(homepageScreenshot) : null;
    console.log(`✓ Homepage capturée: ${homepageUrl}`);

    const bannerUrls = await extractBannerUrls(browser, domain);
    console.log(`✓ URLs extraites`);

    let redirectMainUrl = null;
    let redirectUb1Url = null;
    let redirectUb2Url = null;

    if (bannerUrls.mainBannerUrl) {
      const screenshot = await capturePageScreenshot(browser, bannerUrls.mainBannerUrl);
      redirectMainUrl = screenshot ? await uploadToImgur(screenshot) : null;
      console.log(`✓ Redirection Main capturée`);
    }

    if (bannerUrls.ub1Url) {
      const screenshot = await capturePageScreenshot(browser, bannerUrls.ub1Url);
      redirectUb1Url = screenshot ? await uploadToImgur(screenshot) : null;
      console.log(`✓ Redirection UB1 capturée`);
    }

    if (bannerUrls.ub2Url) {
      const screenshot = await capturePageScreenshot(browser, bannerUrls.ub2Url);
      redirectUb2Url = screenshot ? await uploadToImgur(screenshot) : null;
      console.log(`✓ Redirection UB2 capturée`);
    }

    const weekNumber = Math.ceil((new Date().getDate() - new Date().getDay() + 4) / 7);
    
    if (notionToken && notionDatabaseId) {
      const notionPayload = {
        parent: { database_id: notionDatabaseId },
        properties: {
          'Semaine': { number: weekNumber },
          'Pays': { select: { name: country } },
          'Homepage': { url: homepageUrl },
          'Redirection Main': { url: redirectMainUrl },
          'Redirection UB1': { url: redirectUb1Url },
          'Redirection UB2': { url: redirectUb2Url },
        },
      };

      await axios.post('https://api.notion.com/v1/pages', notionPayload, {
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
    res.status(500).json({ error: error.message });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
});

app.get('/', (req, res) => {
  res.send('Serveur Sephora Automation est actif ! 🚀');
});

const listener = app.listen(process.env.PORT || 3000, () => {
  console.log('Serveur lancé sur le port ' + (process.env.PORT || 3000));
});
