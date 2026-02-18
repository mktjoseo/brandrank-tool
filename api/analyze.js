const cheerio = require('cheerio');
const fetch = require('node-fetch');

// CONFIGURACIÓN OFICIAL
const API_VERSION = "v1beta";
const EMBEDDING_MODEL = "text-embedding-004"; 
const GENERATIVE_MODEL = "gemini-1.5-flash";   

export default async function handler(req, res) {
    // 1. Configuración CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.status(200).end(); return; }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const { url } = req.body;
    const scraperKey = process.env.SCRAPERAPI_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;

    if (!scraperKey || !geminiKey) return res.status(500).json({ error: 'Faltan API Keys en Vercel' });

    try {
        // --- PASO 1: SCRAPING DE METADATOS (Estrategia Rápida) ---
        // console.log(`[DEBUG] Procesando: ${url}`);
        
        // Estrategia: "Low Cost & High Speed". No renderizamos JS.
        const scraperUrl = `http://api.scraperapi.com?api_key=${scraperKey}&url=${encodeURIComponent(url)}&render=false`;
        
        const scrapeRes = await fetch(scraperUrl);
        if (!scrapeRes.ok) throw new Error(`ScraperAPI Error: ${scrapeRes.status}`);
        
        const html = await scrapeRes.text();
        const $ = cheerio.load(html);

        // Extracción robusta de lo que realmente importa para SEO
        const title = $('title').text().trim() || '';
        const description = $('meta[name="description"]').attr('content') || '';
        // Buscamos H1, si falla H2, si falla OpenGraph Title
        const h1 = $('h1').first().text().trim() || $('h2').first().text().trim() || $('meta[property="og:title"]').attr('content') || '';

        // Texto condensado para la IA
        const textToAnalyze = `
        URL: ${url}
        Title: ${title}
        Description: ${description}
        Main Header: ${h1}
        `.trim();

        // Si después de todo esto no hay texto (menos de 10 chars), la web está muerta o bloqueada totalmente
        if (textToAnalyze.length < 15) {
             return res.status(200).json({ success: false, error: "Contenido ilegible o vacío" });
        }

        // --- PASO 2: INTELIGENCIA ARTIFICIAL (GOOGLE) ---

        const callGoogle = async (endpoint, body) => {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await response.json();
            if (!response.ok) {
                const msg = data.error ? data.error.message : response.statusText;
                throw new Error(`Google API Error (${data.error?.code || response.status}): ${msg}`);
            }
            return data;
        };

        // A) VECTORES (Embedding)
        let vector = [];
        try {
            const embedUrl = `https://generativelanguage.googleapis.com/${API_VERSION}/models/${EMBEDDING_MODEL}:embedContent?key=${geminiKey}`;
            
            const data = await callGoogle(embedUrl, {
                content: { parts: [{ text: textToAnalyze }] }
            });
            
            if (data.embedding && data.embedding.values) {
                vector = data.embedding.values;
            } else {
                throw new Error("Vector vacío recibido de Google");
            }
        } catch (e) {
            console.error("Error Embedding:", e.message);
            // Si falla, devolvemos el error exacto para que lo veas en pantalla
            throw new Error(`Fallo IA: ${e.message}`);
        }

        // B) CLASIFICACIÓN (Topic y Resumen)
        let aiData = { topic: "General", summary: title };
        try {
            const genUrl = `https://generativelanguage.googleapis.com/${API_VERSION}/models/${GENERATIVE_MODEL}:generateContent?key=${geminiKey}`;
            const prompt = `Analiza estos metadatos SEO.
            Responde SOLO JSON válido: {"topic": "Tema Principal (2-3 palabras)", "summary": "Resumen muy breve"}.
            Datos: ${textToAnalyze}`;

            const data = await callGoogle(genUrl, { contents: [{ parts: [{ text: prompt }] }] });
            let raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (raw) {
                raw = raw.replace(/```json|```/g, '').trim(); // Limpieza de markdown
                aiData = JSON.parse(raw);
            }
        } catch (e) {
            // El resumen es secundario, no rompemos el flujo si falla
            console.warn("Fallo resumen:", e.message);
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
        console.error("SERVER ERROR:", error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
}