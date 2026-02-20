const cheerio = require('cheerio');
const fetch = require('node-fetch');

const API_VERSION = "v1beta";
const EMBEDDING_MODEL = "gemini-embedding-001"; 

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
        // --- 1. SCRAPING AVANZADO ---
        const scraperUrl = `http://api.scraperapi.com?api_key=${scraperKey}&url=${encodeURIComponent(url)}&render=false`;
        const scrapeRes = await fetch(scraperUrl);
        if (!scrapeRes.ok) throw new Error(`Scraper status: ${scrapeRes.status}`);
        
        const html = await scrapeRes.text();
        const $ = cheerio.load(html);

        // Extracción enriquecida (Inspirado en mejores prácticas SEO)
        const title = $('title').text().trim() || 'Sin título';
        const description = $('meta[name="description"]').attr('content') || 'Sin descripción';
        const h1 = $('h1').first().text().trim() || 'Sin H1';
        
        // Extraemos hasta tres H2 para entender la estructura de la página
        let h2s = [];
        $('h2').each((i, el) => {
            if (i < 3) h2s.push($(el).text().replace(/\s+/g, ' ').trim());
        });
        const h2Text = h2s.length > 0 ? h2s.join(' | ') : 'Sin H2';

        // Extraemos hasta 2 párrafos consistentes para el contenido principal
        let snippetArr = [];
        $('p').each((i, el) => {
            const texto = $(el).text().replace(/\s+/g, ' ').trim();
            if (texto.length > 60 && snippetArr.length < 2) {
                snippetArr.push(texto);
            }
        });
        let snippet = snippetArr.length > 0 ? snippetArr.join(' ') : "No se encontró contenido principal extenso.";

        // Combinamos todo el contexto para el Embedding
        const textToAnalyze = `Title: ${title}\nDescription: ${description}\nH1: ${h1}\nH2s: ${h2Text}\nContent: ${snippet}`.trim();
        if (textToAnalyze.length < 20) throw new Error("Contenido vacío");

        // --- 2. VECTORES (IA) ---
        const response = await fetch(`https://generativelanguage.googleapis.com/${API_VERSION}/models/${EMBEDDING_MODEL}:embedContent?key=${geminiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: `models/${EMBEDDING_MODEL}`,
                content: { parts: [{ text: textToAnalyze }] },
                taskType: "SEMANTIC_SIMILARITY" 
            })
        });
        
        const embedData = await response.json();
        if (!embedData.embedding) throw new Error(embedData.error?.message || "Sin vector");

        return res.status(200).json({
            success: true,
            data: {
                url,
                vector: embedData.embedding.values,
                extracted: { title, h1, h2: h2Text, snippet }
            }
        });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}