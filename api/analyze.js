const cheerio = require('cheerio');
const fetch = require('node-fetch'); // Usamos la librería que te funciona

// CONFIGURACIÓN DE MODELOS
const API_VERSION = "v1beta";
const EMBEDDING_MODEL = "text-embedding-004"; 
const GENERATIVE_MODEL = "gemini-1.5-flash";   

export default async function handler(req, res) {
    // 1. CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const { url } = req.body;
    const scraperKey = process.env.SCRAPERAPI_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;

    if (!scraperKey || !geminiKey) return res.status(500).json({ error: 'Faltan API Keys en Vercel' });

    try {
        // --- PASO 1: SCRAPING ---
        const scraperUrl = `http://api.scraperapi.com?api_key=${scraperKey}&url=${encodeURIComponent(url)}&render=false`;
        const scrapeRes = await fetch(scraperUrl);
        
        if (!scrapeRes.ok) throw new Error(`Error ScraperAPI: ${scrapeRes.status}`);
        
        const html = await scrapeRes.text();

        // --- PASO 2: LIMPIEZA HTML ---
        const $ = cheerio.load(html);
        $('script, style, nav, footer, iframe, svg, noscript, header, aside').remove();
        let text = $('body').text().replace(/\s+/g, ' ').trim();
        text = text.substring(0, 8000); 

        if (text.length < 50) return res.status(200).json({ success: false, error: "Contenido vacío" });

        // --- PASO 3: IA (REST API DIRECTA con NODE-FETCH) ---

        // Función auxiliar para llamar a Google y VER EL ERROR REAL
        const callGoogle = async (url, body) => {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await response.json();
            if (!response.ok) {
                // Devolvemos el error detallado de Google para verlo en consola
                const msg = data.error ? `${data.error.code} - ${data.error.message}` : response.statusText;
                throw new Error(msg);
            }
            return data;
        };

        // A) VECTORES (Embedding)
        let vector = [];
        try {
            // Intento 1: Modelo Nuevo
            const embedUrl = `https://generativelanguage.googleapis.com/${API_VERSION}/models/${EMBEDDING_MODEL}:embedContent?key=${geminiKey}`;
            const data = await callGoogle(embedUrl, {
                model: `models/${EMBEDDING_MODEL}`,
                content: { parts: [{ text: text }] }
            });
            vector = data.embedding.values;
        } catch (e) {
            console.warn(`Fallo embedding 004 (${e.message}), intentando fallback...`);
            
            // Intento 2: Modelo Viejo
            try {
                const fallbackUrl = `https://generativelanguage.googleapis.com/v1/models/embedding-001:embedContent?key=${geminiKey}`;
                const data = await callGoogle(fallbackUrl, {
                    model: "models/embedding-001",
                    content: { parts: [{ text: text }] }
                });
                vector = data.embedding.values;
            } catch (e2) {
                // AQUÍ ESTÁ LA CLAVE: Lanzamos el error exacto de Google al frontend
                throw new Error(`Google API Error: ${e2.message}`);
            }
        }

        // B) TEXTO (Resumen JSON)
        let aiData = { topic: "General", summary: "No disponible" };
        try {
            const genUrl = `https://generativelanguage.googleapis.com/${API_VERSION}/models/${GENERATIVE_MODEL}:generateContent?key=${geminiKey}`;
            const data = await callGoogle(genUrl, {
                contents: [{ parts: [{ text: `Analiza este texto. JSON {"topic": "Tema", "summary": "Resumen"}. Texto: ${text.substring(0, 2000)}` }] }],
                generationConfig: { responseMimeType: "application/json" }
            });
            
            const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (rawText) aiData = JSON.parse(rawText);
        } catch (e) {
            console.error("Error Generativo:", e.message);
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
        console.error("CRITICAL BACKEND ERROR:", error.message);
        // Devolvemos el mensaje exacto al frontend
        return res.status(500).json({ success: false, error: error.message });
    }
}