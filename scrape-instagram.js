const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');

const HANDLE = '120__media';

async function downloadImage(url, filepath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filepath);
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(filepath); });
    }).on('error', reject);
  });
}

async function scrapeInstagram() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'es-ES',
    viewport: { width: 1280, height: 900 }
  });

  const page = await context.newPage();

  console.log(`Accediendo a instagram.com/${HANDLE}...`);
  await page.goto(`https://www.instagram.com/${HANDLE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);

  // Dismiss cookie dialog if present
  try {
    const cookieBtn = page.locator('button:has-text("Rechazar"), button:has-text("Decline"), button:has-text("Only allow essential")');
    if (await cookieBtn.count() > 0) {
      await cookieBtn.first().click();
      await page.waitForTimeout(1500);
    }
  } catch {}

  // Dismiss login dialog if present
  try {
    const notNowBtn = page.locator('button:has-text("Not now"), button:has-text("Ahora no"), button:has-text("No, gracias")');
    if (await notNowBtn.count() > 0) {
      await notNowBtn.first().click();
      await page.waitForTimeout(1500);
    }
  } catch {}

  // Try to extract data from the page
  const data = await page.evaluate(() => {
    const getMeta = (prop) => {
      const el = document.querySelector(`meta[property="${prop}"], meta[name="${prop}"]`);
      return el ? el.getAttribute('content') : null;
    };

    // Try JSON data from script tags
    let jsonData = null;
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const s of scripts) {
      try {
        const d = JSON.parse(s.textContent);
        if (d['@type'] === 'ProfilePage' || d.author || d.name) {
          jsonData = d;
          break;
        }
      } catch {}
    }

    // Try window._sharedData
    let sharedData = null;
    try {
      const scriptTags = Array.from(document.querySelectorAll('script'));
      for (const s of scriptTags) {
        if (s.textContent.includes('window._sharedData')) {
          const match = s.textContent.match(/window\._sharedData\s*=\s*({.+?});<\/script>/s);
          if (match) sharedData = JSON.parse(match[1]);
          break;
        }
      }
    } catch {}

    // Extract from DOM
    const header = document.querySelector('header');
    const allText = document.body.innerText;

    // Get profile image
    const profileImg = document.querySelector('header img, img[alt*="foto de perfil"], img[alt*="profile picture"]');
    const profileImgSrc = profileImg ? profileImg.src : null;

    // Get username/name from header
    const h1 = document.querySelector('h1');
    const h2 = document.querySelector('h2');

    // Get bio text
    const bioEl = document.querySelector('header span, .-vDIg span');

    // Stats (followers, following, posts)
    const statEls = document.querySelectorAll('header li, [role="main"] li');
    const stats = Array.from(statEls).map(el => el.innerText.trim()).filter(t => t.length > 0);

    // Get post images
    const postImgs = Array.from(document.querySelectorAll('article img, main img')).slice(0, 9).map(img => ({
      src: img.src,
      alt: img.alt
    })).filter(i => i.src && !i.src.includes('data:'));

    return {
      title: document.title,
      metaDescription: getMeta('description') || getMeta('og:description'),
      metaImage: getMeta('og:image'),
      h1: h1 ? h1.innerText : null,
      h2: h2 ? h2.innerText : null,
      profileImgSrc,
      stats,
      postImgs,
      jsonData,
      url: window.location.href
    };
  });

  console.log('Datos extraídos:', JSON.stringify(data, null, 2));

  // Download profile image
  const assetsDir = path.join(__dirname, 'assets');
  if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir);

  let profileImgPath = null;
  const imgUrl = data.profileImgSrc || data.metaImage;
  if (imgUrl && imgUrl.startsWith('http')) {
    try {
      profileImgPath = path.join(assetsDir, 'profile.jpg');
      await downloadImage(imgUrl, profileImgPath);
      console.log('Foto de perfil descargada:', profileImgPath);
    } catch (e) {
      console.log('No se pudo descargar la foto de perfil:', e.message);
    }
  }

  // Download post images
  const postImagePaths = [];
  for (let i = 0; i < Math.min(data.postImgs.length, 9); i++) {
    const img = data.postImgs[i];
    if (img.src && img.src.startsWith('http')) {
      try {
        const imgPath = path.join(assetsDir, `post_${i + 1}.jpg`);
        await downloadImage(img.src, imgPath);
        postImagePaths.push(imgPath);
        console.log(`Post ${i + 1} descargado`);
      } catch (e) {
        console.log(`Error descargando post ${i + 1}:`, e.message);
      }
    }
  }

  await browser.close();

  // Save results
  const result = {
    handle: HANDLE,
    ...data,
    profileImgPath,
    postImagePaths
  };

  fs.writeFileSync(path.join(__dirname, 'instagram-data.json'), JSON.stringify(result, null, 2));
  console.log('\nDatos guardados en instagram-data.json');
  return result;
}

scrapeInstagram().catch(console.error);
