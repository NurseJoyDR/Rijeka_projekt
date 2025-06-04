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





// provjera ako vijest postoji
async function articleExists(postLink) {
    const result = await db.collection('vjesti').findOne({ link: postLink });
    return !!result;
}


// spremanje vijest
async function saveArticle(article) {
    const result = await db.collection('vjesti').insertOne(article)

    console.log('✅ Saved:', article.title);
}



/*
█▀ █▀▀ █▀█ ▄▀█ █▀█ █ █▄ █ █▀▀
▄█ █▄▄ █▀▄ █▀█ █▀▀ █ █ ▀█ █▄█
*/

// NEWS SCRAPING
const BASE_URL_NEWS = 'https://www.fiuman.hr/tag/rijeka/page/';

async function scrapeNewsPage(pageNumber) {
    try {

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
const BASE_URL_EVENT = 'https://www.fiuman.hr/tag/rijeka/page/';

async function scrapeNewsPage(pageNumber) {
    try {

        const { data } = await axios.get(`${BASE_URL_EVENT}${pageNumber}`);
        const $ = cheerio.load(data);
        const articles = [];

        $('.infinite-post').each((i, el) => {
            const postTitle = $(el).find('h2').text().trim();
            const postLink = new URL($(el).find('a').attr('href'), BASE_URL).href;
            const postSummary = $(el).find('p').text().trim();
            const postImg = new URL($(el).find('img').attr('src'), BASE_URL).href;
            articles.push({ title: postTitle, link: postLink, summary: postSummary, imgsrc : postImg });
        });

        for (const article of articles) {
        
        if (!(await articleExists(article.link))) {
            await saveArticle(article);
        }
        
        }
    } catch (err) {
        console.error('Scrape failed:', err);
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


//
async function start() {
    await connectToDatabase();
    await scrapeNewsPage(1); // run once at startup

    // --- Scheduler ---
    cron.schedule('0 * * * *', async () => {
        console.log('🕒 Running scheduled scrape...');
        for (let i = 1; i <= 5; i++) {
        await scrapeNewsPage(i);
        }
    });

    app.listen(port, () => {
        console.log(`API radi na http://localhost:${port}`);
    });
}

start();
