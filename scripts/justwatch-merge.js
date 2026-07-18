// Ajoute les animés (japonais, VF) de Netflix / Disney+ / Prime Video via
// JustWatch, croisés avec AniList pour le filtrage et les métadonnées.
// - Titre existant => remplit netflixUrl / disneyUrl / primeUrl (et réintègre
//   les fiches exclues noVf/unavailable si une plateforme VF est trouvée)
// - Nouveau titre => entrée catalogue complète (id franchise-<anilistId>)
const fs = require("fs");
const path = require("path").join(__dirname, "..", "catalog.js");

// Type d'objet à scanner : SHOW (défaut) ou MOVIE (passe 2 pour les films)
const OBJECT_TYPE = (process.argv[2] || "SHOW").toUpperCase();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const JW_QUERY = `query($country:Country!,$first:Int!,$after:String,$filter:TitleFilter){
popularTitles(country:$country,first:$first,after:$after,filter:$filter){
totalCount pageInfo{hasNextPage endCursor}
edges{node{id objectType content(country:$country,language:"fr"){title originalReleaseYear}
... on MovieOrShow{offers(country:$country,platform:WEB){monetizationType audioLanguages package{shortName} standardWebURL}}}}}}`;

async function jwPage(after) {
    const res = await fetch("https://apis.justwatch.com/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
        body: JSON.stringify({
            query: JW_QUERY,
            variables: {
                country: "FR", first: 100, after: after || null,
                filter: { packages: ["nfx", "dnp", "prv", "amp"], genres: ["ani"], objectTypes: [OBJECT_TYPE] }
            }
        })
    });
    if (!res.ok) throw new Error("justwatch: " + res.status);
    return (await res.json()).data.popularTitles;
}

// Offres retenues : abonnement, plateforme cible, VF (ou langues non déclarées)
const PKG_FIELD = { nfx: "netflixUrl", nfa: "netflixUrl", dnp: "disneyUrl", prv: "primeUrl", amp: "primeUrl" };
function extractPlatformUrls(offers) {
    const urls = {};
    for (const o of offers || []) {
        if (o.monetizationType !== "FLATRATE") continue;
        const field = PKG_FIELD[o.package && o.package.shortName];
        if (!field || urls[field]) continue;
        const langs = o.audioLanguages || [];
        if (langs.length > 0 && langs.indexOf("fr") === -1) continue; // VO seule déclarée
        if (o.standardWebURL) urls[field] = o.standardWebURL;
    }
    return urls;
}

const ANILIST_FORMATS = OBJECT_TYPE === "MOVIE" ? "[MOVIE]" : "[TV,TV_SHORT,ONA,OVA]";
const ANILIST_QUERY = `query($search:String){Media(search:$search,type:ANIME,format_in:${ANILIST_FORMATS}){
id countryOfOrigin episodes averageScore status genres description(asHtml:false)
title{romaji english} coverImage{large}
startDate{year month day} endDate{year month day} trailer{id site}}}`;

async function anilistLookup(title) {
    for (let attempt = 0; attempt < 3; attempt++) {
        const res = await fetch("https://graphql.anilist.co", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: ANILIST_QUERY, variables: { search: title } })
        });
        if (res.status === 429) { await sleep(10000); continue; }
        if (!res.ok) return null;
        const json = await res.json();
        return json.data ? json.data.Media : null;
    }
    return null;
}

