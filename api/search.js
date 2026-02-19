const fetch = require('node-fetch');
const cheerio = require('cheerio');

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.status(200).end(); return; }

    let { domain } = req.query;
    if (!domain) return res.status(400).json({ error: 'Falta el dominio' });

    // 1. Limpieza agresiva del dominio para evitar "///"
    domain = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
    const baseUrl = `https://${domain}`; // Base limpia: https://violinista.online

    try {
        let urls = [];
        let source = '';
        let logs = []; 

        // --- PLAN A: SITEMAP ---
        const sitemapVariations = [
            '/sitemap_index.xml',
            '/sitemap.xml',
            '/wp-sitemap.xml'
        ];

        logs.push(`[PLAN A] Buscando sitemaps en: ${baseUrl}`);

        for (const path of sitemapVariations) {
            try {
                const target = `${baseUrl}${path}`;
                const resp = await fetch(target, { 
                    timeout: 6000,
                    headers: { 'User-Agent': 'Mozilla/5.0 (Compatible; Googlebot/2.1)' } 
                });
                
                if (resp.ok) {
                    const xml = await resp.text();
                    if (xml.includes('<loc>')) {
                        const $ = cheerio.load(xml, { xmlMode: true });
                        $('loc').each((i, el) => {
                            let link = $(el).text().trim();
                            
                            // 2. CORRECCIÓN DE URLS ROTAS
                            // Si el link es solo "/blog", le pegamos la base
                            if (link.startsWith('/')) {
                                link = `${baseUrl}${link}`;
                            }
                            // Si no tiene protocolo, se lo ponemos
                            if (!link.startsWith('http')) {
                                link = `${baseUrl}/${link.replace(/^\//, '')}`;
                            }
                            
                            // Filtros de basura
                            if (!link.match(/\.(jpg|png|css|json|xml)$/i)) {
                                urls.push(link);
                            }
                        });

                        if (urls.length > 0) {
                            source = `Sitemap (${path})`;
                            logs.push(`✅ SITEMAP ENCONTRADO: ${path} (${urls.length} URLs)`);
                            break; 
                        }
                    }
                }
            } catch (e) {
                logs.push(`⚠️ Error en ${path}: ${e.message}`);
            }
        }

        // --- PLAN B: SERPER (Solo si falló A) ---
        if (urls.length === 0) {
            logs.push("[PLAN A FALLIDO] Activando Google Search (Serper)...");
            const apiKey = process.env.SERPER_API_KEY;
            
            if (apiKey) {
                const serperRes = await fetch('https://google.serper.dev/search', {
                    method: 'POST',
                    headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ q: `site:${domain}`, num: 20 })
                });
                
                if (serperRes.ok) {
                    const data = await serperRes.json();
                    if (data.organic) {
                        urls = data.organic.map(item => item.link);
                        source = 'Google Search (Serper)';
                        logs.push(`✅ SERPER: ${urls.length} URLs encontradas.`);
                    }
                }
            }
        }

        // Limpieza final: Solo URLs del dominio y máximo 50
        urls = [...new Set(urls)]
            .filter(u => u.includes(domain))
            .slice(0, 50);

        return res.status(200).json({ 
            success: true, 
            source: source || 'Fallido',
            count: urls.length,
            urls: urls,
            debugLogs: logs 
        });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}