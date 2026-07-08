// Fusionne le catalogue ADN (doublage VF) dans catalog.js
const fs = require("fs");
const path = "c:/Users/agora/Documents/Crunchyroll/catalog.js";

function normTitle(s) {
    return (s || "")
        .toLowerCase()
        .normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

async function fetchAdnCatalog() {
    const all = [];
    let offset = 0;
    const limit = 100;
    while (true) {
        const res = await fetch(`https://gw.api.animationdigitalnetwork.fr/show/catalog?limit=${limit}&offset=${offset}`, {
            headers: { "X-Target-Distribution": "fr" }
        });
        if (!res.ok) throw new Error("API ADN: " + res.status);
        const json = await res.json();
        const shows = json.shows || [];
        all.push(...shows);
        if (shows.length < limit) break;
        offset += limit;
    }
    return all;
}

function toDateParts(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d)) return null;
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function toFrDate(parts) {
    if (!parts) return null;
    const p2 = (n) => String(n).padStart(2, "0");
    return `${p2(parts.day)}/${p2(parts.month)}/${parts.year}`;
}

(async () => {
    // 1. Catalogue existant
    const src = fs.readFileSync(path, "utf8");
    const jsonText = src.replace(/^const DEFAULT_ANIME_DATA = /, "").replace(/;\s*$/, "");
    const catalog = JSON.parse(jsonText);
    console.log("Catalogue existant:", catalog.length);

    const known = new Map(); // titre normalisé -> entrée existante
    for (const a of catalog) {
        known.set(normTitle(a.titleFr), a);
        if (a.titleOrig) known.set(normTitle(a.titleOrig), a);
    }

    // 2. Catalogue ADN
    const adnAll = await fetchAdnCatalog();
    console.log("Shows ADN total:", adnAll.length);
    const adnVf = adnAll.filter((s) => Array.isArray(s.languages) && s.languages.includes("vf") && s.available !== false);
    console.log("Shows ADN avec VF:", adnVf.length);

    // 3. Fusion
    let updatedLinks = 0;
    let added = 0;
    for (const show of adnVf) {
        const adnUrl = "https://animationdigitalnetwork.fr" + (show.urlPath || `/video/${show.id}`);
        const existing = known.get(normTitle(show.title)) || known.get(normTitle(show.originalTitle));
        if (existing) {
            if (!existing.adnUrl) {
                existing.adnUrl = adnUrl;
                updatedLinks++;
            }
            continue;
        }
        const startParts = toDateParts(show.microdata && show.microdata.startDate);
        const genres = (show.genres || []).filter((g) => g !== "Animation japonaise").join(", ");
        const entry = {
            id: "adn-" + show.id,
            titleFr: show.title,
            titleOrig: show.originalTitle || show.title,
            imageUrl: show.image2x || show.image || null,
            crunchyrollUrl: null,
            adnUrl: adnUrl,
            episodesTotal: Math.max(show.episodeCount || 0, 1),
            episodesWatched: 0,
            status: "plan-to-watch",
            rating: 0,
            siteRating: typeof show.rating === "number" ? show.rating.toFixed(1) : null,
            trailerId: null,
            genres: genres,
            synopsis: show.summary || "",
            cast: "",
            airingStatus: show.simulcast ? "RELEASING" : "FINISHED",
            releaseDate: toFrDate(startParts),
            lastEpisodeDate: null,
            rawStartDate: startParts,
            rawEndDate: null,
            nextAiringEpisode: null,
            nextAiringAt: null,
            seasons: []
        };
        catalog.push(entry);
        known.set(normTitle(show.title), entry);
        if (show.originalTitle) known.set(normTitle(show.originalTitle), entry);
        added++;
    }

    console.log("Liens ADN ajoutés aux existants:", updatedLinks);
    console.log("Nouveaux animés ADN VF ajoutés:", added);
    console.log("Catalogue final:", catalog.length);

    fs.writeFileSync(path, "const DEFAULT_ANIME_DATA = " + JSON.stringify(catalog, null, 2) + ";\n", "utf8");
    console.log("catalog.js réécrit.");
})();
