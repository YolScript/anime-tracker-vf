// ==========================================================================
// DEFAULT DATA (POPULAR ANIME WITH FRENCH DUBBING - VF)
// ==========================================================================
// DEFAULT_ANIME_DATA is loaded from catalog.js (contains 200 Crunchyroll anime)
if (typeof DEFAULT_ANIME_DATA === 'undefined') {
    throw new Error("La base de données (catalog.js) n'a pas été chargée ou est corrompue.");
}

// ==========================================================================
// STATE MANAGEMENT
// ==========================================================================
let animeList = [];
let currentSearch = "";
let currentSort = "last-episode-desc";
let currentPlatform = "all";

// Debounce du champ recherche + jeton d'annulation du rendu par lots
let searchDebounceTimer = null;
let renderToken = 0;

// YouTube Error Auto-Fallback Globals
let activeYtTimeout = null;
let activeYtListener = null;

function clearActiveYtPlayback() {
    if (activeYtTimeout) {
        clearTimeout(activeYtTimeout);
        activeYtTimeout = null;
    }
    if (activeYtListener) {
        window.removeEventListener("message", activeYtListener);
        activeYtListener = null;
    }
}

// Détecteur de langue et traducteur automatique de synopsis
function isEnglishText(text) {
    if (!text) return false;
    const englishWords = /\b(the|and|of|to|a|is|in|that|it|was|for|on|with|as|at|by|an|be|this|are|from|or|had|but)\b/i;
    const frenchWords = /\b(le|la|les|et|de|un|une|est|dans|en|que|qui|ce|pour|sur|avec|pour|par|ou|plus|dans)\b/i;
    
    let enCount = (text.match(new RegExp(englishWords, "gi")) || []).length;
    let frCount = (text.match(new RegExp(frenchWords, "gi")) || []).length;
    
    return enCount > frCount;
}

async function translateTextToFrench(text) {
    if (!text || text.trim() === "") return text;
    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=fr&dt=t&q=${encodeURIComponent(text)}`;
        const res = await fetch(url);
        const data = await res.json();
        if (data && data[0]) {
            return data[0].map(x => x[0]).join("");
        }
    } catch (e) {
        console.error("Erreur de traduction:", e);
    }
    return text;
}

// ==========================================================================
// DOM ELEMENTS
// ==========================================================================
const animeGrid = document.getElementById("anime-grid");
const emptyState = document.getElementById("empty-state");
const searchInput = document.getElementById("search-input");
const clearSearchBtn = document.getElementById("clear-search");
const sortSelect = document.getElementById("sort-select");
const platformSelect = document.getElementById("platform-select");
const filtersToggleBtn = document.getElementById("filters-toggle-btn");
const filtersMenu = document.getElementById("filters-menu");
const addAnimeBtn = document.getElementById("add-anime-btn");
const emptyAddBtn = document.getElementById("empty-add-btn");
const dataDropdownBtn = document.getElementById("data-dropdown-btn");
const dataDropdownMenu = document.getElementById("data-dropdown-menu");
const exportBtn = document.getElementById("export-btn");
const importTriggerBtn = document.getElementById("import-trigger-btn");
const importFileInput = document.getElementById("import-file-input");
const resetBtn = document.getElementById("reset-btn");

// Modals
const detailModal = document.getElementById("detail-modal");
const detailModalBody = document.getElementById("detail-modal-body");
const editModal = document.getElementById("edit-modal");
const animeForm = document.getElementById("anime-form");
const modalTitle = document.getElementById("modal-title");
const cancelFormBtn = document.getElementById("cancel-form-btn");

// Player Modal Elements
const playerModal = document.getElementById("player-modal");
const playerTitle = document.getElementById("player-title");
const videoPlayerWrapper = document.getElementById("video-player-wrapper");
const playerAnimeName = document.getElementById("player-anime-name");
const playerWatchedBtn = document.getElementById("player-watched-btn");

// Form Inputs
const formAnimeId = document.getElementById("form-anime-id");
const formTitleFr = document.getElementById("form-title-fr");
const formTitleOrig = document.getElementById("form-title-orig");
const formImageUrl = document.getElementById("form-image-url");
const formCrunchyrollUrl = document.getElementById("form-crunchyroll-url");
const formAdnUrl = document.getElementById("form-adn-url");
const formNetflixUrl = document.getElementById("form-netflix-url");
const formDisneyUrl = document.getElementById("form-disney-url");
const formPrimeUrl = document.getElementById("form-prime-url");
const formEpisodesTotal = document.getElementById("form-episodes-total");
const formEpisodesWatched = document.getElementById("form-episodes-watched");
const formStatus = document.getElementById("form-status");
const formRating = document.getElementById("form-rating");
const formSeason = document.getElementById("form-season");
const formGenres = document.getElementById("form-genres");
const formSynopsis = document.getElementById("form-synopsis");
const formCast = document.getElementById("form-cast");

// Stats Counters
const statCompletionPct = document.getElementById("stat-completion-pct");
const statProgressBar = document.getElementById("stat-progress-bar");

// Toast notification system removed

// ==========================================================================
// HTML ESCAPING (donnees tierces AniList/Crunchyroll/ADN/JustWatch injectees
// dans innerHTML : jamais dignes de confiance telles quelles)
// ==========================================================================
function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// ==========================================================================
// IMAGE FALLBACK GENERATOR
// ==========================================================================
function getFallbackImage(title) {
    title = title || "Anime";
    const fillStyle = "%2323252b";
    const accentStyle = "%23ff6400";
    const textStyle = "%23a0a0a5";
    
    return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="420" viewBox="0 0 300 420"><rect width="100%" height="100%" fill="${fillStyle}"/><text x="50%" y="40%" dominant-baseline="middle" text-anchor="middle" fill="${textStyle}" font-family="sans-serif" font-size="14">AFFICHE</text><text x="50%" y="46%" dominant-baseline="middle" text-anchor="middle" fill="${textStyle}" font-family="sans-serif" font-size="14">NON DISPONIBLE</text><rect x="40" y="240" width="220" height="4" fill="${accentStyle}"/><text x="50%" y="280" dominant-baseline="middle" text-anchor="middle" fill="%23ffffff" font-family="sans-serif" font-weight="bold" font-size="16">${encodeURIComponent(title.length > 25 ? title.substring(0, 22) + '...' : title)}</text></svg>`;
}

// ==========================================================================
// DATA CORE OPERATIONS (LOCAL STORAGE)
// ==========================================================================
// Champs catalogue mis a jour par syncWithAniList() (jamais par l'utilisateur)
// qu'il faut persister a part de la progression pour ne pas les perdre au
// prochain chargement, quand ils different de la valeur d'origine catalog.js.
const SYNC_PERSISTED_FIELDS = [
    "episodesTotal", "seasons", "airingStatus",
    "nextAiringEpisode", "nextAiringAt", "crunchyrollUrl", "adnUrl"
];

function loadData() {
    // 1. Initialize merged list with a real deep copy of DEFAULT_ANIME_DATA :
    // un spread {...item} est superficiel, anime.seasons (et les objets
    // saison qu'il contient) restait une reference partagee avec les
    // donnees par defaut — une correction de saison (plus bas, ou via un
    // sync AniList) mutait alors l'objet source partage et s'accumulait
    // d'un chargement a l'autre dans la meme session.
    const mergedList = DEFAULT_ANIME_DATA.map(item => structuredClone(item));
    
    // Auto-backfill ADN URLs for popular shows available on ADN in France
    const getAdnUrlForShow = (titleFr) => {
        const t = titleFr.toLowerCase();
        if (t.includes("one piece")) return "https://animationdigitalnetwork.fr/video/one-piece";
        if (t.includes("naruto")) return "https://animationdigitalnetwork.fr/video/naruto";
        if (t.includes("bleach")) return "https://animationdigitalnetwork.fr/video/bleach";
        if (t.includes("hunter x hunter") || t.includes("hunterxhunter")) return "https://animationdigitalnetwork.fr/video/hunter-x-hunter";
        if (t.includes("fairy tail")) return "https://animationdigitalnetwork.fr/video/fairy-tail";
        if (t.includes("my hero academia")) return "https://animationdigitalnetwork.fr/video/my-hero-academia";
        if (t.includes("blue exorcist")) return "https://animationdigitalnetwork.fr/video/blue-exorcist";
        if (t.includes("oshi no ko")) return "https://animationdigitalnetwork.fr/video/oshi-no-ko";
        if (t.includes("boruto")) return "https://animationdigitalnetwork.fr/video/boruto";
        if (t.includes("détective conan") || t.includes("detective conan")) return "https://animationdigitalnetwork.fr/video/detective-conan";
        if (t.includes("attaque des titans") || t.includes("attack on titan")) return "https://animationdigitalnetwork.fr/video/l-attaque-des-titans";
        if (t.includes("jujutsu kaisen")) return "https://animationdigitalnetwork.fr/video/jujutsu-kaisen";
        if (t.includes("demon slayer") || t.includes("tueur de demons")) return "https://animationdigitalnetwork.fr/video/demon-slayer";
        if (t.includes("dr. stone") || t.includes("dr.stone")) return "https://animationdigitalnetwork.fr/video/dr-stone";
        if (t.includes("vinland saga")) return "https://animationdigitalnetwork.fr/video/vinland-saga";
        if (t.includes("fire force")) return "https://animationdigitalnetwork.fr/video/fire-force";
        return null;
    };

    // Auto-backfill Netflix URLs
    const getNetflixUrlForShow = (titleFr) => {
        const t = titleFr.toLowerCase();
        if (t.includes("demon slayer")) return "https://www.netflix.com/title/81091979";
        if (t.includes("hunter x hunter") || t.includes("hunterxhunter")) return "https://www.netflix.com/title/70300472";
        if (t.includes("naruto")) return "https://www.netflix.com/title/747490";
        if (t.includes("one piece")) return "https://www.netflix.com/title/80217863";
        if (t.includes("attaque des titans") || t.includes("attack on titan")) return "https://www.netflix.com/title/70299043";
        if (t.includes("jujutsu kaisen")) return "https://www.netflix.com/title/81278456";
        if (t.includes("my hero academia")) return "https://www.netflix.com/title/80182056";
        if (t.includes("death note")) return "https://www.netflix.com/title/70204970";
        if (t.includes("vinland saga")) return "https://www.netflix.com/title/81249833";
        if (t.includes("chainsaw man")) return "https://www.netflix.com/title/81617290";
        if (t.includes("monster")) return "https://www.netflix.com/title/81648083";
        if (t.includes("one punch") || t.includes("one-punch")) return "https://www.netflix.com/title/80117291";
        if (t.includes("tokyo ghoul")) return "https://www.netflix.com/title/80040119";
        if (t.includes("seven deadly sins")) return "https://www.netflix.com/title/80050063";
        if (t.includes("assassination classroom")) return "https://www.netflix.com/title/80062008";
        if (t.includes("violet evergarden")) return "https://www.netflix.com/title/80191371";
        if (t.includes("cyberpunk")) return "https://www.netflix.com/title/81054853";
        if (t.includes("haikyu")) return "https://www.netflix.com/title/80090673";
        if (t.includes("pluto")) return "https://www.netflix.com/title/81281344";
        if (t.includes("baki")) return "https://www.netflix.com/title/80204451";
        return null;
    };

    // Auto-backfill Disney+ URLs
    const getDisneyUrlForShow = (titleFr) => {
        const t = titleFr.toLowerCase();
        if (t.includes("bleach")) return "https://www.disneyplus.com/series/bleach/3v4e3Xk1xT4D";
        if (t.includes("tokyo revengers")) return "https://www.disneyplus.com/series/tokyo-revengers/4M6kE5S7H1T3";
        if (t.includes("summer time") || t.includes("time shadow") || t.includes("rendering")) return "https://www.disneyplus.com/series/summer-time-rendering/4M6kE5S7H1T4";
        if (t.includes("heavenly delusion") || t.includes("tengoku daimakyo") || t.includes("heavenly")) return "https://www.disneyplus.com/series/heavenly-delusion/4F6kE8S7H2T4";
        if (t.includes("sand land")) return "https://www.disneyplus.com/series/sand-land-the-series/3F5kE7S6H1T3";
        if (t.includes("undead unluck")) return "https://www.disneyplus.com/series/undead-unluck/3F5kE7S6H1T4";
        if (t.includes("fable")) return "https://www.disneyplus.com/series/the-fable/5G6kE9S8H3T6";
        if (t.includes("ranger reject") || t.includes("loser ranger")) return "https://www.disneyplus.com/series/go-go-loser-ranger/5G6kE9S8H3T7";
        return null;
    };

    // Auto-backfill Prime Video URLs
    const getPrimeUrlForShow = (titleFr) => {
        const t = titleFr.toLowerCase();
        if (t.includes("vinland saga")) return "https://www.primevideo.com/detail/Vinland-Saga/0GD1C5S4H3T2";
        if (t.includes("demon slayer")) return "https://www.primevideo.com/detail/Demon-Slayer-Kimetsu-no-Yaiba/0GD1C5S4H3T1";
        if (t.includes("evangelion")) return "https://www.primevideo.com/detail/Evangelion-3010-Thrice-Upon-a-Time/0GD1C5S4H3T4";
        if (t.includes("banana fish")) return "https://www.primevideo.com/detail/BANANA-FISH/0GD1C5S4H3T5";
        if (t.includes("dororo")) return "https://www.primevideo.com/detail/Dororo/0GD1C5S4H3T6";
        if (t.includes("goldorak")) return "https://www.primevideo.com/detail/Goldorak/0GD1C5S4H3T3";
        if (t.includes("hunter x hunter") || t.includes("hunterxhunter")) return "https://www.primevideo.com/detail/Hunter-x-Hunter/0GD1C5S4H3T7";
        if (t.includes("attaque des titans") || t.includes("attack on titan")) return "https://www.primevideo.com/detail/Attack-on-Titan/0GD1C5S4H3T8";
        if (t.includes("my hero academia")) return "https://www.primevideo.com/detail/My-Hero-Academia/0GD1C5S4H3T9";
        return null;
    };
    
    mergedList.forEach(anime => {
        if (!anime.adnUrl) {
            anime.adnUrl = getAdnUrlForShow(anime.titleFr);
        }
        if (!anime.netflixUrl) {
            anime.netflixUrl = getNetflixUrlForShow(anime.titleFr);
        }
        if (!anime.disneyUrl) {
            anime.disneyUrl = getDisneyUrlForShow(anime.titleFr);
        }
        if (!anime.primeUrl) {
            anime.primeUrl = getPrimeUrlForShow(anime.titleFr);
        }

        // Recale la derniere saison si la somme des episodes par saison ne
        // correspond pas au total reel (donnees de scan desynchronisees) :
        // sinon les derniers episodes de la serie n'apparaissent jamais
        // dans la liste du lecteur (boucle bornee par season.episodesCount).
        if (anime.seasons && Array.isArray(anime.seasons) && anime.seasons.length > 0 && anime.episodesTotal > 0) {
            const seasonsTotal = anime.seasons.reduce((sum, s) => sum + (s.episodesCount || 0), 0);
            const diff = anime.episodesTotal - seasonsTotal;
            if (diff !== 0) {
                const lastSeason = anime.seasons[anime.seasons.length - 1];
                lastSeason.episodesCount = Math.max(1, lastSeason.episodesCount + diff);
            }
        }
    });

    // 2. Load progress data
    let progressData = {};
    const savedProgress = localStorage.getItem("crunchy_tracker_progress_v2");
    
    if (savedProgress) {
        try {
            progressData = JSON.parse(savedProgress);
        } catch (e) {
            console.error("Failed to parse progressData", e);
        }
    } else {
        // Fallback / Migration: Try to load from old crunchy_tracker_animes key
        const oldSavedData = localStorage.getItem("crunchy_tracker_animes");
        if (oldSavedData) {
            try {
                const oldList = JSON.parse(oldSavedData);
                if (Array.isArray(oldList)) {
                    oldList.forEach(oldAnime => {
                        if (oldAnime.episodesWatched > 0 || oldAnime.status !== "plan-to-watch" || oldAnime.rating > 0) {
                            progressData[oldAnime.id] = {
                                episodesWatched: oldAnime.episodesWatched,
                                status: oldAnime.status,
                                rating: oldAnime.rating
                            };
                        }
                    });
                    // Save in new format
                    localStorage.setItem("crunchy_tracker_progress_v2", JSON.stringify(progressData));
                    // Remove old heavy key to free space
                    localStorage.removeItem("crunchy_tracker_animes");
                    console.log("Migration vers le format de stockage allégé réussie !");
                }
            } catch (e) {
                console.error("Failed to migrate old data", e);
            }
        }
    }
    
    // 3. Apply progress and restore custom shows
    const finalActiveList = [];
    
    // Track which default IDs we've processed
    const processedIds = new Set();
    
    // Process progressData
    Object.keys(progressData).forEach(id => {
        const record = progressData[id];
        if (record && record.isCustom) {
            finalActiveList.push(record);
        } else {
            const defaultAnime = mergedList.find(a => a.id === id);
            if (defaultAnime) {
                processedIds.add(id);
                // Pas de doublage VF confirmé : exclu du classement,
                // même avec une progression déjà commencée ou terminée.
                if (defaultAnime.noVf) return;
                const updated = { ...defaultAnime };
                updated.episodesWatched = record.episodesWatched || 0;
                updated.status = record.status || "plan-to-watch";
                updated.rating = record.rating || 0;
                // Reapplique les champs mis a jour par un sync AniList precedent
                // (total d'episodes reel, saisons, prochain episode, liens...) :
                // sans ca, loadData() les regenererait depuis catalog.js statique
                // et perdrait la mise a jour a chaque rechargement de page.
                SYNC_PERSISTED_FIELDS.forEach(key => {
                    if (record[key] !== undefined) updated[key] = record[key];
                });
                finalActiveList.push(updated);
            }
        }
    });

    // Add remaining default catalog shows that have no progress yet.
    // Les animés sans doublage VF confirmé (noVf) sont exclus du classement.
    mergedList.forEach(defaultAnime => {
        if (!processedIds.has(defaultAnime.id) && !defaultAnime.noVf) {
            finalActiveList.push(defaultAnime);
        }
    });
    
    animeList = finalActiveList;
    
    // Standard migration check for missing seasons on loaded custom entries
    let migrated = false;
    animeList.forEach(anime => {
        if (!anime.seasons && typeof DEFAULT_ANIME_DATA !== 'undefined') {
            const defaultAnime = DEFAULT_ANIME_DATA.find(d => d.id === anime.id || d.titleFr === anime.titleFr);
            if (defaultAnime && defaultAnime.seasons) {
                anime.seasons = defaultAnime.seasons;
                migrated = true;
            }
        }
    });
    if (migrated) {
        saveData();
    }
}

