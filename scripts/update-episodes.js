// Met à jour episodesTotal (et les saisons) avec le nombre RÉEL d'épisodes
// disponibles sur les plateformes : Crunchyroll (API seasons) et ADN
// (episodeCount du catalogue). Total retenu = max des plateformes trouvées.
const fs = require("fs");
const { execFile } = require("child_process");
const path = require("path").join(__dirname, "..", "catalog.js");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function curl(args) {
    return new Promise((resolve) => {
        execFile("curl", ["-s", "--max-time", "20", "-A", UA, ...args], { maxBuffer: 20 * 1024 * 1024 }, (err, stdout) => {
            resolve(err ? null : stdout);
        });
    });
}

// Ecriture atomique : evite un catalog.js tronque/invalide (qui casserait le
// site entier, charge en <script> bloquant) si le process est tue en cours
// d'ecriture (timeout CI, kill manuel...).
function writeAtomic(filePath, content) {
    const tmp = filePath + ".tmp";
    fs.writeFileSync(tmp, content, "utf8");
    fs.renameSync(tmp, filePath);
}

async function getAnonToken() {
    const basic = Buffer.from("noaihdevm_6iyg0a8l0q:").toString("base64");
    const out = await curl([
        "-X", "POST", "https://www.crunchyroll.com/auth/v1/token",
        "-H", "Authorization: Basic " + basic,
        "-H", "Content-Type: application/x-www-form-urlencoded",
        "-d", "grant_type=client_credentials"
    ]);
    const m = out && out.match(/"access_token":"([^"]+)"/);
    if (!m) throw new Error("Cloudflare bloque encore (token HTML) — relancer plus tard.");
    return m[1];
}

// Saisons réelles d'une série CR : dédupliquées par season_number (les
// versions par langue apparaissent parfois en entrées séparées).
async function getCrSeasons(token, seriesId) {
    const raw = await curl([
        `https://www.crunchyroll.com/content/v2/cms/series/${seriesId}/seasons?locale=fr-FR`,
        "-H", "Authorization: Bearer " + token
    ]);
    if (!raw) return null;
    let json;
    try { json = JSON.parse(raw); } catch (e) { return null; }
    if (!json.data || json.error) return null;
    const bySeasonNum = new Map();
    for (const s of json.data) {
        const num = s.season_number || bySeasonNum.size + 1;
        const eps = s.number_of_episodes || 0;
        const prev = bySeasonNum.get(num);
        if (!prev || eps > prev.episodesCount) {
            bySeasonNum.set(num, {
                name: s.title || ("Saison " + num),
                episodesCount: eps,
                number: num
            });
        }
    }
    const seasons = [...bySeasonNum.values()].filter((s) => s.episodesCount > 0).sort((a, b) => a.number - b.number);
    return seasons.map((s) => ({ name: s.name, episodesCount: s.episodesCount }));
}

async function fetchAdnCounts() {
    const counts = new Map();
    let offset = 0;
    const limit = 100;
    while (true) {
        const res = await fetch(`https://gw.api.animationdigitalnetwork.fr/show/catalog?limit=${limit}&offset=${offset}`, {
            headers: { "X-Target-Distribution": "fr" }
        });
        if (!res.ok) throw new Error("API ADN: " + res.status);
        const json = await res.json();
        const shows = json.shows || [];
        for (const s of shows) counts.set(String(s.id), s.episodeCount || 0);
        if (shows.length < limit) break;
        offset += limit;
    }
    return counts;
}

(async () => {
    const src = fs.readFileSync(path, "utf8");
    const catalog = JSON.parse(src.replace(/^const DEFAULT_ANIME_DATA = /, "").replace(/;\s*$/, ""));

    const adnCounts = await fetchAdnCounts();
    console.log("Comptes ADN chargés:", adnCounts.size);
    const token = await getAnonToken();
    console.log("Jeton Crunchyroll OK");

    let updated = 0, seasonsSet = 0, crFails = 0, done = 0;
    for (const anime of catalog) {
        done++;
        let crSum = 0, adnCount = 0;
        let crSeasons = null;

        if (anime.crunchyrollUrl) {
            const m = anime.crunchyrollUrl.match(/\/series\/([A-Z0-9]+)/i);
            if (m) {
                crSeasons = await getCrSeasons(token, m[1]);
                await sleep(1200);
                if (crSeasons === null) crFails++;
                else crSum = crSeasons.reduce((s, x) => s + x.episodesCount, 0);
            }
        }
        if (anime.adnUrl) {
            const m = anime.adnUrl.match(/\/video\/(\d+)/);
            if (m) adnCount = adnCounts.get(m[1]) || 0;
        }

        const real = Math.max(crSum, adnCount);
        if (real > 0 && real !== anime.episodesTotal) {
            console.log(`  ${anime.titleFr}: ${anime.episodesTotal} -> ${real}${crSum >= adnCount ? " (CR)" : " (ADN)"}`);
            anime.episodesTotal = real;
            updated++;
        }
        // Saisons réelles CR seulement si plus détaillées que l'existant
        if (crSeasons && crSeasons.length > 0 && crSum >= adnCount
            && (!anime.seasons || anime.seasons.length <= crSeasons.length)) {
            anime.seasons = crSeasons;
            seasonsSet++;
        }

        if (done % 50 === 0) {
            console.log(`${done}/${catalog.length} traités — totaux corrigés: ${updated}`);
            writeAtomic(path, "const DEFAULT_ANIME_DATA = " + JSON.stringify(catalog, null, 2) + ";\n");
        }
    }

    fs.writeFileSync(path, "const DEFAULT_ANIME_DATA = " + JSON.stringify(catalog, null, 2) + ";\n", "utf8");
    console.log(`TERMINÉ — totaux corrigés: ${updated}, saisons mises à jour: ${seasonsSet}, échecs CR: ${crFails}`);
})();
