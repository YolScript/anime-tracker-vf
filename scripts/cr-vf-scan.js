// Scanne TOUT le catalogue Crunchyroll (browse API) et ajoute les séries
// avec doublage VF (audio_locales contient fr-FR) absentes du catalogue.
const fs = require("fs");
const { execFile } = require("child_process");
const path = require("path").join(__dirname, "..", "catalog.js");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function curl(args) {
    return new Promise((resolve) => {
        execFile("curl", ["-s", "--max-time", "20", "-A", UA, ...args], { maxBuffer: 40 * 1024 * 1024 }, (err, stdout) => {
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
    const basic = Buffer.from((process.env.CR_CLIENT_ID || "noaihdevm_6iyg0a8l0q") + ":").toString("base64");
    const out = await curl([
        "-X", "POST", "https://www.crunchyroll.com/auth/v1/token",
        "-H", "Authorization: Basic " + basic,
        "-H", "Content-Type: application/x-www-form-urlencoded",
        "-d", "grant_type=client_credentials"
    ]);
    const m = out && out.match(/"access_token":"([^"]+)"/);
    if (!m) throw new Error("Cloudflare bloque (token) — relancer plus tard.");
    return m[1];
}

const { normTitle } = require("./lib/norm-title");

(async () => {
    const src = fs.readFileSync(path, "utf8");
    const catalog = JSON.parse(src.replace(/^const DEFAULT_ANIME_DATA = /, "").replace(/;\s*$/, ""));
    console.log("Catalogue avant:", catalog.length);

    const byTitle = new Map();
    const knownCrIds = new Set();
    for (const a of catalog) {
        byTitle.set(normTitle(a.titleFr), a);
        if (a.titleOrig) byTitle.set(normTitle(a.titleOrig), a);
        if (a.crunchyrollUrl) {
            const m = a.crunchyrollUrl.match(/\/series\/([A-Z0-9]+)/i);
            if (m) knownCrIds.add(m[1].toUpperCase());
        }
    }

    // Ce scan depend entierement de l'API Crunchyroll (pas d'equivalent ADN
    // pour decouvrir de nouvelles series) : sa verification anti-bot bloque
    // systematiquement les IP de datacenter (runners CI), contrairement a une
    // IP residentielle. On sort proprement plutot que de planter le workflow.
    let token;
    try {
        token = await getAnonToken();
    } catch (e) {
        console.warn("Crunchyroll indisponible (" + e.message + ") — scan des nouveaux animes ignore pour ce run.");
        process.exit(0);
    }
    console.log("Jeton OK, parcours du catalogue Crunchyroll...");

    const vfShows = [];
    let start = 0;
    while (true) {
        const raw = await curl([
            `https://www.crunchyroll.com/content/v2/discover/browse?n=100&start=${start}&locale=fr-FR`,
            "-H", "Authorization: Bearer " + token
        ]);
        let json;
        try { json = JSON.parse(raw); } catch (e) { throw new Error("réponse browse invalide à start=" + start); }
        const items = json.data || [];
        for (const item of items) {
            const meta = item.series_metadata || {};
            const locales = meta.audio_locales || [];
            if (locales.indexOf("fr-FR") !== -1) vfShows.push(item);
        }
        start += 100;
        if (start >= (json.total || 0) || items.length === 0) break;
        await sleep(800);
    }
    console.log("Séries avec doublage VF sur Crunchyroll:", vfShows.length);

    let linked = 0, added = 0, reintegrated = 0;
    for (const show of vfShows) {
        const id = (show.id || "").toUpperCase();
        const title = show.title || "";
        const meta = show.series_metadata || {};
        if (knownCrIds.has(id)) continue;
        const url = `https://www.crunchyroll.com/fr/series/${show.id}/${show.slug_title || ""}`;

        const existing = byTitle.get(normTitle(title));
        if (existing) {
            let changed = false;
            if (!existing.crunchyrollUrl) { existing.crunchyrollUrl = url; changed = true; }
            if (existing.noVf || existing.unavailable) {
                delete existing.noVf;
                delete existing.unavailable;
                reintegrated++;
            }
            if (changed) linked++;
            continue;
        }

        const poster = show.images && show.images.poster_tall && show.images.poster_tall[0]
            ? show.images.poster_tall[0][Math.min(2, show.images.poster_tall[0].length - 1)].source
            : null;
        const rawStartDate = meta.series_launch_year ? { year: meta.series_launch_year, month: 1, day: 1 } : null;
        catalog.push({
            id: "cr-" + show.id,
            titleFr: title,
            titleOrig: title,
            imageUrl: poster,
            crunchyrollUrl: url,
            adnUrl: null,
            episodesTotal: meta.episode_count || 0,
            episodesWatched: 0,
            status: "plan-to-watch",
            rating: 0,
            siteRating: null,
            trailerId: null,
            genres: (meta.tenant_categories || []).join(", "),
            synopsis: show.description || "",
            cast: "",
            airingStatus: meta.is_simulcast ? "RELEASING" : "FINISHED",
            // Annee connue via rawStartDate mais releaseDate restait "null" :
            // l'UI affiche "Inconnue" pour la date de sortie alors que l'annee
            // est disponible (jour/mois par defaut a 01, comme ailleurs dans
            // le catalogue quand seule l'annee est connue).
            releaseDate: rawStartDate ? `01/01/${rawStartDate.year}` : null,
            lastEpisodeDate: null,
            rawStartDate: rawStartDate,
            rawEndDate: null,
            nextAiringEpisode: null,
            nextAiringAt: null,
            seasons: []
        });
        byTitle.set(normTitle(title), catalog[catalog.length - 1]);
        added++;
    }

    console.log(`Liens ajoutés: ${linked} | fiches réintégrées: ${reintegrated} | nouveaux animés VF: ${added}`);
    console.log("Catalogue final:", catalog.length);
    writeAtomic(path, "const DEFAULT_ANIME_DATA = " + JSON.stringify(catalog, null, 2) + ";\n");
    console.log("catalog.js mis à jour.");
})();