function saveData() {
    const progressData = {};
    animeList.forEach(anime => {
        const defaultAnime = DEFAULT_ANIME_DATA.find(d => d.id === anime.id);
        const isCustom = !defaultAnime;
        if (isCustom) {
            // For custom shows, save the full object
            progressData[anime.id] = {
                ...anime,
                isCustom: true
            };
        } else {
            // Champs mis a jour par un sync AniList (total reel, saisons,
            // prochain episode, liens...) : a persister des qu'ils different
            // du catalogue statique, sinon perdus au prochain chargement.
            const syncFields = {};
            let hasSyncDrift = false;
            SYNC_PERSISTED_FIELDS.forEach(key => {
                if (JSON.stringify(anime[key]) !== JSON.stringify(defaultAnime[key])) {
                    syncFields[key] = anime[key];
                    hasSyncDrift = true;
                }
            });
            // For catalog shows, save user progress fields (+ sync drift if any)
            if (anime.episodesWatched > 0 || anime.status !== "plan-to-watch" || anime.rating > 0 || hasSyncDrift) {
                progressData[anime.id] = {
                    episodesWatched: anime.episodesWatched,
                    status: anime.status,
                    rating: anime.rating,
                    ...syncFields
                };
            }
        }
    });
    try {
        localStorage.setItem("crunchy_tracker_progress_v2", JSON.stringify(progressData));
    } catch (e) {
        console.error("Failed to save progress to localStorage", e);
    }
}

// ==========================================================================
// RENDERING & LAYOUT
// ==========================================================================
// ==========================================================================
// HERO IMMERSIF — animé à reprendre (ou tendance de la saison)
// ==========================================================================
let heroPickId = null;

