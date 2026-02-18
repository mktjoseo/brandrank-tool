import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

// CONFIGURACIÓN DE MODELOS (Fijamos las versiones correctas)
const API_VERSION = "v1beta";
const EMBEDDING_MODEL = "text-embedding-004"; 
const GENERATIVE_MODEL = "gemini-1.5-flash";   

export default async function handler(req, res) {
    // 1. CONFIGURACIÓN DE CORS (Permisos para que el navegador conecte)
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Si es una petición de verificación (OPTIONS), respondemos OK y salimos
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const { url } = req.body;
    const scraperKey = process.env.SCRAPERAPI_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;

    if (!scraperKey || !geminiKey) {
        return res.status(500).json({ error: 'Faltan API Keys en la configuración del servidor (Vercel ENV)' });
    }

    try {
        // --- PASO 1: SCRAPING (Optimizado) ---
        // Usamos autoparse=true para que sea más rápido y render=false para no esperar imágenes
        const scraperUrl = `http://api.scraperapi.com?api_key=${scraperKey}&url=${encodeURIComponent(url)}&autoparse=true`;
        
        const response = await fetch(scraperUrl);
        if (!response.ok) throw new Error(`Error ScraperAPI: ${response.status}`);
        const html = await response.text();

        // Limpieza del HTML
        const $ = cheerio.load(html);
        $('script, style, nav, footer, iframe, svg').remove(); // Quitamos basura
        let text = $('body').text().replace(/\s+/g, ' ').trim();
        
        // Cortamos el texto para no exceder límites de Gemini (aprox 8000 caracteres)
        text = text.substring(0, 8000);

        if (text.length < 100) {
            throw new Error("El contenido extraído es demasiado corto o está vacío.");
        }

        // Función auxiliar para llamar a Google
        const callGoogle = async (apiUrl, bodyContent) => {
            const resp = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(bodyContent)
            });
            const json = await resp.json();
            if (!resp.ok) {
                const errorMsg = json.error ? json.error.message : resp.statusText;
                throw new Error(`Google API Error: ${resp.status} - ${errorMsg}`);
            }
            return json;
        };

        // --- PASO 2: ANÁLISIS IA (Generar Topic y Summary) ---
        let aiData = { topic: "General", summary: "No disponible" };
        try {
            const genUrl = `https://generativelanguage.googleapis.com/${API_VERSION}/models/${GENERATIVE_MODEL}:generateContent?key=${geminiKey}`;
            
            // Prompt estricto pidiendo solo JSON plano
            const prompt = `Analiza el siguiente texto de una web. 
            Responde ÚNICAMENTE con un objeto JSON válido con este formato: {"topic": "Tema Principal Corto", "summary": "Resumen de 1 linea"}. 
            NO uses markdown, NO uses bloques de código. Solo el JSON plano.
            Texto: ${text.substring(0, 2000)}`;

            const data = await callGoogle(genUrl, {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { responseMimeType: "application/json" }
            });
            
            let rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
            
            // LIMPIEZA CRÍTICA: Quitamos ```json y ``` si Gemini los pone
            if (rawText) {
                rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
                aiData = JSON.parse(rawText);
            }
        } catch (e) {
            console.error("Error en Generación de Texto:", e.message);
            // No fallamos toda la app si falla el resumen, usamos valores por defecto
            aiData = { topic: "Error IA", summary: "No se pudo generar resumen." };
        }

        // --- PASO 3: EMBEDDING (Vectorización) ---
        // Aquí estaba el error 404. Usamos la URL canónica correcta para embedding.
        const embedUrl = `https://generativelanguage.googleapis.com/${API_VERSION}/models/${EMBEDDING_MODEL}:embedContent?key=${geminiKey}`;
        
        const embedData = await callGoogle(embedUrl, {
            model: `models/${EMBEDDING_MODEL}`, // Reforzamos el modelo en el cuerpo
            content: { parts: [{ text: text }] }
        });

        const vector = embedData.embedding?.values;

        if (!vector) throw new Error("Google no devolvió el vector (embedding values missing).");

        // --- RESPUESTA AL FRONTEND ---
        return res.status(200).json({
            success: true,
            data: {
                url,
                vector, // Array de números
                topic: aiData.topic,
                summary: aiData.summary
            }
        });

    } catch (error) {
        console.error("CRITICAL BACKEND ERROR:", error);
        return res.status(500).json({ 
            success: false, 
            error: error.message || 'Error interno del servidor' 
        });
    }
}