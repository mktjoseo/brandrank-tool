import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

// CONFIGURACIÓN EXACTA DE MODELOS
const API_VERSION = "v1beta";
const EMBEDDING_MODEL = "text-embedding-004"; 
const GENERATIVE_MODEL = "gemini-1.5-flash";   

export default async function handler(req, res) {
    // 1. CONFIGURACIÓN CORS (Para que no te bloquee el navegador)
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Responder OK a las verificaciones del navegador
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const { url } = req.body;
    
    // Verificación de API Keys
    const scraperKey = process.env.SCRAPERAPI_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;

    if (!scraperKey || !geminiKey) {
        return res.status(500).json({ error: 'Faltan las API Keys en el servidor (.env)' });
    }

    try {
        // --- PASO 1: SCRAPING (Optimizado para velocidad) ---
        // Usamos 'autoparse=true' para que ScraperAPI limpie por nosotros si puede
        const scraperUrl = `http://api.scraperapi.com?api_key=${scraperKey}&url=${encodeURIComponent(url)}&autoparse=true`;
        
        const response = await fetch(scraperUrl);
        if (!response.ok) throw new Error(`Error ScraperAPI: ${response.status}`);
        
        const html = await response.text();

        // Limpieza manual con Cheerio para asegurar solo texto útil
        const $ = cheerio.load(html);
        $('script, style, nav, footer, iframe, svg, noscript').remove();
        let text = $('body').text().replace(/\s+/g, ' ').trim();
        
        // Cortamos a 8000 caracteres para no saturar a Gemini
        text = text.substring(0, 8000);

        if (text.length < 50) {
            throw new Error("El contenido extraído está vacío o es muy corto.");
        }

        // Helper para llamadas a Google
        const callGoogle = async (endpoint, body) => {
            const resp = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const json = await resp.json();
            if (!resp.ok) {
                throw new Error(`Google API Error: ${json.error?.message || resp.statusText}`);
            }
            return json;
        };

        // --- PASO 2: EMBEDDING (Vectorización) ---
        // CORRECCIÓN CRÍTICA: La URL debe coincidir con el modelo
        const embedUrl = `https://generativelanguage.googleapis.com/${API_VERSION}/models/${EMBEDDING_MODEL}:embedContent?key=${geminiKey}`;
        
        const embedData = await callGoogle(embedUrl, {
            model: `models/${EMBEDDING_MODEL}`,
            content: { parts: [{ text: text }] }
        });

        const vector = embedData.embedding?.values;
        if (!vector) throw new Error("Google no devolvió el vector.");

        // --- PASO 3: ANÁLISIS DE TEMA (Generativo) ---
        let aiData = { topic: "General", summary: "Sin resumen" };
        
        try {
            const genUrl = `https://generativelanguage.googleapis.com/${API_VERSION}/models/${GENERATIVE_MODEL}:generateContent?key=${geminiKey}`;
            
            // Prompt blindado contra errores de formato
            const prompt = `Analiza este texto web.
            Devuelve SOLO un JSON válido: {"topic": "Tema Principal (max 3 palabras)", "summary": "Resumen corto"}.
            No uses Markdown. No uses bloques de código.
            Texto: ${text.substring(0, 2000)}`;

            const genData = await callGoogle(genUrl, {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { responseMimeType: "application/json" }
            });

            let rawText = genData.candidates?.[0]?.content?.parts?.[0]?.text;
            
            // LIMPIEZA CRÍTICA: Quitamos cualquier rastro de Markdown que rompa el JSON
            if (rawText) {
                rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
                aiData = JSON.parse(rawText);
            }
        } catch (e) {
            console.warn("Fallo leve en resumen:", e.message);
            // No detenemos la app si falla el resumen, el vector es lo importante
        }

        // --- RESPUESTA FINAL ---
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
        return res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
}