function renderHero() {
    const hero = document.getElementById("hero-section");
    if (!hero) return;

    let pick = heroPickId ? animeList.find(a => a.id === heroPickId) : null;
    if (!pick) {
        // Priorité : l'animé en cours le plus avancé (à reprendre)
        pick = animeList
            .filter(a => a.status === "watching" && a.episodesWatched > 0 && a.episodesWatched < a.episodesTotal && a.imageUrl)
            .sort((a, b) => (b.episodesWatched / b.episodesTotal) - (a.episodesWatched / a.episodesTotal))[0];
        // Sinon : une tendance en cours de diffusion
        if (!pick) {
            const trending = animeList.filter(a => a.airingStatus === "RELEASING" && a.imageUrl && !a.unavailable && parseFloat(a.siteRating || 0) >= 4);
            pick = trending.length > 0 ? trending[Math.floor(Math.random() * trending.length)] : null;
        }
        if (pick) heroPickId = pick.id;
    }
    if (!pick) {
        hero.style.display = "none";
        return;
    }

    const total = parseInt(pick.episodesTotal || 0);
    const watched = parseInt(pick.episodesWatched || 0);
    const isResume = pick.status === "watching" && watched > 0 && watched < total;
    const nextEp = Math.min(watched + 1, total);
    const pct = total > 0 ? Math.round((watched / total) * 100) : 0;
    const genres = (pick.genres || "").split(",").slice(0, 3).map(g => g.trim()).filter(Boolean).join(" · ");

    hero.style.display = "flex";
    hero.innerHTML = `
        <div class="hero-inner">
            <img class="hero-poster" src="${pick.imageUrl}" alt="${pick.titleFr}">
            <div class="hero-content">
                <span class="hero-kicker">${isResume ? "Reprendre la lecture" : "Tendance de la saison"}</span>
                <h2 class="hero-title">${pick.titleFr}</h2>
                <div class="hero-meta">
                    <span><span class="star">★</span> ${pick.siteRating || "—"}</span>
                    ${genres ? `<span>${genres}</span>` : ""}
                    <span>${total} épisode${total > 1 ? "s" : ""}</span>
                </div>
                ${pick.synopsis ? `<p class="hero-synopsis">${pick.synopsis.split("\n")[0]}</p>` : ""}
                <div class="hero-actions">
                    <button class="hero-play-btn" id="hero-play-btn">
                        <svg viewBox="0 0 24 24" fill="currentColor" style="width: 16px; height: 16px;"><polygon points="6 3 20 12 6 21 6 3"></polygon></svg>
                        ${isResume ? `Reprendre l'épisode ${nextEp}` : "Commencer à regarder"}
                    </button>
                    <button class="hero-details-btn" id="hero-details-btn">Détails</button>
                </div>
                ${isResume ? `
                    <div class="hero-progress">
                        <div class="hero-progress-label"><span>Progression</span><span>${watched} / ${total} (${pct}%)</span></div>
                        <div class="hero-progress-track"><div class="hero-progress-fill" style="width: ${pct}%"></div></div>
                    </div>
                ` : ""}
            </div>
        </div>
    `;

    // Auto-translate hero synopsis in background if in English
    if (pick.synopsis && isEnglishText(pick.synopsis)) {
        const pickId = pick.id;
        translateTextToFrench(pick.synopsis).then(translated => {
            // Retrouve l'objet courant par id : si loadData() a relance entre
            // temps (pull cloud), "pick" reference un objet qui n'est plus
            // dans animeList et la mutation ne serait jamais persistee.
            const current = animeList.find(a => a.id === pickId);
            if (current && translated && translated !== current.synopsis) {
                current.synopsis = translated;
                saveData();
                const heroSynEl = hero.querySelector(".hero-synopsis");
                if (heroSynEl) {
                    heroSynEl.textContent = translated.split("\n")[0];
                }
            }
        });
    }
    const playBtn = document.getElementById("hero-play-btn");
    if (playBtn) playBtn.addEventListener("click", () => openPlayerModal(pick.id));
    const detailsBtn = document.getElementById("hero-details-btn");
    if (detailsBtn) detailsBtn.addEventListener("click", () => showAnimeDetails(pick.id));
}



function updateStats() {
    const visibleList = animeList.filter(a => a.status !== "hidden");
    const total = visibleList.length;
    const completed = visibleList.filter(a => a.status === "completed").length;

    // Completion Pct (completed animes / total animes)
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    statCompletionPct.textContent = `${pct}%`;
    statProgressBar.style.width = `${pct}%`;

    renderHero();
}

// Détection automatique de la version française (VF vs VOSTFR)
function detectIfVf(anime) {
    if (anime.audio === "vf") return true;
    if (anime.audio === "vostfr") return false;

    // Si le titre contient explicitement VF
    if (anime.titleFr && /\bVF\b/i.test(anime.titleFr)) return true;
    if (anime.titleOrig && /\bVF\b/i.test(anime.titleOrig)) return true;

    // Si le casting contient des acteurs français
    if (anime.cast) {
        const castLower = anime.cast.toLowerCase();
        const frenchIndicators = [
            "adrien", "bastien", "bruno", "caroline", "christophe", "emmanuel", "enzo", "gregory", 
            "lilly", "marie", "nathalie", "vincent", "arnaud", "benjamin", "carole", "catherine", 
            "david", "eric", "françois", "jean", "julien", "laurent", "nicolas", "olivier", 
            "patrice", "philippe", "stephane", "thierry", "valerie", "adeline", "bourlé", "bienaimé"
        ];
        if (frenchIndicators.some(name => castLower.includes(name))) {
            return true;
        }
    }
    
    // Par défaut (toutes les séries du catalogue principal sont historiquement doublées en VF)
    return true;
}

function renderGrid() {
    // 1. Filter
    let filteredList = animeList.filter(anime => {
        // Plus de filtre par statut dans l'UI : les animes masques restent
        // simplement exclus de la grille principale.
        if (anime.status === "hidden") {
            return false;
        }

        // Platform filter
        if (currentPlatform !== "all") {
            if (currentPlatform === "crunchyroll" && !anime.crunchyrollUrl) return false;
            if (currentPlatform === "adn" && !anime.adnUrl) return false;
            if (currentPlatform === "netflix" && !anime.netflixUrl) return false;
            if (currentPlatform === "disney" && !anime.disneyUrl) return false;
            if (currentPlatform === "prime" && !anime.primeUrl) return false;
        }
        
        // Search filter
        if (currentSearch && currentSearch.trim() !== "") {
            const query = currentSearch.toLowerCase().trim();
            const matchTitleFr = (anime.titleFr || "").toLowerCase().includes(query);
            const matchTitleOrig = anime.titleOrig ? anime.titleOrig.toLowerCase().includes(query) : false;
            const matchGenres = anime.genres ? anime.genres.toLowerCase().includes(query) : false;
            const matchCast = anime.cast ? anime.cast.toLowerCase().includes(query) : false;
            return matchTitleFr || matchTitleOrig || matchGenres || matchCast;
        }
        
        return true;
    });
    
    // Helper functions for raw date comparisons
    const getStartDateMs = (anime) => {
        if (!anime.rawStartDate || !anime.rawStartDate.year) return 0;
        const y = anime.rawStartDate.year;
        const m = (anime.rawStartDate.month || 1) - 1;
        const d = anime.rawStartDate.day || 1;
        return new Date(y, m, d).getTime();
    };

    const getEndDateMs = (anime) => {
        if (anime.airingStatus === 'RELEASING') {
            // Toutes les series en cours recevaient exactement la meme valeur
            // (Date.now() + constante) : le tri "Dernier episode (Recent)" les
            // regroupait alors par ordre ALPHABETIQUE entre elles, sans aucun
            // rapport avec une vraie date. On utilise la meilleure info
            // disponible : le prochain episode connu (cadence hebdo -7j pour
            // approximer le dernier deja diffuse), sinon la date de sortie
            // (rawEndDate n'a de toute facon jamais de sens pour une serie
            // encore en cours), et seulement en dernier recours la valeur par
            // defaut qui garde la fiche en tete faute de toute information.
            if (anime.nextAiringAt) return anime.nextAiringAt * 1000 - (7 * 86400000);
            if (anime.rawStartDate && anime.rawStartDate.year) {
                const y = anime.rawStartDate.year;
                const m = (anime.rawStartDate.month || 1) - 1;
                const d = anime.rawStartDate.day || 1;
                return new Date(y, m, d).getTime();
            }
            return Date.now() + 10000000000; // aucune info : garder en tete par defaut
        }
        if (!anime.rawEndDate || !anime.rawEndDate.year) return 0;
        const y = anime.rawEndDate.year;
        const m = (anime.rawEndDate.month || 1) - 1;
        const d = anime.rawEndDate.day || 1;
        return new Date(y, m, d).getTime();
    };

    // 2. Sort
    filteredList.sort((a, b) => {
        if (currentSort === "alphabetical") {
            return (a.titleFr || "").localeCompare(b.titleFr || "", "fr", { sensitivity: "base" });
        }
        
        if (currentSort === "rating") {
            // Unrated goes to the bottom
            const rA = a.rating || 0;
            const rB = b.rating || 0;
            if (rA !== rB) return rB - rA;
            return (a.titleFr || "").localeCompare(b.titleFr || "", "fr", { sensitivity: "base" });
        }
        
        if (currentSort === "episodes-left") {
            const leftA = Math.max(0, (a.episodesTotal || 0) - (a.episodesWatched || 0));
            const leftB = Math.max(0, (b.episodesTotal || 0) - (b.episodesWatched || 0));
            if (leftA !== leftB) return leftA - leftB; // Lesser episodes left first
            return (a.titleFr || "").localeCompare(b.titleFr || "", "fr", { sensitivity: "base" });
        }
        
        if (currentSort === "progress-pct") {
            // Meme garde que le tri "episodes-left" juste au-dessus (||0, pas
            // ||1) : les deux traitaient differemment le meme cas limite
            // episodesTotal:0, avec des resultats contradictoires entre eux.
            const totalA = a.episodesTotal || 0;
            const totalB = b.episodesTotal || 0;
            const pctA = totalA > 0 ? (a.episodesWatched || 0) / totalA : 0;
            const pctB = totalB > 0 ? (b.episodesWatched || 0) / totalB : 0;
            if (pctA !== pctB) return pctB - pctA; // Highest progress first
            return (a.titleFr || "").localeCompare(b.titleFr || "", "fr", { sensitivity: "base" });
        }

        if (currentSort === "release-date-desc") {
            const tA = getStartDateMs(a);
            const tB = getStartDateMs(b);
            if (tA !== tB) return tB - tA; // Newest first
            return (a.titleFr || "").localeCompare(b.titleFr || "", "fr", { sensitivity: "base" });
        }

        if (currentSort === "release-date-asc") {
            const tA = getStartDateMs(a);
            const tB = getStartDateMs(b);
            if (tA !== tB) return tA - tB; // Oldest first
            return (a.titleFr || "").localeCompare(b.titleFr || "", "fr", { sensitivity: "base" });
        }

        if (currentSort === "last-episode-desc") {
            const tA = getEndDateMs(a);
            const tB = getEndDateMs(b);
            if (tA !== tB) return tB - tA; // Latest first
            return (a.titleFr || "").localeCompare(b.titleFr || "", "fr", { sensitivity: "base" });
        }
        
        return 0;
    });
    
    // 3. Render HTML
    animeGrid.innerHTML = "";
    
    // Titre de section dynamique au-dessus de la grille
    const gridHeading = document.getElementById("grid-heading");
    if (gridHeading) {
        const label = currentSearch
            ? `Résultats pour « ${currentSearch} »`
            : "Tout le catalogue";
        gridHeading.style.display = "flex";
        gridHeading.innerHTML = `<span>${label}</span><span class="grid-heading-count">${filteredList.length} animé${filteredList.length > 1 ? "s" : ""}</span>`;
    }

    if (filteredList.length === 0) {
        animeGrid.style.display = "none";
        emptyState.style.display = "flex";
        return;
    }

    animeGrid.style.display = "grid";
    emptyState.style.display = "none";

    // Rendu par lots (requestAnimationFrame) : construire les ~600+ fiches en un
    // seul passage synchrone gèle visiblement le thread principal. On étale la
    // construction sur plusieurs frames et on annule via renderToken si un
    // nouveau renderGrid() démarre entre-temps (recherche/tri/filtre rapides).
    const myRenderToken = ++renderToken;
    const CHUNK_SIZE = 60;
    let cursor = 0;

    function renderChunk() {
        if (myRenderToken !== renderToken) return;
        const fragment = document.createDocumentFragment();
        const end = Math.min(cursor + CHUNK_SIZE, filteredList.length);
        for (; cursor < end; cursor++) {
            fragment.appendChild(createAnimeCard(filteredList[cursor]));
        }
        animeGrid.appendChild(fragment);
        if (cursor < filteredList.length) {
            requestAnimationFrame(renderChunk);
        }
    }
    renderChunk();
}

function createAnimeCard(anime) {
        const card = document.createElement("div");
        card.className = "anime-card" + (anime.unavailable ? " unavailable" : "");
        card.setAttribute("data-id", anime.id);
        card.setAttribute("data-status", anime.status);
        
        // Progress calculations
        const watched = parseInt(anime.episodesWatched || 0);
        const total = parseInt(anime.episodesTotal || 0);

        // Image URL handling
        const coverSrc = anime.imageUrl ? anime.imageUrl : getFallbackImage(anime.titleFr);
        const safeTitleFr = escapeHtml(anime.titleFr || "Sans titre");
        const safeTitleOrig = escapeHtml(anime.titleOrig || "");
        const safeCast = escapeHtml(anime.cast || "");
        
        // Stars rendering
        const starsText = anime.rating > 0 ? `★ ${anime.rating}` : "Pas noté";
        
        // Auto-detect VF/VOSTFR
        const isVf = detectIfVf(anime);
        
        card.innerHTML = `
            <div class="card-image-wrapper js-open-details" role="button" tabindex="0" aria-label="Voir les détails de ${safeTitleFr}">
                <img class="card-image" src="${coverSrc}" alt="Affiche de ${safeTitleFr}" loading="lazy">
                <div class="card-overlay"></div>
                <span class="card-badge-vf ${isVf ? 'vf' : 'vostfr'}">${isVf ? 'VF' : 'VOSTFR'}</span>
                <div class="card-platform-badges">
                    ${anime.crunchyrollUrl ? `
                        <span class="platform-badge cr" title="Disponible sur Crunchyroll">
                            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.909 13.436C2.914 7.61 7.642 2.893 13.468 2.898c5.576.005 10.137 4.339 10.51 9.819q.021-.351.022-.706C24.007 5.385 18.64.006 12.012 0S.007 5.36 0 11.988 5.36 23.994 11.988 24q.412 0 .815-.027c-5.526-.338-9.9-4.928-9.894-10.537zM16.63 7.828a4.195 4.195 0 00-4.186 4.198 4.194 4.194 0 004.21 4.186 4.195 4.195 0 004.186-4.198 4.194 4.194 0 00-4.21-4.186z"/></svg>
                        </span>
                    ` : ''}
                    ${anime.adnUrl ? `
                        <span class="platform-badge adn" title="Disponible sur ADN">
                            <svg viewBox="0 0 24 24">
                                <text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" fill="#ffffff" font-family="'Outfit', sans-serif" font-weight="900" font-size="10px" letter-spacing="-0.5px">adn</text>
                            </svg>
                        </span>
                    ` : ''}
                    ${anime.netflixUrl ? `
                        <span class="platform-badge netflix" title="Disponible sur Netflix">
                            <svg viewBox="0 0 24 24" style="background-color: #000; border-radius: 50%;">
                                <path d="M16 4h3.5v16H16z" fill="#E50914"/>
                                <path d="M4.5 4H8v16H4.5z" fill="#E50914"/>
                                <path d="M8 4h4l8 16h-4z" fill="#B20710"/>
                            </svg>
                        </span>
                    ` : ''}
                    ${anime.disneyUrl ? `
                        <span class="platform-badge disney" title="Disponible sur Disney+">
                            <svg viewBox="0 0 24 24">
                                <path d="M2.5 16.5c4-7.5 11.5-10.5 19-8.5" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round"/>
                                <path d="M7 6.5h3.5c2 0 3.5 1 3.5 3s-1.5 3-3.5 3H7V6.5zm3 2v2h.5c.5 0 .8-.3.8-1s-.3-1-.8-1H10z" fill="#ffffff"/>
                                <path d="M17.5 10.5h3M19 9v3" fill="none" stroke="#ffffff" stroke-width="1.2" stroke-linecap="round"/>
                            </svg>
                        </span>
                    ` : ''}
                    ${anime.primeUrl ? `
                        <span class="platform-badge prime" title="Disponible sur Prime Video">
                            <svg viewBox="0 0 24 24">
                                <path d="M3 9.5h1.5v1.2c.3-.6.9-1.2 1.8-1.2c1.2 0 1.8.6 1.8 1.8V15H6.8v-3.5c0-.6-.2-.9-.7-.9s-.9.3-.9.9V15H3.8V9.5zm6.5 0h1.5v1.2c.3-.6.9-1.2 1.8-1.2c1.2 0 1.8.6 1.8 1.8V15h-1.5v-3.5c0-.6-.2-.9-.7-.9s-.9.3-.9.9V15H9.5V9.5z" fill="#ffffff"/>
                                <path d="M3.5 17c3.5 2 9.5 2 13 0" fill="none" stroke="#00a8e1" stroke-width="1.5" stroke-linecap="round"/>
                                <path d="M16 16.2l.8.8l-1.2.4" fill="none" stroke="#00a8e1" stroke-width="1.5" stroke-linecap="round"/>
                            </svg>
                        </span>
                    ` : ''}
                </div>
                ${anime.airingStatus ? `
                    <span class="card-badge-airing ${anime.airingStatus === 'RELEASING' ? 'releasing' : 'finished'}">
                        ${anime.airingStatus === 'RELEASING' ? 'En Cours' : 'Terminé'}
                    </span>
                ` : ''}
                ${anime.unavailable ? `
                    <span class="card-badge-unavailable" title="Cet animé n'est plus proposé en streaming légal (VF) actuellement">Indisponible</span>
                ` : ''}
                <div class="card-hover-meta">
                    <span class="hover-line"><span class="star">★</span> ${anime.siteRating || "—"} &nbsp;•&nbsp; ${total} épisode${total > 1 ? 's' : ''}</span>
                    ${anime.genres ? `<span class="hover-line">${escapeHtml(anime.genres.split(',').slice(0, 3).join(' · '))}</span>` : ''}
                    <span class="hover-line">${total === 0 ? 'Total inconnu' : total - watched > 0 ? `${total - watched} épisode${total - watched > 1 ? 's' : ''} restant${total - watched > 1 ? 's' : ''}` : 'Terminé ✓'}</span>
                </div>
                <span class="card-rating-overlay" title="Note officielle de la communauté (Crunchyroll / AniList)">
                    <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                    <span>${anime.siteRating || '4.2'}</span>
                </span>
            </div>
            
            <div class="card-content">
                <div class="card-header-info js-open-details">
                    <h3 class="card-title-fr">${safeTitleFr}</h3>
                    <div class="card-title-orig">
                        ${anime.seasons && Array.isArray(anime.seasons) && anime.seasons.length > 0
                            ? `${anime.seasons.length} Saison${anime.seasons.length > 1 ? 's' : ''}${anime.titleOrig ? ' • ' + safeTitleOrig : ''}`
                            : `${anime.season ? escapeHtml(anime.season) + ' • ' : ''}${safeTitleOrig}`
                        }
                    </div>
                    ${anime.cast ? `
                        <div class="card-cast" title="${safeCast}">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
                                <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                                <line x1="12" y1="19" x2="12" y2="22"></line>
                            </svg>
                            <span>VF : ${safeCast}</span>
                        </div>
                    ` : ''}
                </div>
                
                <div class="card-progress-section">
                    <div class="progress-info-row">
                        <span class="progress-label">Épisodes</span>
                        <span class="progress-value">${total}</span>
                    </div>
                </div>
            </div>
        `;
        
        // Add onerror handler to the image element
        const cardImg = card.querySelector(".card-image");
        cardImg.onerror = () => {
            cardImg.onerror = null; // evite une boucle si le repli echoue aussi
            cardImg.src = getFallbackImage(anime.titleFr);
        };
        
        // Setup card interactivity
        // Detail Trigger elements
        card.querySelectorAll(".js-open-details").forEach(elem => {
            elem.addEventListener("click", () => showAnimeDetails(anime.id));
            // Support clavier (Enter/Espace) sur l'element focusable
            // (role="button" tabindex="0") : sans ca, toute la grille n'etait
            // utilisable qu'a la souris/au tactile.
            if (elem.getAttribute("role") === "button") {
                elem.addEventListener("keydown", (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        showAnimeDetails(anime.id);
                    }
                });
            }
        });

        return card;
}

// ==========================================================================
// ANIME MUTATION FUNCTIONS
// ==========================================================================
function changeEpisodeCount(id, newCount) {
    const idx = animeList.findIndex(a => a.id === id);
    if (idx === -1) return;
    
    const anime = animeList[idx];
    const total = parseInt(anime.episodesTotal || 0);
    const safeNewCount = parseInt(newCount, 10) || 0; // evite un episodesWatched = NaN
    let finalCount = Math.max(0, Math.min(safeNewCount, total));

    anime.episodesWatched = finalCount;
    
    // Automatically change status on thresholds
    if (finalCount === total && total > 0 && anime.status !== "completed") {
        anime.status = "completed";
    } else if (finalCount > 0 && finalCount < total && (anime.status === "plan-to-watch" || anime.status === "on-hold")) {
        anime.status = "watching";
    } else if (finalCount === 0 && (anime.status === "completed" || anime.status === "watching")) {
        anime.status = "plan-to-watch";
    }
    
    saveData();
    updateStats();
    renderGrid();
}

// ==========================================================================
// DETAILS MODAL RENDERING
// ==========================================================================
function showAnimeDetails(id) {
    const anime = animeList.find(a => a.id === id);
    if (!anime) return;
    
    const total = parseInt(anime.episodesTotal || 0);

    // Format rating stars
    let starsHtml = "";
    for (let i = 1; i <= 5; i++) {
        if (i <= (anime.rating || 0)) {
            starsHtml += `<svg class="filled" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;
        } else {
            starsHtml += `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;
        }
    }
    
    // Format Status String
    let statusText = "À voir";
    if (anime.status === "watching") statusText = "En cours";
    if (anime.status === "completed") statusText = "Terminé";
    if (anime.status === "on-hold") statusText = "En pause";
    
    // Genre rendering
    const genreArray = anime.genres ? anime.genres.split(",").map(g => g.trim()) : [];
    const genreTagsHtml = genreArray.length > 0
        ? genreArray.map(g => `<span class="genre-tag">${g}</span>`).join("")
        : '<span class="text-muted">Aucun genre renseigné</span>';
        
    const coverSrc = anime.imageUrl ? anime.imageUrl : getFallbackImage(anime.titleFr);

    // Build hero banner (we can use the poster image with custom styles or a blurred fallback)
    const safeDetailTitleFr = escapeHtml(anime.titleFr || "Sans titre");
    const safeDetailTitleOrig = escapeHtml(anime.titleOrig || "");
    detailModalBody.innerHTML = `
        <div class="detail-header-hero" style="background-image: linear-gradient(rgba(20, 21, 25, 0.5), rgba(20, 21, 25, 1)), url('${coverSrc}');">
            <div class="detail-hero-content">
                <img class="detail-poster-img" src="${coverSrc}" alt="Affiche">
                <div class="detail-title-block">
                    <h2 class="detail-title-fr">${safeDetailTitleFr}</h2>
                    <div class="detail-title-orig">${safeDetailTitleOrig}</div>
                </div>
            </div>
        </div>
        
        <div class="detail-main-layout">
            <div class="detail-sidebar">
                <div class="detail-sidebar-section">
                    <span class="sidebar-label">Statut Suivi</span>
                    <span class="detail-status-pill ${anime.status}">
                        <span class="indicator ${anime.status}"></span>
                        ${statusText}
                    </span>
                </div>
                
                <div class="detail-sidebar-section">
                    <span class="sidebar-label">Statut de Diffusion</span>
                    <span class="sidebar-value">${anime.airingStatus === 'RELEASING' ? 'En cours' : 'Terminé'}</span>
                </div>

                <div class="detail-sidebar-section">
                    <span class="sidebar-label">Saisons</span>
                    <span class="sidebar-value">
                        ${anime.seasons && Array.isArray(anime.seasons) && anime.seasons.length > 0
                            ? `${anime.seasons.length} Saison${anime.seasons.length > 1 ? 's' : ''}`
                            : anime.season || "1 Saison"
                        }
                    </span>
                </div>

                <div class="detail-sidebar-section">
                    <span class="sidebar-label">Date de Sortie</span>
                    <span class="sidebar-value">${anime.releaseDate || "Inconnue"}</span>
                </div>

                ${anime.lastEpisodeDate ? `
                <div class="detail-sidebar-section">
                    <span class="sidebar-label">Dernier Épisode</span>
                    <span class="sidebar-value">${anime.lastEpisodeDate}</span>
                </div>
                ` : ''}

                ${anime.nextAiringAt ? `
                <div class="detail-sidebar-section" style="border: 1px dashed rgba(34, 197, 94, 0.3); padding: 8px; border-radius: var(--radius-sm); background-color: rgba(34, 197, 94, 0.05);">
                    <span class="sidebar-label" style="color: #22c55e;">Prochain Épisode</span>
                    <span class="sidebar-value" style="font-weight: 700; color: #22c55e;">
                        Épisode ${anime.nextAiringEpisode} : <br>
                        ${new Date(anime.nextAiringAt * 1000).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).replace(':', 'h')}
                    </span>
                </div>
                ` : ''}
                
                <div class="detail-sidebar-section">
                    <span class="sidebar-label">Note Officielle</span>
                    <span class="sidebar-value" style="display: flex; align-items: center; gap: 4px;">
                        <svg viewBox="0 0 24 24" fill="currentColor" style="width: 14px; height: 14px; color: #eab308;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                        ${anime.siteRating || "4.2"} / 5
                    </span>
                </div>

                <div class="detail-sidebar-section">
                    <span class="sidebar-label">Épisodes</span>
                    <span class="sidebar-value">${total}</span>
                </div>
            </div>
            
            <div class="detail-content-area">
                <div class="detail-genre-tags">
                    ${genreTagsHtml}
                </div>
                
                <div>
                    <h3 class="detail-section-title">Synopsis</h3>
                    <p class="detail-synopsis-text">${escapeHtml(anime.synopsis) || "Aucun synopsis disponible pour cet animé."}</p>
                </div>

                ${anime.cast ? `
                <div>
                    <h3 class="detail-section-title">Doublage VF</h3>
                    <p class="detail-cast-list">${escapeHtml(anime.cast)}</p>
                </div>
                ` : ''}

                <div class="detail-btn-row">
                    <button class="btn-primary card-btn-play" id="detail-play-btn">
                        <svg viewBox="0 0 24 24" fill="currentColor" style="width: 14px; height: 14px;"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                        <span style="margin-left: 6px;">Regarder</span>
                    </button>
                    <button class="btn-secondary" id="detail-hide-btn" style="margin-left: auto;">
                        ${anime.status === "hidden" ? `
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                            <span style="margin-left: 6px;">Afficher</span>
                        ` : `
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
                            <span style="margin-left: 6px;">Masquer</span>
                        `}
                    </button>
                    ${!DEFAULT_ANIME_DATA.some(d => d.id === anime.id) ? `
                    <button class="btn-secondary text-danger" id="detail-delete-btn">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        <span style="margin-left: 6px;">Supprimer</span>
                    </button>
                    ` : ''}
                </div>
            </div>
        </div>
    `;

    // Add Event Listeners for Details actions
    document.getElementById("detail-play-btn").addEventListener("click", () => {
        closeModal(detailModal);
        openPlayerModal(anime.id);
    });

    document.getElementById("detail-hide-btn").addEventListener("click", () => {
        if (anime.status === "hidden") {
            anime.status = "plan-to-watch";
        } else {
            anime.status = "hidden";
        }
        saveData();
        updateStats();
        renderGrid();
        closeModal(detailModal);
    });

    const detailDeleteBtn = document.getElementById("detail-delete-btn");
    if (detailDeleteBtn) {
        detailDeleteBtn.addEventListener("click", () => {
            if (confirm(`Supprimer définitivement "${anime.titleFr}" ? Cette action est irréversible.`)) {
                deleteAnime(anime.id);
                closeModal(detailModal);
            }
        });
    }
    
    // Repli image poster + fond du bandeau hero si l'URL de couverture est
    // cassee/bloquee (attache en JS plutot qu'en attribut onerror inline,
    // qui obligeait a un echappement JS-dans-attribut fragile)
    const detailPosterImg = detailModalBody.querySelector(".detail-poster-img");
    const detailHeroEl = detailModalBody.querySelector(".detail-header-hero");
    if (detailPosterImg) {
        detailPosterImg.addEventListener("error", () => {
            const fallback = getFallbackImage(anime.titleFr);
            detailPosterImg.src = fallback;
            if (detailHeroEl) {
                detailHeroEl.style.backgroundImage = `linear-gradient(rgba(20, 21, 25, 0.5), rgba(20, 21, 25, 1)), url('${fallback}')`;
            }
        }, { once: true });
    }

    openModal(detailModal);

    // Auto-translate detail synopsis in background if in English
    if (anime.synopsis && isEnglishText(anime.synopsis)) {
        const animeId = anime.id;
        translateTextToFrench(anime.synopsis).then(translated => {
            // Retrouve l'objet courant par id (voir showRecommendedHero) : evite
            // de muter un objet orphelin si loadData() a relance entre-temps.
            const current = animeList.find(a => a.id === animeId);
            if (current && translated && translated !== current.synopsis) {
                const synTextEl = detailModal.querySelector(".detail-synopsis-text");
                if (synTextEl) {
                    synTextEl.innerHTML = `${escapeHtml(translated)} <span style="font-size: 10px; color: var(--primary); display: block; margin-top: 6px; font-style: italic;">(Traduit automatiquement par l'IA)</span>`;
                }
                current.synopsis = translated;
                saveData();
            }
        });
    }
}

