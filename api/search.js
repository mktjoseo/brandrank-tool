// api/search.js - Usando fetch nativo de Node.js 18+

export default async function handler(req, res) {
    // CORS Headers para evitar bloqueos
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const { domain } = req.query;
    if (!domain) return res.status(400).json({ error: 'Falta dominio' });

    const apiKey = process.env.SERPER_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Falta API Key SERPER' });

    try {
        const response = await fetch('https://google.serper.dev/search', {
            method: 'POST',
            headers: {
                'X-API-KEY': apiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                q: `site:${domain}`,
                num: 20
            })
        });

        if (!response.ok) {
            throw new Error(`Serper API error: ${response.status}`);
        }

        const data = await response.json();
        const urls = data.organic ? data.organic.map(item => item.link) : [];
        
        return res.status(200).json({ success: true, urls });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}