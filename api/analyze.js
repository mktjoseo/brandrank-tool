const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { GoogleGenerativeAI } = require("@google/generative-ai");

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

    const { url, domain } = req.body;
    
    // Configuración APIs
    const scraperKey = process.env.SCRAPERAPI_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;

    if (!scraperKey || !geminiKey) return res.status(500).json({ error: 'Faltan API Keys' });

    try {
        // 1. SCRAPING
        // Usamos ScraperAPI para evitar bloqueos
        const scraperUrl = `http://api.scraperapi.com?api_key=${scraperKey}&url=${encodeURIComponent(url)}&render=false`;
        const scrapeRes = await fetch(scraperUrl);
        const html = await scrapeRes.text();

        // 2. CLEANING (Cheerio)
        const $ = cheerio.load(html);
        $('script, style, nav, footer, iframe').remove();
        const text = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 8000); // Limitamos tokens

        if (text.length < 50) throw new Error("Contenido insuficiente");

        // 3. VECTORIZACIÓN (Gemini)
        const genAI = new GoogleGenerativeAI(geminiKey);
        const model = genAI.getGenerativeModel({ model: "embedding-001" });
        
        const result = await model.embedContent(text);
        const vector = result.embedding.values;

        // 4. CLASIFICACIÓN SIMPLE (Opcional: Pedir a Gemini que clasifique el texto)
        // Para ahorrar tiempo/tokens, por ahora devolvemos 'General' o analizamos palabras clave simples
        let topic = 'General';
        if (text.toLowerCase().includes('seo')) topic = 'SEO';
        // (Aquí podrías hacer otra llamada a Gemini Flash para clasificar el texto)

        return res.status(200).json({
            success: true,
            data: {
                url,
                vector,
                topic, // Podrías mejorar esto con otra llamada a Gemini
                summary: text.substring(0, 100) + '...'
            }
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ success: false, error: error.message });
    }
}