// ==========================================================================
// FORM MODAL HANDLERS (ADD / EDIT)
// ==========================================================================
function openAddAnimeModal() {
    modalTitle.textContent = "Ajouter un Animé";
    animeForm.reset();
    formAnimeId.value = "";
    formSeason.value = "Saison 1";
    formEpisodesTotal.value = 12;
    formEpisodesWatched.value = 0;
    formStatus.value = "plan-to-watch";
    formRating.value = 0;
    formAdnUrl.value = "";
    formNetflixUrl.value = "";
    formDisneyUrl.value = "";
    formPrimeUrl.value = "";
    
    openModal(editModal);
}

function openEditAnimeModal(anime) {
    modalTitle.textContent = "Modifier l'Animé";
    
    formAnimeId.value = anime.id;
    formTitleFr.value = anime.titleFr;
    formTitleOrig.value = anime.titleOrig || "";
    formImageUrl.value = anime.imageUrl || "";
    formCrunchyrollUrl.value = anime.crunchyrollUrl || "";
    formAdnUrl.value = anime.adnUrl || "";
    formNetflixUrl.value = anime.netflixUrl || "";
    formDisneyUrl.value = anime.disneyUrl || "";
    formPrimeUrl.value = anime.primeUrl || "";
    formEpisodesTotal.value = anime.episodesTotal || "";
    formEpisodesWatched.value = anime.episodesWatched || 0;
    formStatus.value = anime.status;
    formRating.value = anime.rating || 0;
    formSeason.value = anime.season || "Saison 1";
    formGenres.value = anime.genres || "";
    formSynopsis.value = anime.synopsis || "";
    formCast.value = anime.cast || "";
    
    openModal(editModal);
}

