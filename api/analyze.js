// api/analyze.js - Usando fetch nativo y Gemini Flash

const cheerio = require('cheerio');
const { GoogleGenerativeAI } = require("@google/generative-ai");

export default async function handler(req, res) {
    // Headers CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const { url, domain } = req.body;
    
    const scraperKey = process.env.SCRAPERAPI_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;

    if (!scraperKey || !geminiKey) return res.status(500).json({ error: 'Faltan API Keys' });

    try {
        // 1. SCRAPING
        const scraperUrl = `http://api.scraperapi.com?api_key=${scraperKey}&url=${encodeURIComponent(url)}&render=false`;
        const scrapeRes = await fetch(scraperUrl);
        
        if (!scrapeRes.ok) throw new Error(`Scraper error: ${scrapeRes.status}`);
        
        const html = await scrapeRes.text();

        // 2. CLEANING
        const $ = cheerio.load(html);
        $('script, style, nav, footer, iframe, svg').remove();
        // Limitamos texto para no saturar tokens
        const text = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 5000); 

        if (text.length < 50) {
            return res.status(200).json({ success: false, error: "Contenido insuficiente o bloqueado" });
        }

        // 3. GEMINI AI
        const genAI = new GoogleGenerativeAI(geminiKey);

        // A) Vectorización (Usamos modelo de embeddings específico)
        const embedModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
        const embedResult = await embedModel.embedContent(text);
        const vector = embedResult.embedding.values;

        // B) Clasificación y Resumen (Usamos modelo Flash Generativo)
        const genModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const prompt = `Analiza este texto extraído de ${url}. 
        1. Identifica el tema principal en 1 o 2 palabras (ej: SEO, Cocina, Finanzas).
        2. Resume de qué trata en 1 frase corta.
        Responde SOLO en formato JSON así: {"topic": "Tema", "summary": "Resumen corto"}`;
        
        const genResult = await genModel.generateContent(prompt);
        const responseText = genResult.response.text();
        
        // Limpieza básica del JSON por si el modelo añade markdown
        let aiData = { topic: "General", summary: "Análisis pendiente" };
        try {
            const cleanJson = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
            aiData = JSON.parse(cleanJson);
        } catch (e) {
            console.error("Error parsing JSON from Gemini", e);
        }

        return res.status(200).json({
            success: true,
            data: {
                url,
                vector,
                topic: aiData.topic,
                summary: aiData.summary
            }
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ success: false, error: error.message });
    }
}