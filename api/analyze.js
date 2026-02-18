const cheerio = require('cheerio');
const { GoogleGenerativeAI } = require("@google/generative-ai");

export default async function handler(req, res) {
    // Headers para evitar problemas de CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

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
        // 1. SCRAPING (ScraperAPI)
        const scraperUrl = `http://api.scraperapi.com?api_key=${scraperKey}&url=${encodeURIComponent(url)}&render=false`;
        const scrapeRes = await fetch(scraperUrl);
        
        if (!scrapeRes.ok) throw new Error(`Scraper error: ${scrapeRes.status}`);
        
        const html = await scrapeRes.text();

        // 2. CLEANING (Cheerio)
        const $ = cheerio.load(html);
        $('script, style, nav, footer, iframe, svg').remove();
        const text = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 8000); 

        if (text.length < 50) {
            return res.status(200).json({ success: false, error: "Contenido insuficiente o bloqueado" });
        }

        // 3. GEMINI AI
        const genAI = new GoogleGenerativeAI(geminiKey);

        // A) Vectorización: Usamos text-embedding-004 pero forzando la API v1beta
        // IMPORTANTE: gemini-2.5-flash NO genera vectores, solo texto. 
        // Para vectores necesitamos un modelo de "embedding".
        const embedModel = genAI.getGenerativeModel({ 
            model: "text-embedding-004" 
        }, { apiVersion: "v1beta" }); // <--- ESTO ARREGLA EL ERROR 404

        const embedResult = await embedModel.embedContent(text);
        const vector = embedResult.embedding.values;

        // B) Resumen: Usamos el modelo gemini-2.5-flash
        const genModel = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash" 
        }, { apiVersion: "v1beta" });

        const prompt = `Analiza este contenido de ${url}. 
        Responde SOLO un JSON válido con este formato: {"topic": "Tema Principal (1-2 palabras)", "summary": "Resumen de 1 linea"}.
        Texto: ${text.substring(0, 2000)}`;
        
        const genResult = await genModel.generateContent(prompt);
        const responseText = genResult.response.text();
        
        // Limpieza de JSON
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
        console.error("Backend Error:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
}