function handleFormSubmit(e) {
    e.preventDefault();
    
    const id = formAnimeId.value;
    const titleFr = formTitleFr.value.trim();
    const titleOrig = formTitleOrig.value.trim();
    const imageUrl = formImageUrl.value.trim();
    const crunchyrollUrl = formCrunchyrollUrl.value.trim();
    const adnUrl = formAdnUrl.value.trim();
    const netflixUrl = formNetflixUrl.value.trim();
    const disneyUrl = formDisneyUrl.value.trim();
    const primeUrl = formPrimeUrl.value.trim();
    const episodesTotalRaw = formEpisodesTotal.value.trim();
    const episodesTotal = parseInt(episodesTotalRaw, 10);
    const episodesWatched = parseInt(formEpisodesWatched.value) || 0;
    const status = formStatus.value;
    const rating = parseInt(formRating.value) || 0;
    const season = formSeason.value.trim() || "Saison 1";
    const genres = formGenres.value.trim();
    const synopsis = formSynopsis.value.trim();
    const cast = formCast.value.trim();

    // Validation
    if (episodesTotalRaw === "" || isNaN(episodesTotal) || episodesTotal < 1) {
        alert("Merci de renseigner un nombre total d'épisodes valide (au moins 1).");
        return;
    }
    if (episodesWatched > episodesTotal) {
        alert(`Le nombre d'épisodes vus (${episodesWatched}) ne peut pas dépasser le total d'épisodes (${episodesTotal}).`);
        return;
    }
    
    // Ajuster automatiquement le statut en fonction du nombre d'épisodes vus
    let finalStatus = status;
    if (episodesWatched === 0 && (status === "watching" || status === "completed")) {
        finalStatus = "plan-to-watch";
    } else if (episodesWatched > 0 && episodesWatched < episodesTotal && status === "plan-to-watch") {
        finalStatus = "watching";
    } else if (episodesWatched === episodesTotal && episodesTotal > 0 && status !== "completed") {
        finalStatus = "completed";
    }

    if (id) {
        // Edit mode
        const index = animeList.findIndex(a => a.id === id);
        if (index !== -1) {
            animeList[index] = {
                ...animeList[index],
                titleFr,
                titleOrig,
                season,
                imageUrl,
                crunchyrollUrl,
                adnUrl,
                netflixUrl,
                disneyUrl,
                primeUrl,
                episodesTotal,
                episodesWatched,
                status: finalStatus,
                rating,
                genres,
                synopsis,
                cast
            };

        }
    } else {
        // Create mode
        const newAnime = {
            // Suffixe aleatoire en plus du timestamp : deux soumissions tres
            // rapprochees (double clic) partageaient sinon le meme id,
            // rendant la seconde fiche non editable/supprimable (ecrasee
            // dans progressData au prochain saveData()).
            id: 'anime-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
            titleFr,
            titleOrig,
            season,
            imageUrl,
            crunchyrollUrl,
            adnUrl,
            netflixUrl,
            disneyUrl,
            primeUrl,
            episodesTotal,
            episodesWatched,
            status: finalStatus,
            rating,
            genres,
            synopsis,
            cast
        };
        
        animeList.push(newAnime);

    }
    
    saveData();
    updateStats();
    renderGrid();
    closeModal(editModal);
}

function deleteAnime(id) {
    const index = animeList.findIndex(a => a.id === id);
    if (index !== -1) {
        const title = animeList[index].titleFr;
        animeList.splice(index, 1);
        saveData();
        updateStats();
        renderGrid();

    }
}

// ==========================================================================
// MODAL GENERAL UTILS
// ==========================================================================
function openModal(modal) {
    modal.classList.add("show");
    document.body.style.overflow = "hidden"; // Prevent body scroll
}

function closeModal(modal) {
    modal.classList.remove("show");
    document.body.style.overflow = ""; // Re-enable body scroll
}

