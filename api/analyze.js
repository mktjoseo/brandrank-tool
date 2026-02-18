const cheerio = require('cheerio');
const fetch = require('node-fetch');

// CONFIGURACIÓN DE MODELOS
const API_VERSION = "v1beta";
const EMBEDDING_MODEL = "text-embedding-004"; 
const GENERATIVE_MODEL = "gemini-1.5-flash";   

export default async function handler(req, res) {
    // 1. Headers de Seguridad y CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.status(200).end(); return; }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const { url } = req.body;
    const scraperKey = process.env.SCRAPERAPI_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;

    // Validación de Keys
    if (!scraperKey) return res.status(500).json({ error: 'Falta SCRAPERAPI_KEY' });
    if (!geminiKey) return res.status(500).json({ error: 'Falta GEMINI_API_KEY' });

    try {
        // --- PASO 1: SCRAPING DE METADATOS ---
        // console.log(`[DEBUG] Conectando a ScraperAPI para: ${url}`);
        const scraperUrl = `http://api.scraperapi.com?api_key=${scraperKey}&url=${encodeURIComponent(url)}&render=false`;
        
        const scrapeRes = await fetch(scraperUrl);
        if (!scrapeRes.ok) throw new Error(`ScraperAPI falló con status: ${scrapeRes.status}`);
        
        const html = await scrapeRes.text();
        const $ = cheerio.load(html);

        // Extracción: Título, Meta Descripción y H1
        const title = $('title').text().trim() || 'Sin título';
        const description = $('meta[name="description"]').attr('content') || '';
        const h1 = $('h1').first().text().trim() || $('h2').first().text().trim() || '';

        // Texto limpio para la IA
        const textToAnalyze = `Title: ${title}\nDesc: ${description}\nHeader: ${h1}`.trim();

        // Si no hay texto útil, avisamos
        if (textToAnalyze.length < 10) {
             return res.status(200).json({ success: false, error: "Web vacía (Posible bloqueo JS)" });
        }

        // --- PASO 2: LLAMADA A GOOGLE (Con reporte de errores detallado) ---
        
        const callGoogle = async (endpoint, body) => {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            
            const data = await response.json();
            
            // AQUÍ ESTÁ EL CAMBIO CLAVE:
            // Si falla, devolvemos el mensaje EXACTO de Google
            if (!response.ok) {
                console.error("[GOOGLE ERROR DETAIL]:", JSON.stringify(data)); // Esto sale en los logs de Vercel
                const errMsg = data.error ? data.error.message : response.statusText;
                throw new Error(`Google dice: ${errMsg} (Code: ${data.error?.code || response.status})`);
            }
            return data;
        };

        // A) VECTOR (Embedding)
        let vector = [];
        const embedUrl = `https://generativelanguage.googleapis.com/${API_VERSION}/models/${EMBEDDING_MODEL}:embedContent?key=${geminiKey}`;
        
        try {
            const data = await callGoogle(embedUrl, {
                model: `models/${EMBEDDING_MODEL}`,
                content: { parts: [{ text: textToAnalyze }] }
            });
            vector = data.embedding.values;
        } catch (e) {
            // Pasamos el error exacto al frontend
            throw new Error(e.message);
        }

        // B) RESUMEN (Opcional)
        let aiData = { topic: "General", summary: title };
        try {
            const genUrl = `https://generativelanguage.googleapis.com/${API_VERSION}/models/${GENERATIVE_MODEL}:generateContent?key=${geminiKey}`;
            const prompt = `Analiza: ${textToAnalyze}. JSON: {"topic": "Tema (2 palabras)", "summary": "Resumen (1 linea)"}`;

            const data = await callGoogle(genUrl, { contents: [{ parts: [{ text: prompt }] }] });
            let raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (raw) {
                raw = raw.replace(/```json|```/g, '').trim();
                aiData = JSON.parse(raw);
            }
        } catch (e) {
            console.warn("Error menor generando resumen:", e.message);
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
        // Este log es el que verás en la consola de Vercel
        console.error("SERVER ERROR:", error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
}