function normTitle(s) {
    return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function toFrDate(d) {
    if (!d || !d.year) return null;
    const p = (n) => String(n || 1).padStart(2, "0");
    return `${p(d.day)}/${p(d.month)}/${d.year}`;
}

(async () => {
    const src = fs.readFileSync(path, "utf8");
    const catalog = JSON.parse(src.replace(/^const DEFAULT_ANIME_DATA = /, "").replace(/;\s*$/, ""));

    const byId = new Map(catalog.map((a) => [a.id, a]));
    const byTitle = new Map();
    for (const a of catalog) {
        byTitle.set(normTitle(a.titleFr), a);
        if (a.titleOrig) byTitle.set(normTitle(a.titleOrig), a);
    }

    // 1. Collecter tous les titres JustWatch
    const jwTitles = [];
    let after = null;
    while (true) {
        const page = await jwPage(after);
        for (const e of page.edges) jwTitles.push(e.node);
        if (!page.pageInfo.hasNextPage) break;
        after = page.pageInfo.endCursor;
        await sleep(400);
    }
    console.log("Titres JustWatch collectés:", jwTitles.length);

    // 2. Croiser avec AniList et fusionner
    let linked = 0, added = 0, reintegrated = 0, skippedNonJp = 0, noMatch = 0, done = 0;
    for (const t of jwTitles) {
        done++;
        const title = t.content && t.content.title;
        if (!title) continue;
        const urls = extractPlatformUrls(t.offers);
        if (Object.keys(urls).length === 0) continue;

        // Déjà au catalogue ? Lier directement sans AniList.
        let existing = byTitle.get(normTitle(title));
        let media = null;
        if (!existing) {
            media = await anilistLookup(title);
            await sleep(700);
            if (!media) { noMatch++; continue; }
            if (media.countryOfOrigin !== "JP") { skippedNonJp++; continue; }
            // Vérifier l'année pour limiter les faux matchs
            const jwYear = t.content.originalReleaseYear;
            if (jwYear && media.startDate && media.startDate.year && Math.abs(media.startDate.year - jwYear) > 1) { noMatch++; continue; }
            existing = byId.get("franchise-" + media.id)
                || byTitle.get(normTitle(media.title && media.title.romaji))
                || byTitle.get(normTitle(media.title && media.title.english));
        }

        if (existing) {
            let changed = false;
            for (const [field, url] of Object.entries(urls)) {
                if (!existing[field]) { existing[field] = url; changed = true; }
            }
            if (changed) linked++;
            if (existing.noVf || existing.unavailable) {
                delete existing.noVf;
                delete existing.unavailable;
                reintegrated++;
            }
            continue;
        }

        // Nouvelle entrée catalogue
        const entry = {
            id: "franchise-" + media.id,
            titleFr: title,
            titleOrig: (media.title && (media.title.romaji || media.title.english)) || title,
            imageUrl: media.coverImage ? media.coverImage.large : null,
            crunchyrollUrl: null,
            adnUrl: null,
            episodesTotal: Math.max(media.episodes || 0, 1),
            episodesWatched: 0,
            status: "plan-to-watch",
            rating: 0,
            siteRating: media.averageScore ? (media.averageScore / 20).toFixed(1) : null,
            trailerId: media.trailer && media.trailer.site === "youtube" ? media.trailer.id : null,
            genres: (media.genres || []).join(", "),
            synopsis: (media.description || "").replace(/<[^>]+>/g, "").replace(/\n{3,}/g, "\n\n"),
            cast: "",
            airingStatus: media.status === "RELEASING" ? "RELEASING" : "FINISHED",
            releaseDate: toFrDate(media.startDate),
            lastEpisodeDate: toFrDate(media.endDate),
            rawStartDate: media.startDate && media.startDate.year ? media.startDate : null,
            rawEndDate: media.endDate && media.endDate.year ? media.endDate : null,
            nextAiringEpisode: null,
            nextAiringAt: null,
            seasons: [],
            ...urls
        };
        catalog.push(entry);
        byId.set(entry.id, entry);
        byTitle.set(normTitle(entry.titleFr), entry);
        byTitle.set(normTitle(entry.titleOrig), entry);
        added++;

        if (done % 100 === 0) {
            console.log(`${done}/${jwTitles.length} — liés: ${linked}, ajoutés: ${added}, réintégrés: ${reintegrated}`);
            fs.writeFileSync(path, "const DEFAULT_ANIME_DATA = " + JSON.stringify(catalog, null, 2) + ";\n", "utf8");
        }
    }

    fs.writeFileSync(path, "const DEFAULT_ANIME_DATA = " + JSON.stringify(catalog, null, 2) + ";\n", "utf8");
    console.log(`TERMINÉ — plateformes liées: ${linked}, nouveaux animés: ${added}, fiches réintégrées: ${reintegrated}, non-japonais ignorés: ${skippedNonJp}, sans correspondance: ${noMatch}`);
    console.log("Catalogue final:", catalog.length);
})();