// ==========================================================================
// IMPORT / EXPORT & BACKUP
// ==========================================================================
function exportToJSON() {
    const dataStr = JSON.stringify(animeList, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    
    const exportFileDefaultName = 'crunchy_tracker_backup.json';
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();

}

function importFromJSON(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(event) {
        try {
            const importedData = JSON.parse(event.target.result);
            importDataList(importedData);
        } catch (err) {
            console.error(err);

        }
    };
    reader.readAsText(file);
    
    // Clear input so same file can be selected again
    e.target.value = "";
}

function importDataList(importedData) {
    if (Array.isArray(importedData) && importedData.length > 0) {
        // Vérifier si c'est un fichier d'historique partiel (export de compte)
        const isPartialHistory = importedData.every(item => item.titleFr && typeof item.episodesTotal === 'undefined');
        // Un backup complet doit aussi avoir un id valide et unique par fiche :
        // sans ca, plusieurs entrees sans id (cle "undefined" dans
        // progressData) fusionnaient/ecrasaient silencieusement leur
        // progression respective dans saveData().
        const hasValidUniqueIds = (() => {
            const ids = importedData.map(item => item.id).filter(id => typeof id === "string" && id.trim() !== "");
            return ids.length === importedData.length && new Set(ids).size === ids.length;
        })();
        const isFullBackup = importedData.every(item => item.titleFr && typeof item.episodesTotal === 'number') && hasValidUniqueIds;

        if (isFullBackup) {
            animeList = importedData;
            saveData();
            updateStats();
            renderGrid();
            alert(`${importedData.length} animés importés (sauvegarde complète restaurée).`);
        } else if (isPartialHistory) {
            // Mode Fusion Historique (Crunchyroll / ADN / autre)
            const source = importedData[0].source || "inconnu";
            let updatedCount = 0;
            let notFoundTitles = [];
            
            importedData.forEach(importedItem => {
                const query = importedItem.titleFr.toLowerCase().trim();
                let localAnime = findBestMatch(query, importedItem);
                
                if (!localAnime && typeof DEFAULT_ANIME_DATA !== 'undefined') {
                    const catalogAnime = findBestMatchInList(query, importedItem, DEFAULT_ANIME_DATA);
                    if (catalogAnime) {
                        localAnime = { ...catalogAnime };
                        animeList.push(localAnime);
                    }
                }
                
                if (localAnime) {
                    const total = parseInt(localAnime.episodesTotal || 12);
                    const newWatched = parseInt(importedItem.episodesWatched || 0);
                    const currentWatched = parseInt(localAnime.episodesWatched || 0);
                    // Garder le maximum entre l'existant et l'import
                    const watched = Math.max(0, Math.min(Math.max(newWatched, currentWatched), total));
                    localAnime.episodesWatched = watched;
                    
                    if (watched === total && total > 0) {
                        localAnime.status = "completed";
                    } else if (watched > 0 && (localAnime.status === "plan-to-watch" || localAnime.status === "on-hold")) {
                        localAnime.status = "watching";
                    }
                    
                    // Mettre à jour l'audio si importé
                    if (importedItem.audio) {
                        localAnime.audio = importedItem.audio;
                    }
                    
                    // Mettre à jour l'URL de la plateforme si disponible
                    if (importedItem.crunchyrollUrl && !localAnime.crunchyrollUrl) {
                        localAnime.crunchyrollUrl = importedItem.crunchyrollUrl;
                    }
                    if (importedItem.adnUrl && !localAnime.adnUrl) {
                        localAnime.adnUrl = importedItem.adnUrl;
                    }
                    
                    updatedCount++;
                } else {
                    notFoundTitles.push(importedItem.titleFr);
                }
            });
            
            if (updatedCount > 0) {
                saveData();
                updateStats();
                renderGrid();
                const sourceLabel = source === "crunchyroll" ? "Crunchyroll"
                    : source === "adn" ? "ADN"
                    : "votre historique";
                let msg = `${updatedCount} animés mis à jour depuis ${sourceLabel} !`;
                if (notFoundTitles.length > 0) {
                    msg += ` (${notFoundTitles.length} non trouvés)`;
                    console.log("[Import] Titres non trouvés:", notFoundTitles);
                }
                alert(msg);
            } else {
                if (notFoundTitles.length > 0) {
                    console.log("[Import] Titres non trouvés:", notFoundTitles);
                }
                alert("Aucun animé correspondant trouvé dans le catalogue pour cet import.");
            }
        } else {
            alert("Format de fichier non reconnu. Vérifiez qu'il s'agit bien d'un export Anime Tracker VF ou d'un historique de plateforme (ADN/Crunchyroll).");
        }
    } else {
        alert("Le fichier importé est vide ou invalide.");
    }
}

// Matching intelligent pour les imports
function findBestMatch(query, importedItem) {
    return findBestMatchInList(query, importedItem, animeList);
}

function findBestMatchInList(query, importedItem, list) {
    // 1. Correspondance exacte par titre FR ou titre original
    let match = list.find(a =>
        a.titleFr.toLowerCase().trim() === query ||
        (a.titleOrig && a.titleOrig.toLowerCase().trim() === query)
    );
    if (match) return match;
    
    // 2. Correspondance par URL Crunchyroll / ADN
    if (importedItem.crunchyrollUrl) {
        const slug = importedItem.crunchyrollUrl.split("/").pop();
        if (slug) {
            match = list.find(a =>
                a.crunchyrollUrl && a.crunchyrollUrl.toLowerCase().includes(slug.toLowerCase())
            );
            if (match) return match;
        }
    }
    if (importedItem.adnUrl) {
        const slug = importedItem.adnUrl.split("/").pop();
        if (slug) {
            match = list.find(a =>
                a.adnUrl && a.adnUrl.toLowerCase().includes(slug.toLowerCase())
            );
            if (match) return match;
        }
    }
    
    // 3. Correspondance partielle (le titre importé est contenu dans le titre local ou inversement)
    match = list.find(a => {
        const localFr = a.titleFr.toLowerCase().trim();
        const localOrig = (a.titleOrig || "").toLowerCase().trim();
        return (localFr.includes(query) || query.includes(localFr)) ||
               (localOrig && (localOrig.includes(query) || query.includes(localOrig)));
    });
    if (match) return match;
    
    // 4. Correspondance par mots-clés (au moins 60% des mots en commun)
    const queryWords = query.split(/[\s\-:,!?''""·.]+/).filter(w => w.length > 2);
    if (queryWords.length >= 2) {
        let bestScore = 0;
        let bestMatch = null;
        
        list.forEach(a => {
            const titleWords = a.titleFr.toLowerCase().split(/[\s\-:,!?''""·.]+/).filter(w => w.length > 2);
            const origWords = (a.titleOrig || "").toLowerCase().split(/[\s\-:,!?''""·.]+/).filter(w => w.length > 2);
            const allWords = [...titleWords, ...origWords];
            
            let matchCount = 0;
            queryWords.forEach(qw => {
                if (allWords.some(tw => tw.includes(qw) || qw.includes(tw))) {
                    matchCount++;
                }
            });
            
            const score = matchCount / queryWords.length;
            if (score > 0.6 && score > bestScore) {
                bestScore = score;
                bestMatch = a;
            }
        });
        
        if (bestMatch) return bestMatch;
    }
    
    return null;
}

function resetToDefault() {
    if (confirm("Attention ! Vous allez réinitialiser l'application. Toutes vos modifications personnelles seront perdues. Continuer ?")) {
        localStorage.removeItem("crunchy_tracker_progress_v2");
        localStorage.removeItem("crunchy_tracker_animes");
        loadData();
        // Persiste (et propage au cloud si connecte) l'etat vierge : sans ca,
        // le prochain pull automatique (focus, intervalle) restaurait
        // silencieusement toute la progression soi-disant reinitialisee.
        saveData();
        updateStats();
        renderGrid();
    }
}

// Map of custom VF trailers
const VF_TRAILER_MAP = {
    "franchise-16498": "m0y4Ym-tCjE", // L'Attaque des Titans
    "franchise-101922": "yW6H4h912eU", // Demon Slayer
    "franchise-113415": "kFh3vO2hAeo", // Jujutsu Kaisen
    "franchise-21459": "Wvj-oN6t-8s", // My Hero Academia
    "franchise-11061": "d6kBeJjTGnY", // Hunter x Hunter
    "franchise-21": "gP6gUqg055o", // One Piece
    "franchise-20605": "p-Tq8i8f2-8", // Tokyo Ghoul
    "franchise-5114": "3k_iA9345eE", // Fullmetal Alchemist: Brotherhood
    "franchise-20": "rF8T5u6r4eU", // Naruto
    "franchise-11757": "q_YqY6wH4-o", // Sword Art Online
    "franchise-120377": "y1GZp_Yt4_U", // Cyberpunk: Edgerunners
    "franchise-99088": "W-YF7EwG_Cg", // Pluto
    "franchise-97888": "zM9gG-4o0eE", // Baki
    "franchise-129201": "HJBauga2be8", // Time Shadow
    "franchise-155783": "YosKbsmZzuD", // Heavenly Delusion
    "franchise-100388": "hjkg1AnlJR5z", // Banana Fish
    "franchise-101347": "TGaDwEYqLfm1"  // Dororo
};

// Memorise les ids YouTube deja constates morts (supprimes/prives/embed
// interdit) pour ne pas rejouer indefiniment le meme delai d'echec de 3.2s
// a chaque ouverture du lecteur pour le meme animé.
const DEAD_TRAILERS_KEY = "crunchy_tracker_dead_trailers";
function getDeadTrailers() {
    try {
        return JSON.parse(localStorage.getItem(DEAD_TRAILERS_KEY) || "{}");
    } catch (e) {
        return {};
    }
}
function markTrailerDead(youtubeId) {
    if (!youtubeId) return;
    const dead = getDeadTrailers();
    dead[youtubeId] = true;
    try {
        localStorage.setItem(DEAD_TRAILERS_KEY, JSON.stringify(dead));
    } catch (e) { /* quota depasse : tant pis, retentera cette session */ }
}

// Chaîne de lecture : trailer VF d'abord, sinon trailer VO (AniList).
// Si aucun ne fonctionne, le lecteur est masqué (pas de vidéo de remplacement).
function getTrailerCandidates(anime) {
    const isValidYoutubeId = (id) => /^[A-Za-z0-9_-]{11}$/.test(id);
    const deadTrailers = getDeadTrailers();
    const candidates = [];
    if (VF_TRAILER_MAP[anime.id]) {
        candidates.push(VF_TRAILER_MAP[anime.id].trim());
    }
    if (anime.trailerId) {
        candidates.push(anime.trailerId.trim());
    }
    return candidates.filter((id, i) => id && isValidYoutubeId(id) && candidates.indexOf(id) === i && !deadTrailers[id]);
}

// Détecteur automatique d'erreur de lecture YouTube (bloquée, privée,
// supprimée...) pour passer à la vidéo suivante de la chaîne.
// Seuls les VRAIS codes d'erreur fatals déclenchent le basculement :
// 2 (id invalide), 5 (lecteur), 100 (introuvable), 101/150 (intégration interdite).
// Les messages de lecture normaux contenant un champ "error" vide sont ignorés.
let lastAutoFallbackAt = 0;
window.addEventListener("message", (event) => {
    try {
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        let errCode = null;
        if (data && data.event === "onError") {
            errCode = parseInt(data.info, 10);
        } else if (data && data.info && typeof data.info === "object" && data.info.error) {
            errCode = parseInt(data.info.error, 10);
        }
        if (!errCode || [2, 5, 100, 101, 150].indexOf(errCode) === -1) return;

        // Anti-rafale : YouTube répète le même message d'erreur plusieurs fois,
        // on ne bascule qu'une étape à la fois.
        const now = Date.now();
        if (now - lastAutoFallbackAt < 1500) return;
        lastAutoFallbackAt = now;

        console.warn("YouTube Player error detected, falling back automatically:", errCode);
        clearActiveYtPlayback();
        const fallbackBtn = document.getElementById("player-fallback-btn");
        if (fallbackBtn) {
            fallbackBtn.click();
        }
    } catch (e) {}
});

// ==========================================================================
// PLAYER MODAL ENGINE
// ==========================================================================
// Le decompte d'autoplay courant (variable de fermeture propre a chaque
// appel de openPlayerModal) est expose ici pour que le handler de fermeture
// de la modale, lui, ne soit attache QU'UNE SEULE FOIS (pas a chaque
// ouverture) : sinon des jeux de listeners identiques s'empilaient sur les
// memes boutons persistants si le lecteur etait rouvert avant que le
// precedent { once: true } ne se soit declenche.
let activeClearCountdown = null;
let playerCloseListenersAttached = false;

function openPlayerModal(animeId, startEpisodeIndex = null) {
    const anime = animeList.find(a => a.id === animeId);
    if (!anime) return;

    const total = parseInt(anime.episodesTotal || 12);
    const watched = parseInt(anime.episodesWatched || 0);
    
    let activeEpisodeNum = startEpisodeIndex;
    if (activeEpisodeNum === null) {
        activeEpisodeNum = watched < total ? watched + 1 : 1;
    }
    
    let currentPlayingEp = Math.max(1, Math.min(activeEpisodeNum, total));

    // Si loadData() remplace animeList pendant que le lecteur reste ouvert
    // (pull cloud sur focus/intervalle, sync AniList...), "anime" reste sinon
    // fige sur l'ancien objet orphelin : on le rafraichit en place (meme
    // reference, donc tout le reste de cette fonction continue de marcher)
    // avant chaque rendu/chargement d'episode.
    const refreshAnimeFromList = () => {
        const fresh = animeList.find(a => a.id === animeId);
        if (fresh && fresh !== anime) Object.assign(anime, fresh);
    };

    // Declare UNE SEULE fois par ouverture de lecteur (pas a chaque episode) :
    // sinon chaque loadEpisode() creait une nouvelle fonction, le
    // removeEventListener suivant ne retirait jamais l'ancien (reference
    // differente) et les listeners "fullscreenchange" s'accumulaient sur
    // document a chaque changement d'episode.
    const fsChangeHandler = () => {
        const fsIcon = document.getElementById("fullscreen-icon-svg");
        if (fsIcon) {
            if (document.fullscreenElement) {
                fsIcon.innerHTML = `<path d="M4 14h6v6m10-6h-6v6M4 10h6V4m10 6h-6V4"></path>`;
            } else {
                fsIcon.innerHTML = `<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>`;
                // Unlock screen orientation when leaving fullscreen
                if (screen.orientation && screen.orientation.unlock) {
                    try {
                        screen.orientation.unlock();
                    } catch (e) {
                        console.warn("Screen orientation unlock failed:", e);
                    }
                }
            }
        }
    };
    document.addEventListener("fullscreenchange", fsChangeHandler);

    let countdownInterval = null;
    let countdownTimeout = null;
    
    const clearCountdown = () => {
        if (countdownInterval) clearInterval(countdownInterval);
        if (countdownTimeout) clearTimeout(countdownTimeout);
        const overlay = videoPlayerWrapper.querySelector(".player-countdown-overlay");
        if (overlay) overlay.remove();
    };
    activeClearCountdown = clearCountdown;


    const loadEpisode = (epNum) => {
        // Annule tout decompte d'autoplay en cours : loadEpisode() remplace le
        // DOM (videoPlayerWrapper.innerHTML) sans arreter les timers, un
        // countdown orphelin pouvait sinon se declencher ~3s plus tard et
        // ecraser un changement d'episode manuel fait entre-temps.
        clearCountdown();
        refreshAnimeFromList();
        currentPlayingEp = epNum;
        const currentWatched = parseInt(anime.episodesWatched || 0);
        
        playerAnimeName.textContent = anime.titleFr;

        playerWatchedBtn.disabled = false;
        playerWatchedBtn.style.opacity = "1";

        // .btn-primary span est masque sous 480px (icone seule) : sans
        // aria-label synchronise, ce bouton devient totalement anonyme pour
        // un lecteur d'ecran sur mobile puisque son texte change dynamiquement.
        const setWatchedBtnLabel = (text) => {
            playerWatchedBtn.querySelector("span").textContent = text;
            playerWatchedBtn.setAttribute("aria-label", text);
        };

        if (epNum === currentWatched) {
            setWatchedBtnLabel(`Marquer l'épisode ${epNum} comme NON vu`);
            playerWatchedBtn.onclick = () => {
                changeEpisodeCount(anime.id, epNum - 1);
                loadEpisode(epNum);
            };
        } else if (epNum < currentWatched) {
            setWatchedBtnLabel(`Définir comme dernier vu (Ép. ${epNum})`);
            playerWatchedBtn.onclick = () => {
                changeEpisodeCount(anime.id, epNum);
                loadEpisode(epNum);
            };
        } else {
            setWatchedBtnLabel(`Marquer l'épisode ${epNum} comme vu`);
            playerWatchedBtn.onclick = () => {
                changeEpisodeCount(anime.id, epNum);

                const autoplayCb = document.getElementById("player-autoplay-cb");
                const isAutoplay = autoplayCb ? autoplayCb.checked : false;
                
                if (isAutoplay && epNum < total) {
                    startAutoplayCountdown(epNum + 1);
                } else if (epNum === total) {
                    videoPlayerWrapper.innerHTML = `
                        <div class="player-placeholder" style="background: linear-gradient(135deg, rgba(20, 21, 25, 0.95), rgba(255, 100, 0, 0.1));">
                            <svg class="player-placeholder-icon" style="color: #22c55e;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                            <h4 style="color:#22c55e;">Saison Terminée !</h4>
                            <p>Félicitations ! Vous avez fini de visionner tous les épisodes de "${anime.titleFr}".</p>
                            <button class="btn-primary" id="player-close-finished-btn">Fermer le lecteur</button>
                        </div>
                    `;
                    document.getElementById("player-close-finished-btn").onclick = () => {
                        closeModal(playerModal);
                        videoPlayerWrapper.innerHTML = "";
                    };
                } else {
                    loadEpisode(epNum);
                }
            };
        }
        
        // Chaîne de lecture : trailer VF -> trailer VO -> opening vidéo de
        // l'animé (animethemes.moe, creditless) -> message "non disponible".
        const trailerCandidates = getTrailerCandidates(anime);
        const mediaSteps = trailerCandidates.map(id => ({ type: "yt", id: id }));
        if (anime.openingUrl) {
            mediaSteps.push({ type: "opening", url: anime.openingUrl });
        }
        let mediaIndex = 0;
        const hasMedia = mediaSteps.length > 0;

        videoPlayerWrapper.innerHTML = `
            <div class="crunchy-mock-player" style="position: relative; overflow: hidden; background: #000; width: 100%; height: 100%;">
                <div class="player-placeholder" style="position: relative; overflow: hidden; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: #0c0d10; padding: 0;">
                    ${hasMedia ? `
                        <div id="player-media-slot" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;"></div>

                        <!-- Transparent shield blocking all mouse interactions with the YouTube video -->
                        <div style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 5; background: transparent;"></div>
                        
                        <!-- Button if video is geoblocked or unavailable -->
                        <button id="player-fallback-btn" title="Vidéo bloquée ou indisponible ? Essayer la vidéo suivante (trailer VO, opening...)" style="position: absolute; bottom: 12px; left: 12px; z-index: 10; background: rgba(0, 0, 0, 0.7); color: #ff6400; border: 1px solid rgba(255,100,0,0.35); border-radius: 18px; padding: 0 12px; height: 36px; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; gap: 6px;">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                            <span>Vidéo bloquée ?</span>
                        </button>

                        <!-- Fullscreen toggle overlay button -->
                        <button id="player-fullscreen-btn" style="position: absolute; bottom: 12px; right: 56px; z-index: 10; background: rgba(0, 0, 0, 0.7); color: #fff; border: 1px solid rgba(255,255,255,0.25); border-radius: 50%; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: background 0.2s, transform 0.2s;">
                            <svg id="fullscreen-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 18px; height: 18px;">
                                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>
                            </svg>
                        </button>

                        <!-- Small mute/unmute overlay button -->
                        <button id="player-mute-toggle-btn" style="position: absolute; bottom: 12px; right: 12px; z-index: 10; background: rgba(0, 0, 0, 0.7); color: #fff; border: 1px solid rgba(255,255,255,0.25); border-radius: 50%; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: background 0.2s, transform 0.2s;">
                            <svg id="mute-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 18px; height: 18px;">
                                <line x1="1" y1="1" x2="23" y2="23"></line>
                                <path d="M9 9v6a3 3 0 0 0 5.12 2.12M15 9.34V4a1 1 0 0 0-1.7-.7l-4.5 4.5"></path>
                            </svg>
                        </button>
                    ` : `
                        <div class="player-placeholder-icon-wrapper" style="text-align: center; padding: 24px;">
                            <svg class="player-placeholder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width: 48px; height: 48px; color: var(--text-muted); margin-bottom: 12px;"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                            <h4 style="font-size: 16px; margin-bottom: 4px;">Bande-annonce non disponible</h4>
                            <p style="font-size: 13px; color: var(--text-muted);">Aucun trailer trouvé pour cet animé.</p>
                        </div>
                    `}
                </div>
            </div>
        `;

        // Affiche l'étape média courante (trailer YouTube ou opening vidéo),
        // ou le message final quand plus rien n'est lisible.
        const renderMediaStep = () => {
            clearActiveYtPlayback();
            const slot = document.getElementById("player-media-slot");
            if (!slot) return;
            if (mediaIndex >= mediaSteps.length) {
                const placeholder = videoPlayerWrapper.querySelector(".player-placeholder");
                if (placeholder) {
                    // Le trailer existe souvent sur YouTube mais son intégration
                    // est interdite par la chaîne : proposer de l'ouvrir là-bas.
                    const lastYt = mediaSteps.filter(s => s.type === "yt").pop();
                    placeholder.innerHTML = `
                        <div class="player-placeholder-icon-wrapper" style="text-align: center; padding: 24px;">
                            <svg class="player-placeholder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width: 48px; height: 48px; color: var(--text-muted); margin-bottom: 12px;"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                            <h4 style="font-size: 16px; margin-bottom: 4px;">Lecture intégrée impossible</h4>
                            <p style="font-size: 13px; color: var(--text-muted); margin-bottom: ${lastYt ? "16px" : "0"};">${lastYt ? "La chaîne du trailer interdit sa lecture en dehors de YouTube." : "Aucune vidéo trouvée pour cet animé."}</p>
                            ${lastYt ? `
                                <a href="https://www.youtube.com/watch?v=${lastYt.id}" target="_blank" rel="noopener" style="display: inline-flex; align-items: center; gap: 8px; background: rgba(255, 0, 0, 0.85); color: #fff; font-weight: 700; font-size: 13.5px; padding: 10px 20px; border-radius: 9999px; text-decoration: none;">
                                    <svg viewBox="0 0 24 24" fill="currentColor" style="width: 16px; height: 16px;"><path d="M23.5 6.19a3.02 3.02 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.51A3.02 3.02 0 0 0 .5 6.19C0 8.07 0 12 0 12s0 3.93.5 5.81a3.02 3.02 0 0 0 2.123 2.136c1.872.51 9.377.51 9.377.51s7.505 0 9.377-.51A3.02 3.02 0 0 0 23.5 17.81C24 15.93 24 12 24 12s0-3.93-.5-5.81z"/><path d="M9.545 15.568V8.432L15.818 12l-6.273 3.568z" fill="#282828"/></svg>
                                    Voir le trailer sur YouTube
                                </a>
                            ` : ""}
                        </div>
                    `;
                }
                return;
            }
            const step = mediaSteps[mediaIndex];
            if (step.type === "yt") {
                slot.innerHTML = `
                    <iframe
                        id="player-trailer-iframe"
                        style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: none; pointer-events: none;"
                        src="https://www.youtube.com/embed/${step.id}?autoplay=1&mute=1&loop=1&playlist=${step.id}&controls=0&showinfo=0&rel=0&iv_load_policy=3&modestbranding=1&disablekb=1&fs=0&enablejsapi=1&cc_load_policy=3&origin=${encodeURIComponent(window.location.origin)}"
                        allow="autoplay; encrypted-media">
                    </iframe>
                `;

                let played = false;
                
                // Fallback auto-trigger: if video doesn't play in 3.2s, auto-trigger the "Vidéo bloquée" fallback.
                activeYtTimeout = setTimeout(() => {
                    if (!played) {
                        console.warn("YouTube video did not start playing within 3.2s (timeout), auto-triggering fallback...");
                        // Memorise cet id comme mort : evite de rejouer le meme
                        // delai d'echec de 3.2s a chaque future ouverture du
                        // lecteur pour cet anime.
                        markTrailerDead(step.id);
                        const fallbackBtn = document.getElementById("player-fallback-btn");
                        if (fallbackBtn) {
                            fallbackBtn.click();
                        }
                    }
                }, 3200);

                activeYtListener = (event) => {
                    try {
                        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
                        if (data) {
                            if (data.event === "infoDelivery" && data.info) {
                                if (data.info.playerState === 1) {
                                    played = true;
                                    if (activeYtTimeout) {
                                        clearTimeout(activeYtTimeout);
                                        activeYtTimeout = null;
                                    }
                                }
                            }
                            if (data.info && typeof data.info.error !== "undefined") {
                                console.warn("YouTube Player error detected via iframe message:", data.info.error);
                                clearActiveYtPlayback();
                                const fallbackBtn = document.getElementById("player-fallback-btn");
                                if (fallbackBtn) {
                                    fallbackBtn.click();
                                }
                            }
                        }
                    } catch (e) {}
                };
                window.addEventListener("message", activeYtListener);
            } else {
                slot.innerHTML = `
                    <video
                        id="player-trailer-video"
                        src="${step.url}"
                        autoplay muted loop playsinline
                        style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; background: #000;">
                    </video>
                    <span style="position: absolute; top: 12px; right: 12px; z-index: 6; background: rgba(0,0,0,0.7); color: #ff6400; border: 1px solid rgba(255,100,0,0.35); font-size: 10px; font-weight: 800; padding: 3px 8px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.5px;">Opening</span>
                `;
                const vid = document.getElementById("player-trailer-video");
                if (vid) {
                    vid.addEventListener("error", () => {
                        mediaIndex++;
                        renderMediaStep();
                    });
                }
            }
        };
        if (hasMedia) renderMediaStep();

        // Populate platform buttons container below the title
        const platformsContainer = document.getElementById("player-platforms-container");
        if (platformsContainer) {
            platformsContainer.innerHTML = `
                ${anime.crunchyrollUrl ? `
                    <a href="${anime.crunchyrollUrl}" target="_blank" class="crunchy-open-web-btn" title="Ouvrir sur Crunchyroll">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px; margin-right: 8px;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                        <span>Regarder sur Crunchyroll</span>
                    </a>
                ` : ''}
                ${anime.adnUrl ? `
                    <a href="${anime.adnUrl}" target="_blank" class="crunchy-open-web-btn adn-theme" title="Ouvrir sur ADN">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px; margin-right: 8px;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                        <span>Regarder sur ADN</span>
                    </a>
                ` : ''}
                ${anime.netflixUrl ? `
                    <a href="${anime.netflixUrl}" target="_blank" class="crunchy-open-web-btn netflix-theme" title="Ouvrir sur Netflix">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px; margin-right: 8px;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                        <span>Regarder sur Netflix</span>
                    </a>
                ` : ''}
                ${anime.disneyUrl ? `
                    <a href="${anime.disneyUrl}" target="_blank" class="crunchy-open-web-btn disney-theme" title="Ouvrir sur Disney+">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px; margin-right: 8px;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                        <span>Regarder sur Disney+</span>
                    </a>
                ` : ''}
                ${anime.primeUrl ? `
                    <a href="${anime.primeUrl}" target="_blank" class="crunchy-open-web-btn prime-theme" title="Ouvrir sur Prime Video">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px; margin-right: 8px;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                        <span>Regarder sur Prime Video</span>
                    </a>
                ` : ''}
            `;

            // Add automatic validation hooks
            const playLinks = platformsContainer.querySelectorAll(".crunchy-open-web-btn");
            playLinks.forEach(link => {
                link.addEventListener("click", () => {
                    if (epNum > currentWatched) {
                        playerWatchedBtn.click();
                    }
                });
            });

            // ADN : ouvrir directement l'épisode sélectionné (résolution via
            // l'API publique ADN au moment du clic ; repli = page de la série)
            const adnLink = platformsContainer.querySelector(".adn-theme");
            const adnShowMatch = anime.adnUrl ? anime.adnUrl.match(/\/video\/(\d+)/) : null;
            if (adnLink && adnShowMatch) {
                adnLink.addEventListener("click", (e) => {
                    e.preventDefault();
                    // Fenêtre ouverte immédiatement (sinon bloquée comme popup)
                    const win = window.open("", "_blank");
                    const fallback = () => {
                        if (win) win.location = anime.adnUrl;
                        else window.open(anime.adnUrl, "_blank");
                    };
                    fetch(`https://gw.api.animationdigitalnetwork.fr/video/show/${adnShowMatch[1]}?offset=${epNum - 1}&limit=1&order=asc`, {
                        headers: { "X-Target-Distribution": "fr" }
                    })
                        .then((r) => r.json())
                        .then((j) => {
                            const url = j && j.videos && j.videos[0] && j.videos[0].url;
                            if (url) {
                                const target = url.replace("animationdigitalnetwork.com", "animationdigitalnetwork.fr");
                                if (win) win.location = target;
                                else window.open(target, "_blank");
                            } else {
                                fallback();
                            }
                        })
                        .catch(fallback);
                });
            }
        }

        // Setup Fullscreen click logic
        if (hasMedia) {
            const fullscreenBtn = document.getElementById("player-fullscreen-btn");
            if (fullscreenBtn) {
                fullscreenBtn.addEventListener("click", () => {
                    const playerContainer = videoPlayerWrapper.querySelector(".crunchy-mock-player");
                    if (!document.fullscreenElement) {
                        let fsPromise = null;
                        if (playerContainer.requestFullscreen) {
                            fsPromise = playerContainer.requestFullscreen();
                        } else if (playerContainer.webkitRequestFullscreen) {
                            fsPromise = playerContainer.webkitRequestFullscreen();
                        } else if (playerContainer.msRequestFullscreen) {
                            fsPromise = playerContainer.msRequestFullscreen();
                        }
                        
                        if (fsPromise && fsPromise.then) {
                            fsPromise.then(() => {
                                // Auto lock to landscape on mobile devices
                                if (screen.orientation && screen.orientation.lock) {
                                    screen.orientation.lock("landscape").catch(err => {
                                        console.warn("Screen orientation lock rejected:", err);
                                    });
                                }
                            }).catch(err => {
                                console.warn("Fullscreen request rejected:", err);
                            });
                        } else {
                            // Fallback if promise is not returned immediately (older browsers)
                            setTimeout(() => {
                                if (document.fullscreenElement && screen.orientation && screen.orientation.lock) {
                                    screen.orientation.lock("landscape").catch(e => {});
                                }
                            }, 300);
                        }
                    } else {
                        if (document.exitFullscreen) {
                            document.exitFullscreen();
                        }
                    }
                });
            }
            
        }

        // Setup Mute/Unmute click logic
        if (hasMedia) {
            let isMuted = true;
            const muteBtn = document.getElementById("player-mute-toggle-btn");
            if (muteBtn) {
                muteBtn.addEventListener("click", () => {
                    isMuted = !isMuted;
                    const iframe = document.getElementById("player-trailer-iframe");
                    const video = document.getElementById("player-trailer-video");
                    if (video) {
                        video.muted = isMuted;
                    } else if (iframe && iframe.contentWindow) {
                        iframe.contentWindow.postMessage(JSON.stringify({
                            event: 'command',
                            func: isMuted ? 'mute' : 'unMute'
                        }), '*');
                    }
                    
                    // Toggle Icon
                    const svg = document.getElementById("mute-icon-svg");
                    if (svg) {
                        if (isMuted) {
                            svg.innerHTML = `
                                <line x1="1" y1="1" x2="23" y2="23"></line>
                                <path d="M9 9v6a3 3 0 0 0 5.12 2.12M15 9.34V4a1 1 0 0 0-1.7-.7l-4.5 4.5"></path>
                            `;
                        } else {
                            svg.innerHTML = `
                                <path d="M11 5L6 9H2v6h4l5 4V5z"></path>
                                <path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14"></path>
                            `;
                        }
                    }
                });
            }
        }
        // Setup Fallback Video click logic : passer à la vidéo suivante de la
        // chaîne (trailer VF -> trailer VO -> opening -> message final).
        if (hasMedia) {
            const fallbackBtn = document.getElementById("player-fallback-btn");
            if (fallbackBtn) {
                fallbackBtn.addEventListener("click", () => {
                    mediaIndex++;
                    renderMediaStep();
                });
            }
        }
    };

    const startAutoplayCountdown = (nextEpNum) => {
        let timeLeft = 3;
        
        const overlay = document.createElement("div");
        overlay.className = "player-countdown-overlay";
        overlay.innerHTML = `
            <div class="player-countdown-ring"></div>
            <div class="player-countdown-title">Épisode ${nextEpNum} dans ${timeLeft}s</div>
            <div class="player-countdown-subtitle">Lecture de l'épisode suivant...</div>
            <button class="btn-secondary player-countdown-skip-btn">Passer au direct</button>
        `;
        
        videoPlayerWrapper.appendChild(overlay);
        
        const skipBtn = overlay.querySelector(".player-countdown-skip-btn");
        skipBtn.addEventListener("click", () => {
            clearCountdown();
            loadEpisode(nextEpNum);
        });
        
        countdownInterval = setInterval(() => {
            timeLeft--;
            const titleEl = overlay.querySelector(".player-countdown-title");
            if (titleEl) {
                titleEl.textContent = `Épisode ${nextEpNum} dans ${timeLeft}s`;
            }
            if (timeLeft <= 0) {
                clearInterval(countdownInterval);
            }
        }, 1000);
        
        countdownTimeout = setTimeout(() => {
            clearCountdown();
            loadEpisode(nextEpNum);
        }, 3000);
    };
    
    loadEpisode(currentPlayingEp);
    openModal(playerModal);

    // Attache une seule fois (voir activeClearCountdown/playerCloseListenersAttached
    // plus haut) : le handler lit toujours l'etat courant via activeClearCountdown,
    // pas besoin de le reattacher a chaque ouverture du lecteur.
    if (!playerCloseListenersAttached) {
        playerCloseListenersAttached = true;
        const closeBtns = playerModal.querySelectorAll(".close-modal-btn, .modal-overlay");
        closeBtns.forEach(btn => {
            btn.addEventListener("click", () => {
                if (activeClearCountdown) activeClearCountdown();
                clearActiveYtPlayback();
                videoPlayerWrapper.innerHTML = "";
            });
        });
    }
}

// ==========================================================================
// EVENT LISTENERS & INITS
// ==========================================================================
document.addEventListener("DOMContentLoaded", () => {
    try {
        // Load local storage or default data
        loadData();
        updateStats();
        renderGrid();

        // Check for auto-sync data in URL hash
        const handleHashSync = () => {
            const hash = window.location.hash;
            if (hash && hash.startsWith("#sync-data=")) {
                try {
                    const base64Data = hash.substring("#sync-data=".length);
                    const jsonStr = decodeURIComponent(escape(atob(base64Data)));
                    const rawImported = JSON.parse(jsonStr);

                    // N'importe quelle page peut fabriquer une URL #sync-data= : on ne
                    // fait confiance a aucun champ hors de la forme "historique partiel"
                    // attendue des userscripts ADN/Crunchyroll. En particulier on retire
                    // tout episodesTotal pour empecher un declenchement du mode "backup
                    // complet" (qui remplacerait tout animeList) via une simple URL.
                    const importedData = Array.isArray(rawImported)
                        ? rawImported
                            .filter(item => item && typeof item === "object" && typeof item.titleFr === "string" && item.titleFr.trim() !== "")
                            .slice(0, 2000)
                            .map(item => ({
                                titleFr: item.titleFr,
                                episodesWatched: Math.max(0, parseInt(item.episodesWatched, 10) || 0),
                                source: typeof item.source === "string" ? item.source : "inconnu"
                            }))
                        : [];

                    if (importedData.length > 0) {
                        importDataList(importedData);
                    }
                    // Clear the hash from URL without reloading
                    history.replaceState(null, "", window.location.pathname);
                } catch (e) {
                    console.error("Failed to parse sync-data hash", e);
                }
            }
        };
        handleHashSync();
        window.addEventListener("hashchange", handleHashSync);

        // Search Listener (debounced : évite un rebuild complet de la grille
        // à chaque frappe, qui saccadait la saisie sur un catalogue de 600+ fiches)
        searchInput.addEventListener("input", (e) => {
            currentSearch = e.target.value;
            if (currentSearch.trim() !== "") {
                clearSearchBtn.style.display = "flex";
            } else {
                clearSearchBtn.style.display = "none";
            }
            clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(renderGrid, 150);
        });
        
        // Clear search trigger
        clearSearchBtn.addEventListener("click", () => {
            clearTimeout(searchDebounceTimer);
            searchInput.value = "";
            currentSearch = "";
            clearSearchBtn.style.display = "none";
            renderGrid();
        });
        
        // Sort dropdown listener
        sortSelect.addEventListener("change", (e) => {
            currentSort = e.target.value;
            renderGrid();
        });

        // Platform dropdown listener
        if (platformSelect) {
            platformSelect.addEventListener("change", (e) => {
                currentPlatform = e.target.value;
                renderGrid();
            });
        }
        
        if (addAnimeBtn) addAnimeBtn.addEventListener("click", openAddAnimeModal);
        if (emptyAddBtn) emptyAddBtn.addEventListener("click", openAddAnimeModal);
        
        // Form cancellations
        cancelFormBtn.addEventListener("click", () => closeModal(editModal));
        
        // Form submit
        animeForm.addEventListener("submit", handleFormSubmit);
        
        // Data dropdown operations
        dataDropdownBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            dataDropdownMenu.classList.toggle("show");
        });

        document.addEventListener("click", () => {
            dataDropdownMenu.classList.remove("show");
        });

        // Filters dropdown (tri + plateforme)
        if (filtersToggleBtn && filtersMenu) {
            filtersToggleBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                filtersMenu.classList.toggle("show");
            });
            filtersMenu.addEventListener("click", (e) => e.stopPropagation());
            document.addEventListener("click", () => {
                filtersMenu.classList.remove("show");
            });
        }
        
        exportBtn.addEventListener("click", exportToJSON);
        
        importTriggerBtn.addEventListener("click", () => {
            importFileInput.click();
        });
        
        importFileInput.addEventListener("change", importFromJSON);
        
        resetBtn.addEventListener("click", resetToDefault);
        
        // Close Modal triggers
        document.querySelectorAll(".close-modal-btn").forEach(btn => {
            btn.addEventListener("click", (e) => {
                const modal = e.target.closest(".modal");
                closeModal(modal);
            });
        });
        
        document.querySelectorAll(".modal-overlay").forEach(overlay => {
            overlay.addEventListener("click", (e) => {
                const modal = e.target.closest(".modal");
                closeModal(modal);
            });
        });
        
        // Close modal on Escape
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
                const openModalElement = document.querySelector(".modal.show");
                if (openModalElement) {
                    if (openModalElement.id === "player-modal") {
                        clearActiveYtPlayback();
                        videoPlayerWrapper.innerHTML = "";
                    }
                    closeModal(openModalElement);
                }
            }
        });
        
        // Setup AniList Sync indicator and run sync on load
        const syncStatusEl = document.getElementById("sync-status");
        if (syncStatusEl) {
            syncStatusEl.addEventListener("click", syncWithAniList);
        }
        
        // Run background sync automatically after 2 seconds, then keep the
        // release dates / next-episode countdown fresh with an hourly scan
        // as long as the tab stays open.
        setTimeout(syncWithAniList, 2000);
        setInterval(syncWithAniList, 3600000);
    } catch (err) {
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = 'position:fixed; top:0; left:0; width:100%; background:#ef4444; color:white; z-index:99999; padding:15px; font-family:monospace; font-size:14px; font-weight:bold; box-shadow: 0 4px 20px rgba(0,0,0,0.5);';
        errorDiv.innerHTML = '⚠️ Erreur Interne détectée :<br>' + err.message + '<br><span style="font-size:11px; opacity:0.8;">' + err.stack.replace(/\n/g, '<br>') + '</span>';
        document.body.appendChild(errorDiv);
    }
});

