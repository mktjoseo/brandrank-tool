import fetch from 'node-fetch';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const { domain } = req.query;
    const apiKey = process.env.SERPER_API_KEY;

    if (!domain || !apiKey) {
        return res.status(400).json({ error: 'Falta dominio o API Key de Serper' });
    }

    try {
        // Buscamos las páginas indexadas en Google
        const response = await fetch('https://google.serper.dev/search', {
            method: 'POST',
            headers: {
                'X-API-KEY': apiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                q: `site:${domain}`, 
                num: 30 // Traemos 30 para que el usuario elija las mejores 10
            })
        });

        const data = await response.json();
        const urls = data.organic ? data.organic.map(item => item.link) : [];
        
        return res.status(200).json(urls);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}