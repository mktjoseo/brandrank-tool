const cheerio = require('cheerio');
const fetch = require('node-fetch');

// CONFIGURACIÓN
const API_VERSION = "v1beta";
// Intentamos con el modelo estándar. Si falla, el log nos dirá cuál usar.
const EMBEDDING_MODEL = "text-embedding-004"; 
const GENERATIVE_MODEL = "gemini-1.5-flash";   

export default async function handler(req, res) {
    // CORS y Headers
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.status(200).end(); return; }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const { url } = req.body;
    const scraperKey = process.env.SCRAPERAPI_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;

    if (!scraperKey || !geminiKey) return res.status(500).json({ error: 'Faltan API Keys' });

    try {
        // --- PASO 1: SCRAPING (Tu lógica optimizada) ---
        const scraperUrl = `http://api.scraperapi.com?api_key=${scraperKey}&url=${encodeURIComponent(url)}&render=false`;
        
        const scrapeRes = await fetch(scraperUrl);
        if (!scrapeRes.ok) throw new Error(`ScraperAPI status: ${scrapeRes.status}`);
        
        const html = await scrapeRes.text();
        const $ = cheerio.load(html);

        const title = $('title').text().trim() || 'Sin título';
        const description = $('meta[name="description"]').attr('content') || '';
        const h1 = $('h1').first().text().trim() || $('h2').first().text().trim() || '';

        const textToAnalyze = `Title: ${title}\nDesc: ${description}\nHeader: ${h1}`.trim();

        if (textToAnalyze.length < 10) {
             return res.status(200).json({ success: false, error: "Web vacía" });
        }

        // --- PASO 2: CONEXIÓN CON GOOGLE ---

        // Función para listar modelos si algo falla (Autodiagnóstico)
        const listAvailableModels = async () => {
            try {
                const listUrl = `https://generativelanguage.googleapis.com/${API_VERSION}/models?key=${geminiKey}`;
                const r = await fetch(listUrl);
                const d = await r.json();
                if(d.models) {
                    // Filtramos solo los que sirven para embedding
                    const embeds = d.models.filter(m => m.name.includes('embed'));
                    console.log("--- MODELOS DISPONIBLES PARA TU KEY ---");
                    console.log(embeds.map(m => m.name).join(', '));
                    console.log("---------------------------------------");
                }
            } catch (e) { console.error("No se pudo listar modelos:", e.message); }
        };

        const callGoogle = async (endpoint, body) => {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await response.json();
            if (!response.ok) {
                // Si falla, intentamos ver qué modelos hay disponibles antes de lanzar el error
                await listAvailableModels();
                const msg = data.error ? data.error.message : response.statusText;
                throw new Error(`Google API (${data.error?.code}): ${msg}`);
            }
            return data;
        };

        // A) VECTOR
        let vector = [];
        const embedUrl = `https://generativelanguage.googleapis.com/${API_VERSION}/models/${EMBEDDING_MODEL}:embedContent?key=${geminiKey}`;
        
        try {
            // CORRECCIÓN PRINCIPAL: 
            // NO enviamos 'model' dentro del body, solo 'content'.
            // A veces enviarlo duplicado causa el error 404.
            const data = await callGoogle(embedUrl, {
                content: { parts: [{ text: textToAnalyze }] }
            });
            vector = data.embedding.values;
        } catch (e) {
            console.error(e.message);
            throw new Error(e.message);
        }

        // B) RESUMEN
        let aiData = { topic: "General", summary: title };
        try {
            const genUrl = `https://generativelanguage.googleapis.com/${API_VERSION}/models/${GENERATIVE_MODEL}:generateContent?key=${geminiKey}`;
            const prompt = `Analiza: ${textToAnalyze}. JSON: {"topic": "Tema (2 palabras)", "summary": "Resumen corto"}`;
            const data = await callGoogle(genUrl, { contents: [{ parts: [{ text: prompt }] }] });
            
            let raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (raw) {
                raw = raw.replace(/```json|```/g, '').trim();
                aiData = JSON.parse(raw);
            }
        } catch (e) { /* Silencioso */ }

        return res.status(200).json({
            success: true,
            data: { url, vector, topic: aiData.topic, summary: aiData.summary }
        });

    } catch (error) {
        console.error("SERVER ERROR:", error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
}