// ==========================================================================
// ANILIST AUTO-SYNC ENGINE
// ==========================================================================
async function syncWithAniList() {
    const syncStatusEl = document.getElementById("sync-status");
    if (!syncStatusEl) return;
    
    if (syncStatusEl.classList.contains("syncing")) return;
    
    syncStatusEl.className = "sync-indicator-badge syncing";
    syncStatusEl.querySelector(".sync-text").textContent = "Mise à jour...";
    
    // Extract ongoing IDs
    const ongoingIds = animeList
        .filter(a => a.airingStatus === 'RELEASING')
        .map(a => {
            const cleanId = a.id.replace("franchise-", "");
            return cleanId.startsWith("anilist-") ? parseInt(cleanId.replace("anilist-", "")) : parseInt(cleanId);
        })
        .filter(id => !isNaN(id));
        
    const variables = {
        ids: ongoingIds.length > 0 ? ongoingIds : [0]
    };
    
    const query = `
    query ($ids: [Int]) {
      updatedList: Page(page: 1, perPage: 50) {
        media(id_in: $ids) {
          id
          status
          episodes
          nextAiringEpisode {
            airingAt
            episode
          }
          externalLinks {
            url
            site
          }
        }
      }
      trendingVF: Page(page: 1, perPage: 25) {
        media(sort: TRENDING_DESC, type: ANIME) {
          id
          title {
            romaji
            english
          }
          episodes
          status
          startDate {
            year
            month
            day
          }
          genres
          description
          coverImage {
            large
          }
          externalLinks {
            url
            site
          }
          characters(sort: ROLE, perPage: 15) {
            edges {
              voiceActors(language: FRENCH) {
                name {
                  full
                }
              }
            }
          }
        }
      }
    }`;
    
    try {
        const response = await fetch("https://graphql.anilist.co", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            body: JSON.stringify({ query, variables })
        });
        
        if (!response.ok) throw new Error("HTTP error " + response.status);
        
        const result = await response.json();
        const data = result.data;
        
        let changed = false;
        let updatedShowsCount = 0;
        let newShowsCount = 0;
        
        // 1. Update ongoing shows
        if (data.updatedList && data.updatedList.media) {
            data.updatedList.media.forEach(item => {
                const localAnime = animeList.find(a => 
                    a.id === `franchise-${item.id}` || 
                    a.id === `franchise-anilist-${item.id}`
                );
                if (localAnime) {
                    let showUpdated = false;
                    
                    if (localAnime.airingStatus !== item.status) {
                        localAnime.airingStatus = item.status;
                        showUpdated = true;
                    }
                    
                    const newEpCount = parseInt(item.episodes || 0);
                    if (newEpCount > 0 && localAnime.episodesTotal !== newEpCount) {
                        const oldTotal = localAnime.episodesTotal;
                        localAnime.episodesTotal = newEpCount;
                        
                        if (localAnime.seasons && localAnime.seasons.length > 0) {
                            const lastSeason = localAnime.seasons[localAnime.seasons.length - 1];
                            const calculatedTotal = localAnime.seasons.reduce((s, x) => s + x.episodesCount, 0);
                            const diff = newEpCount - calculatedTotal;
                            lastSeason.episodesCount = Math.max(1, lastSeason.episodesCount + diff);
                        }
                        showUpdated = true;
                    }
                    
                    if (item.nextAiringEpisode) {
                        if (localAnime.nextAiringEpisode !== item.nextAiringEpisode.episode || localAnime.nextAiringAt !== item.nextAiringEpisode.airingAt) {
                            localAnime.nextAiringEpisode = item.nextAiringEpisode.episode;
                            localAnime.nextAiringAt = item.nextAiringEpisode.airingAt;
                            showUpdated = true;
                        }
                    } else {
                        if (localAnime.nextAiringEpisode !== null || localAnime.nextAiringAt !== null) {
                            localAnime.nextAiringEpisode = null;
                            localAnime.nextAiringAt = null;
                            showUpdated = true;
                        }
                    }
                    
                    if (item.externalLinks) {
                        const crunchyLink = item.externalLinks.find(l => l.site === 'Crunchyroll')?.url || "";
                        const adnLink = item.externalLinks.find(l => l.site.includes('ADN') || l.site.includes('Animation Digital Network'))?.url || "";
                        
                        if (crunchyLink && localAnime.crunchyrollUrl !== crunchyLink) {
                            localAnime.crunchyrollUrl = crunchyLink;
                            showUpdated = true;
                        }
                        if (adnLink && localAnime.adnUrl !== adnLink) {
                            localAnime.adnUrl = adnLink;
                            showUpdated = true;
                        }
                    }
                    
                    if (showUpdated) {
                        updatedShowsCount++;
                        changed = true;
                    }
                }
            });
        }
        
        // 2. Scan and add new VF shows
        if (data.trendingVF && data.trendingVF.media) {
            data.trendingVF.media.forEach(item => {
                const vfActors = [];
                if (item.characters && item.characters.edges) {
                    item.characters.edges.forEach(edge => {
                        if (edge.voiceActors) {
                            edge.voiceActors.forEach(va => {
                                if (va.name && va.name.full && !vfActors.includes(va.name.full)) {
                                    vfActors.push(va.name.full);
                                }
                            });
                        }
                    });
                }
                
                if (vfActors.length > 0) {
                    const localId = `franchise-${item.id}`;
                    const titleFr = item.title.english || item.title.romaji || item.title.native || "Titre inconnu";

                    const exists = animeList.some(a =>
                        a.id === localId ||
                        a.id === `franchise-anilist-${item.id}` ||
                        (a.titleFr || "").toLowerCase() === titleFr.toLowerCase()
                    );
                    
                    if (!exists) {
                        const cleanSynopsis = item.description ? item.description.replace(/<[^>]*>/g, '') : "Synopsis non disponible.";
                        const releaseDate = item.startDate && item.startDate.year
                            ? `${String(item.startDate.day || 1).padStart(2, '0')}/${String(item.startDate.month || 1).padStart(2, '0')}/${item.startDate.year}`
                            : "Inconnue";
                            
                        const crunchyLink = item.externalLinks ? (item.externalLinks.find(l => l.site === 'Crunchyroll')?.url || "") : "";
                        const adnLink = item.externalLinks ? (item.externalLinks.find(l => l.site.includes('ADN') || l.site.includes('Animation Digital Network'))?.url || "") : "";
                        
                        animeList.push({
                            id: localId,
                            titleFr: titleFr,
                            titleOrig: item.title.romaji,
                            imageUrl: item.coverImage.large,
                            crunchyrollUrl: crunchyLink,
                            adnUrl: adnLink,
                            episodesTotal: item.episodes || 12,
                            episodesWatched: 0,
                            status: "plan-to-watch",
                            rating: 0,
                            siteRating: "4.5",
                            genres: item.genres ? item.genres.join(", ") : "Action",
                            synopsis: cleanSynopsis,
                            cast: vfActors.slice(0, 5).join(", "),
                            airingStatus: item.status || "FINISHED",
                            releaseDate: releaseDate,
                            lastEpisodeDate: null,
                            rawStartDate: item.startDate,
                            rawEndDate: null,
                            seasons: [
                                {
                                    name: "Saison 1",
                                    episodesCount: item.episodes || 12,
                                    releaseDate: releaseDate
                                }
                            ]
                        });
                        
                        newShowsCount++;
                        changed = true;
                    }
                }
            });
        }
        
        if (changed) {
            saveData();
            updateStats();
            renderGrid();
        }
        
        syncStatusEl.className = "sync-indicator-badge success";
        syncStatusEl.querySelector(".sync-text").textContent = "À jour";
        
    } catch (err) {
        console.error("Sync error :", err);
        syncStatusEl.className = "sync-indicator-badge error";
        syncStatusEl.querySelector(".sync-text").textContent = "Erreur Sync";
    }
}
