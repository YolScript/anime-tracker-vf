// Vérifie la disponibilité des liens Crunchyroll et ADN du catalogue.
// - Lien mort => mis à null (la plateforme est retirée de la fiche)
// - Plus aucune plateforme (alors qu'il y en avait) => "unavailable": true
const fs = require("fs");
const path = "c:/Users/agora/Documents/Crunchyroll/catalog.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

async function fetchAdnAvailability() {
    const available = new Set();
    let offset = 0;
    const limit = 100;
    while (true) {
        const res = await fetch(`https://gw.api.animationdigitalnetwork.fr/show/catalog?limit=${limit}&offset=${offset}`, {
            headers: { "X-Target-Distribution": "fr" }
        });
        if (!res.ok) throw new Error("API ADN: " + res.status);
        const json = await res.json();
        const shows = json.shows || [];
        for (const s of shows) {
            if (s.available !== false) available.add(String(s.id));
        }
        if (shows.length < limit) break;
        offset += limit;
    }
    return available;
}

// Statuts possibles : "alive", "dead", "unknown" (on ne retire jamais sur unknown)
async function checkCrunchyrollUrl(url) {
    try {
        const res = await fetch(url, {
            redirect: "follow",
            headers: { "User-Agent": UA, "Accept-Language": "fr-FR,fr;q=0.9" }
        });
        const finalUrl = res.url || url;
        if (res.status === 404 || res.status === 410) return "dead";
        if (res.status !== 200) return "unknown"; // 403 Cloudflare etc. : prudence
        // Redirection vers la home ou une page non-série = contenu retiré
        const u = new URL(finalUrl);
        const p = u.pathname.replace(/\/+$/, "");
        if (p === "" || p === "/fr" || p === "/fr/videos" || p === "/videos") return "dead";
        return "alive";
    } catch (e) {
        return "unknown";
    }
}

async function mapLimit(items, limit, fn) {
    const results = new Array(items.length);
    let i = 0;
    async function worker() {
        while (i < items.length) {
            const idx = i++;
            results[idx] = await fn(items[idx], idx);
        }
    }
    await Promise.all(Array.from({ length: limit }, worker));
    return results;
}

(async () => {
    const src = fs.readFileSync(path, "utf8");
    const catalog = JSON.parse(src.replace(/^const DEFAULT_ANIME_DATA = /, "").replace(/;\s*$/, ""));
    console.log("Catalogue:", catalog.length, "entrées");

    // --- ADN ---
    const adnAvailable = await fetchAdnAvailability();
    console.log("Shows ADN disponibles (API):", adnAvailable.size);
    let adnDead = 0;
    for (const anime of catalog) {
        if (!anime.adnUrl) continue;
        const m = anime.adnUrl.match(/\/video\/(\d+)/);
        if (m && !adnAvailable.has(m[1])) {
            console.log("  ADN mort:", anime.titleFr, anime.adnUrl);
            anime.adnUrl = null;
            adnDead++;
        }
    }
    console.log("Liens ADN retirés:", adnDead);

    // --- Crunchyroll ---
    const withCr = catalog.filter((a) => a.crunchyrollUrl);
    console.log("Liens Crunchyroll à tester:", withCr.length);
    let crDead = 0, crUnknown = 0;
    const statuses = await mapLimit(withCr, 6, async (anime) => {
        const st = await checkCrunchyrollUrl(anime.crunchyrollUrl);
        return { anime, st };
    });
    for (const { anime, st } of statuses) {
        if (st === "dead") {
            console.log("  CR mort:", anime.titleFr, anime.crunchyrollUrl);
            anime.crunchyrollUrl = null;
            crDead++;
        } else if (st === "unknown") {
            crUnknown++;
        }
    }
    console.log("Liens Crunchyroll retirés:", crDead, "| indéterminés (conservés):", crUnknown);

    // --- Marquage indisponible ---
    let unavailable = 0;
    for (const anime of catalog) {
        if (!anime.crunchyrollUrl && !anime.adnUrl) {
            anime.unavailable = true;
            unavailable++;
        } else if (anime.unavailable) {
            delete anime.unavailable;
        }
    }
    console.log("Animés sans aucune plateforme (grisés):", unavailable);

    fs.writeFileSync(path, "const DEFAULT_ANIME_DATA = " + JSON.stringify(catalog, null, 2) + ";\n", "utf8");
    console.log("catalog.js mis à jour.");
})();
