const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');
const xml2js = require('xml2js');
const {MongoClient} = require('mongodb');
const rateLimit = require('express-rate-limit');
const cors = require('cors');

const app = express();
const port = 3000;

app.use(cors());

// Rate limiter
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Previše zahtjeva, pokušajte kasnije.'
});
app.use('/api/', limiter);

// SPAJANJE NA BAZU

const uri = "mongodb+srv://fzuzic:1Gktm5RboV0Nys5t@scrapingapi.yrjp99u.mongodb.net/?retryWrites=true&w=majority&appName=ScrapingAPI&tls=true";
const client = new MongoClient(uri);

let db; // dopušta korištenje db u cijelom api-u

async function connectToDatabase() {
    if (!client.topology || client.topology.isDestroyed()) {
        await client.connect();
    }

    db = client.db("API");
    console.log("✅ Connected to MongoDB");
}



/*
█▀ █▀▀ █▀█ ▄▀█ █▀█ █ █▄ █ █▀▀
▄█ █▄▄ █▀▄ █▀█ █▀▀ █ █ ▀█ █▄█
*/

// NEWS SCRAPING

// provjera ako vijest postoji
async function articleExists(postLink) {
    const result = await db.collection('vjesti').findOne({ link: postLink });
    
    // ako nesto postoji onda vraca true
    // ako nista ne postoji onda vraca false
    return !!result;
}


// spremanje vijest
async function saveArticle(article) {
    const result = await db.collection('vjesti').insertOne(article)

    console.log('✅ Saved:', article.title);
}



async function scrapeNewsPage(pageNumber) {
    try {
      const BASE_URL_NEWS = 'https://www.fiuman.hr/tag/rijeka/page/';

      const { data } = await axios.get(`${BASE_URL_NEWS}${pageNumber}`);
      const $ = cheerio.load(data);
      const articles = [];

      $('.infinite-post').each((i, el) => {
          const postTitle = $(el).find('h2').text().trim();
          const postLink = new URL($(el).find('a').attr('href'), BASE_URL_NEWS).href;
          const postSummary = $(el).find('p').text().trim();
          const postImg = new URL($(el).find('img').attr('src'), BASE_URL_NEWS).href;
          articles.push({ title: postTitle, link: postLink, summary: postSummary, imgsrc : postImg });
      });

      for (const article of articles) {
          // Fetch individual post page
          const { data: postPage } = await axios.get(article.link);
          const $$ = cheerio.load(postPage);

          // Replace with the correct selector for the date
          const postDate = $$('.post-date').attr('datetime'); // adjust this!
          article.postDate = postDate;

          if (!(await articleExists(article.link))) {
              await saveArticle(article);
          }
      
      }
    } catch (err) {
        console.error('Scrape failed:', err);
    }
}



// EVENT SCRAPING


async function getEventXMLsFromSitemap() {
  
  const sitemapUrl = 'https://visitrijeka.hr/sitemap_index.xml';

  // scrape-a sitemap
  const res = await axios.get(sitemapUrl);

  // parsira xml dio sitemape koji se nalazi pod .data kao json
  const parsed = await xml2js.parseStringPromise(res.data);

  // cisti json da ostanu samo linkovi 
  const urls = parsed.sitemapindex.sitemap.map(entry => entry.loc[0]);

  // koristi funkciju za sortiranje linkova
  const linkovi = sortEventUrls(urls);

  return linkovi;
}

function sortEventUrls(sitemaps) {
  // Filtrira url-ove sa "tribe_events-sitemap" u sebi
  const eventSitemaps = sitemaps.filter(url =>
    url.includes('tribe_events-sitemap')
  );

  // Uzima 2 po 2 clana liste, 
  // ako je vracena vrijednost pozitivna b ide ispred a, 
  // ako je negativna, a ide ispred b, 
  // ako su jednake raspored se ne mijenja
  const sorted = eventSitemaps.sort((a, b) => {

    // Pronalazi u stringu "tribe_events-sitemap(neki broj ili nista).xml"
    // odvaja broj ako postoji
    // vraca listu sa stringom i brojem (i jos neke vrijednosti koje nisu bitne za ovo)
    const aMatch = a.match(/tribe_events-sitemap(\d*)\.xml/);
    const bMatch = b.match(/tribe_events-sitemap(\d*)\.xml/);

    // Ako aMatch postoji i postoji broj u listi
    // uzima broj koji je kao string zapisan i pretvara ga u broj
    // ako ne sprema 0
    const aIndex = aMatch && aMatch[1] ? parseInt(aMatch[1]) : 0;
    const bIndex = bMatch && bMatch[1] ? parseInt(bMatch[1]) : 0;

    // odlucuje redoslijed (padajuci)
    return bIndex - aIndex;
  });

  // vraca sortiranu listu sa najvecim brojem na vrhu
  return sorted;
}


async function getUrlsFromSitemap(sitemapUrl) {
  const res = await axios.get(sitemapUrl);
  const parsed = await xml2js.parseStringPromise(res.data);
  return parsed.urlset.url.map(entry => entry.loc[0]);
}


