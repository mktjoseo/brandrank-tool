import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const { url } = req.body;
    const scraperKey = process.env.SCRAPERAPI_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;

    try {
        const sUrl = `http://api.scraperapi.com?api_key=${scraperKey}&url=${encodeURIComponent(url)}&autoparse=true`;
        const htmlRes = await fetch(sUrl);
        const html = await htmlRes.text();
        const $ = cheerio.load(html);
        
        $('script, style, nav, footer').remove();
        const text = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 4000);
        const title = $('title').text() || url;

        // IA para Topic
        let topic = "General";
        try {
            const genUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
            const aiRes = await fetch(genUrl, {
                method: 'POST',
                body: JSON.stringify({ contents: [{ parts: [{ text: `Define el tema de esta web en 2 palabras: ${text.substring(0, 400)}` }] }] })
            });
            const aiData = await aiRes.json();
            topic = aiData.candidates[0].content.parts[0].text.trim();
        } catch (e) { console.log("IA Topic Error"); }

        res.status(200).json({ success: true, data: { text, title, topic } });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
}