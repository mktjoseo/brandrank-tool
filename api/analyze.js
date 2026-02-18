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

    if (!scraperKey || !geminiKey) return res.status(500).json({ error: 'Faltan API Keys' });

    try {
        // --- PASO 1: SCRAPING LIGERO (Táctica "Low Cost") ---
        // Seguimos usando render=false porque Title/Meta suelen estar en el HTML crudo
        const scraperUrl = `http://api.scraperapi.com?api_key=${scraperKey}&url=${encodeURIComponent(url)}&render=false`;
        
        console.log(`[DEBUG] Scrapeando metadata de: ${url}`);
        const scrapeRes = await fetch(scraperUrl);
        if (!scrapeRes.ok) throw new Error(`Error ScraperAPI: ${scrapeRes.status}`);
        
        const html = await scrapeRes.text();
        const $ = cheerio.load(html);

        // --- PASO 2: EXTRACCIÓN QUIRÚRGICA (Tu idea) ---
        const title = $('title').text().trim();
        const description = $('meta[name="description"]').attr('content') || '';
        // Buscamos el primer H1, si no hay, buscamos el primer H2
        const h1 = $('h1').first().text().trim() || $('h2').first().text().trim();

        // Construimos el texto "denso" para la IA
        const textToAnalyze = `
        URL: ${url}
        Page Title: ${title}
        Meta Description: ${description}
        Main Heading: ${h1}
        `.trim();

        console.log(`[DEBUG] Contenido extraído:\n${textToAnalyze}`);

        // Validación simple: Si no hay título ni H1, algo salió mal
        if (textToAnalyze.length < 50) {
             return res.status(200).json({ success: false, error: "No se detectaron metadatos (Web bloqueada o vacía)" });
        }

        // --- PASO 3: IA (Solo Embedding-004) ---
        
        const callGoogle = async (endpoint, body) => {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await response.json();
            if (!response.ok) {
                const msg = data.error ? `${data.error.code} - ${data.error.message}` : response.statusText;
                throw new Error(`Google API: ${msg}`);
            }
            return data;
        };

        // A) VECTOR (Embedding)
        let vector = [];
        const embedUrl = `https://generativelanguage.googleapis.com/${API_VERSION}/models/${EMBEDDING_MODEL}:embedContent?key=${geminiKey}`;
        
        try {
            const data = await callGoogle(embedUrl, {
                model: `models/${EMBEDDING_MODEL}`,
                content: { parts: [{ text: textToAnalyze }] } // Enviamos solo lo importante
            });
            vector = data.embedding.values;
        } catch (e) {
            console.error(`Error Embedding: ${e.message}`);
            throw new Error("Fallo al crear vector. Revisa la API Key de Google.");
        }

        // B) RESUMEN (Opcional, pero útil para ver qué entendió la IA)
        let aiData = { topic: "General", summary: "" };
        try {
            const genUrl = `https://generativelanguage.googleapis.com/${API_VERSION}/models/${GENERATIVE_MODEL}:generateContent?key=${geminiKey}`;
            const prompt = `Analiza estos metadatos SEO.
            Responde JSON: {"topic": "Tema principal (2 palabras)", "summary": "De qué trata la URL (1 frase)"}.
            Datos: ${textToAnalyze}`;

            const data = await callGoogle(genUrl, { contents: [{ parts: [{ text: prompt }] }] });
            let raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (raw) {
                raw = raw.replace(/```json|```/g, '').trim();
                aiData = JSON.parse(raw);
            }
        } catch (e) {
            // Ignoramos error en resumen, no es crítico
        }

        return res.status(200).json({
            success: true,
            data: {
                url,
                vector,
                topic: aiData.topic,
                summary: aiData.summary || title // Si falla el resumen, usamos el título
            }
        });

    } catch (error) {
        console.error("SERVER ERROR:", error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
}