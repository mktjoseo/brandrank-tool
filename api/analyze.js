const cheerio = require('cheerio');
const fetch = require('node-fetch');

const API_VERSION = "v1beta";
const EMBEDDING_MODEL = "text-embedding-004"; 
const GENERATIVE_MODEL = "gemini-1.5-flash";   

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.status(200).end(); return; }

    const { url } = req.body;
    const scraperKey = process.env.SCRAPERAPI_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;

    if (!scraperKey || !geminiKey) return res.status(500).json({ error: 'Faltan API Keys' });

    try {
        // 1. SCRAPING
        const scraperUrl = `http://api.scraperapi.com?api_key=${scraperKey}&url=${encodeURIComponent(url)}&render=false`;
        const scrapeRes = await fetch(scraperUrl);
        if (!scrapeRes.ok) throw new Error(`Scraper status: ${scrapeRes.status}`);
        
        const html = await scrapeRes.text();
        const $ = cheerio.load(html);

        const title = $('title').text().trim();
        const description = $('meta[name="description"]').attr('content') || '';
        const h1 = $('h1').first().text().trim() || $('h2').first().text().trim();

        // LOGGING: Esto es lo que verá tu consola negra
        const textToAnalyze = `URL: ${url}\nTitle: ${title}\nDesc: ${description}\nMain H1: ${h1}`.trim();

        if (textToAnalyze.length < 20) throw new Error("Contenido vacío (Scraping falló)");

        // 2. IA (Google)
        const callGoogle = async (endpoint, body) => {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error?.message || response.statusText);
            return data;
        };

        // A) VECTOR
        const embedUrl = `https://generativelanguage.googleapis.com/${API_VERSION}/models/${EMBEDDING_MODEL}:embedContent?key=${geminiKey}`;
        const embedData = await callGoogle(embedUrl, {
            content: { parts: [{ text: textToAnalyze }] }
        });

        // B) TOPIC (Resumen)
        let aiData = { topic: "General", summary: title };
        try {
            const genUrl = `https://generativelanguage.googleapis.com/${API_VERSION}/models/${GENERATIVE_MODEL}:generateContent?key=${geminiKey}`;
            const prompt = `Analiza: ${textToAnalyze}. Responde JSON: {"topic": "Tema (max 2 palabras)", "summary": "De qué trata (1 frase)"}`;
            const genData = await callGoogle(genUrl, { contents: [{ parts: [{ text: prompt }] }] });
            let raw = genData.candidates?.[0]?.content?.parts?.[0]?.text;
            if (raw) aiData = JSON.parse(raw.replace(/```json|```/g, '').trim());
        } catch(e) {}

        return res.status(200).json({
            success: true,
            data: {
                url,
                vector: embedData.embedding.values,
                topic: aiData.topic,
                summary: aiData.summary,
                debug_text: textToAnalyze // Enviamos el texto crudo para verificar
            }
        });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}