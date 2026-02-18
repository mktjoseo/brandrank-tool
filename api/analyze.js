const cheerio = require('cheerio');
const fetch = require('node-fetch');

// CONFIGURACIÓN
const API_VERSION = "v1beta";
// Usamos el modelo Flash que pediste (versión 1.5 es la actual estable)
const GENERATIVE_MODEL = "gemini-1.5-flash"; 
// Modelo de vectores (intentaremos este, si falla, simulamos)
const EMBEDDING_MODEL = "text-embedding-004"; 

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
    const geminiKey = process.env.GEMINI_API_KEY; // ¡Asegúrate de que en Vercel esté la Key de Google Cloud!

    if (!scraperKey || !geminiKey) return res.status(500).json({ error: 'Faltan API Keys' });

    try {
        // --- PASO 1: SCRAPING DE METADATOS (Tu estrategia ganadora) ---
        const scraperUrl = `http://api.scraperapi.com?api_key=${scraperKey}&url=${encodeURIComponent(url)}&render=false`;
        
        const scrapeRes = await fetch(scraperUrl);
        if (!scrapeRes.ok) throw new Error(`ScraperAPI Error: ${scrapeRes.status}`);
        
        const html = await scrapeRes.text();
        const $ = cheerio.load(html);

        const title = $('title').text().trim() || 'Sin título';
        const description = $('meta[name="description"]').attr('content') || '';
        const h1 = $('h1').first().text().trim() || $('h2').first().text().trim() || '';

        const textToAnalyze = `URL: ${url}\nTitle: ${title}\nDesc: ${description}\nMain H1: ${h1}`.trim();

        if (textToAnalyze.length < 15) {
             return res.status(200).json({ success: false, error: "Contenido vacío" });
        }

        // --- PASO 2: IA CON GOOGLE CLOUD (Modo Resistente) ---

        const callGoogle = async (endpoint, body) => {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await response.json();
            if (!response.ok) {
                const msg = data.error ? data.error.message : response.statusText;
                throw new Error(`Google API (${data.error?.code || response.status}): ${msg}`);
            }
            return data;
        };

        // A) VECTORES (Embedding) - Con Red de Seguridad
        let vector = [];
        let embeddingStatus = "OK";
        
        try {
            // Intentamos la vía oficial
            const embedUrl = `https://generativelanguage.googleapis.com/${API_VERSION}/models/${EMBEDDING_MODEL}:embedContent?key=${geminiKey}`;
            const data = await callGoogle(embedUrl, {
                content: { parts: [{ text: textToAnalyze }] }
            });
            
            if (data.embedding && data.embedding.values) {
                vector = data.embedding.values;
            } else {
                throw new Error("Vector vacío");
            }

        } catch (e) {
            console.error(`[WARN] Fallo Embedding (${e.message}). Activando simulación.`);
            embeddingStatus = `Simulado (Error: ${e.message})`;
            
            // GENERAMOS UN VECTOR FALSO para que la app NO se detenga.
            // Esto permitirá ver el Título, H1 y el Análisis de Texto aunque el gráfico sea inexacto.
            vector = Array.from({length: 768}, () => Math.random() - 0.5);
        }

        // B) ANÁLISIS DE TEXTO (Usando Flash 1.5)
        let aiData = { topic: "General", summary: title };
        try {
            const genUrl = `https://generativelanguage.googleapis.com/${API_VERSION}/models/${GENERATIVE_MODEL}:generateContent?key=${geminiKey}`;
            
            const prompt = `Analiza estos datos SEO de una web.
            Responde SOLO un JSON válido: {"topic": "Tema Principal (máx 3 palabras)", "summary": "De qué trata (1 frase corta)"}.
            Datos: ${textToAnalyze}`;

            const data = await callGoogle(genUrl, { contents: [{ parts: [{ text: prompt }] }] });
            
            let raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (raw) {
                raw = raw.replace(/```json|```/g, '').trim();
                aiData = JSON.parse(raw);
            }
        } catch (e) {
            console.warn("Fallo resumen:", e.message);
            aiData.summary = "Error analizando texto";
        }

        return res.status(200).json({
            success: true,
            data: {
                url,
                vector, // Lleva el vector real O el simulado
                topic: aiData.topic,
                summary: aiData.summary,
                debug_embedding: embeddingStatus
            }
        });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}