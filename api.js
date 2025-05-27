const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');
const {MongoClient} = require('mongodb');


const uri = "mongodb+srv://fzuzic:1Gktm5RboV0Nys5t@scrapingapi.yrjp99u.mongodb.net/?retryWrites=true&w=majority&appName=ScrapingAPI";


const client = new MongoClient(uri);

let db; // this will hold your active DB instance

async function connectToDatabase() {
    if (!client.topology || client.topology.isDestroyed()) {
        await client.connect();
    }

    db = client.db("API");
    console.log("✅ Connected to MongoDB");
}

// --- In-memory mock DB ---
const storedLinks = new Set();

async function articleExists(postLink) {
    const result = await db.collection('vjesti').findOne({ link: postLink });
    return !!result;
}

async function saveArticle(article) {
    const result = await db.collection('vjesti').insertOne(article)

    console.log('✅ Saved:', article.title);
}

// --- News scraping logic ---
const BASE_URL_NEWS = 'https://www.fiuman.hr/tag/rijeka/page/';

async function scrapeNewsPage(pageNumber) {
    try {

        const { data } = await axios.get(`${BASE_URL_NEWS}${pageNumber}`);
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

// --- Event scraping logic ---
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
}

start();