async function geocodeAddress(address) {
  const apiKey = 'AIzaSyAOE3XcToyDYmQIZdNyP66YAb5J5BGNafw';
  const encodedAddress = encodeURIComponent(address);

  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedAddress}&key=${apiKey}`;

  try {
    const res = await axios.get(url);
    const data = res.data;

    if (data.status === 'OK') {
      const location = data.results[0].geometry.location;
      console.log('Geocoding successful')
      return location;
    } else {
      console.error('Geocoding error:', data.status);
      return null;
    }
  } catch (error) {
    console.error('Request failed:', error.message);
  }
}


async function povlacenjeAdrese(urlLokacije) {
  const {data} = await axios.get(urlLokacije);

  const $ = cheerio.load(data);

  const adresa = $('.tribe-street-address').text().trim();
  const grad = $('.tribe-locality').text().trim();

  const punaAdresa = adresa+" "+grad;

  return punaAdresa;
}


function extractISODate(dateStr) {

  // Match all date formats like 30. 5. or 30.5.
  const dateMatch = dateStr.match(/(\d{1,2})\.\s*(\d{1,2})\.?/);

  if (dateMatch.length === 0) return null;

  const [day, month] = dateMatch.slice(1).map(Number);


  const yearMatch = dateStr.match(/\d{1,2}\.\s*\d{1,2}\.\s*(\d{1,4})\./);

  const year = yearMatch ? yearMatch.slice(1).map(Number) : new Date().getFullYear();


  // Optional time
  const timeMatch = dateStr.match(/(\d{1,2}):(\d{2})/);

  console.log(timeMatch);

  const [hour, minute] = timeMatch ? timeMatch.slice(1).map(Number) : [0, 0];

  //return new Date(year, month - 1, day, hour, minute);

  console.log(new Date(year, month - 1, day, hour + 2, minute))
}


async function scrapePage(url) {
  const res = await axios.get(url);

  const $ = cheerio.load(res.data);

  const eventTitle = $('.fusion-title-2').text().trim();
  const eventTekst = $('meta[name="description"]').attr('content');
  const eventImg = $('meta[property="og:image"]').attr('content');

  const eventDate = $('.fusion-text-1').text().trim();

  const hrefCheck = $('.fusion-text-2').find('a').attr('href');
  if (!hrefCheck) {
    return {
      eventTitle,
      eventTekst,
      link: url,
      eventImg,
      eventDate,
      eventLokacija:"NaN"
    };
  }

  const lokacijaURL = new URL(hrefCheck);

  const lokacijaNaziv = $('.fusion-text-2').find('a').text().trim();

  const adresa = await povlacenjeAdrese(lokacijaURL.href);

  const koordinate = await geocodeAddress(adresa);

  return {
    eventTitle,
    eventTekst,
    link: url,
    eventImg,
    eventDate,
    eventLokacija: {
      lokacijaNaziv,
      lokacijaURL: lokacijaURL.href,
      lng: koordinate?.lng ?? null,
      lat: koordinate?.lat ?? null
    }
  };
  
  
}


async function runScraper() {


  const sitemapURLovi = await getEventXMLsFromSitemap();

  for (let i = 0; i < 2; i++) {
    const urls = await getUrlsFromSitemap(sitemapURLovi[i]);

    for (const url of urls) {

      const exists = await db.collection('dogadaji').findOne({ link: url });

      if (!exists) {
        const data = await scrapePage(url);

        await db.collection('dogadaji').insertOne(data);
        console.log(`Saved: ${data.eventTitle}`);

      } else {
        console.log(`Already exists: ${url}`);
      }
      
    }
  }
}



/*
█▀▀ █▀█ █▀█ █▄ █ ▀█▀ █▀▀ █▄ █ █▀▄
█▀  █▀▄ █▄█ █ ▀█  █  ██▄ █ ▀█ █▄▀
*/

app.get('/api/vjesti', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;

        const collection = db.collection('vjesti');

        const data = await collection
            .find({})
            .sort({ postDate: -1 }) // Sort by most recent
            .skip(offset)
            .limit(limit)
            .toArray();
        
        const totalRows = await collection.countDocuments();
        const totalPages = Math.ceil(totalRows / limit);

        res.json({
            page,
            limit,
            totalRows,
            totalPages,
            data
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Greška u serveru' });
    }
});



app.get('/api/dogadaji', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;

        const collection = db.collection('dogadaji');

        const data = await collection
            .find({})
            .sort((a, b) => {

              // Pronalazi u stringu "tribe_events-sitemap(neki broj ili nista).xml"
              // odvaja broj ako postoji
              // vraca listu sa stringom i brojem (i jos neke vrijednosti koje nisu bitne za ovo)
              const aMatch = a.match();
              const bMatch = b.match();

              // Ako aMatch postoji i postoji broj u listi
              // uzima broj koji je kao string zapisan i pretvara ga u broj
              // ako ne sprema 0
              const aIndex = aMatch && aMatch[1] ? parseInt(aMatch[1]) : 0;
              const bIndex = bMatch && bMatch[1] ? parseInt(bMatch[1]) : 0;

              // odlucuje redoslijed (padajuci)
              return bIndex - aIndex;
            })
            .skip(offset)
            .limit(limit)
            .toArray();
        
        const totalRows = await collection.countDocuments();
        const totalPages = Math.ceil(totalRows / limit);

        res.json({
            page,
            limit,
            totalRows,
            totalPages,
            data
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Greška u serveru' });
    }
});


//
async function start() {
    await connectToDatabase();
    //await scrapeNewsPage(1); // run once at startup  

    extractISODate("14. 07. 2027. | 0:30 - 28. 07. | 19:15");
    // --- Scheduler ---
    cron.schedule('0 * * * *', async () => {
        console.log('🕒 Running scheduled scrape...');
        for (let i = 1; i <= 5; i++) {
        await scrapeNewsPage(i);
        }

        await runScraper();
    });

    app.listen(port, () => {
        console.log(`API radi na http://localhost:${port}`);
    });
}

start();
