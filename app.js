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
let currentFilter = "all";
let currentSearch = "";
let currentSort = "alphabetical";

// ==========================================================================
// DOM ELEMENTS
// ==========================================================================
const animeGrid = document.getElementById("anime-grid");
const emptyState = document.getElementById("empty-state");
const searchInput = document.getElementById("search-input");
const clearSearchBtn = document.getElementById("clear-search");
const sortSelect = document.getElementById("sort-select");
const filterTabs = document.querySelectorAll(".filter-tab");
const addAnimeBtn = document.getElementById("add-anime-btn");
const emptyAddBtn = document.getElementById("empty-add-btn");
const dataDropdownBtn = document.getElementById("data-dropdown-btn");
const dataDropdownMenu = document.getElementById("data-dropdown-menu");
const exportBtn = document.getElementById("export-btn");
const importTriggerBtn = document.getElementById("import-trigger-btn");
const importFileInput = document.getElementById("import-file-input");
const resetBtn = document.getElementById("reset-btn");
const notificationContainer = document.getElementById("notification-container");

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
const playerEpisodeDesc = document.getElementById("player-episode-desc");
const playerWatchedBtn = document.getElementById("player-watched-btn");

// Form Inputs
const formAnimeId = document.getElementById("form-anime-id");
const formTitleFr = document.getElementById("form-title-fr");
const formTitleOrig = document.getElementById("form-title-orig");
const formImageUrl = document.getElementById("form-image-url");
const formCrunchyrollUrl = document.getElementById("form-crunchyroll-url");
const formAdnUrl = document.getElementById("form-adn-url");
const formEpisodesTotal = document.getElementById("form-episodes-total");
const formEpisodesWatched = document.getElementById("form-episodes-watched");
const formStatus = document.getElementById("form-status");
const formRating = document.getElementById("form-rating");
const formSeason = document.getElementById("form-season");
const formGenres = document.getElementById("form-genres");
const formSynopsis = document.getElementById("form-synopsis");
const formCast = document.getElementById("form-cast");

// Stats Counters
const statTotalAnime = document.getElementById("stat-total-anime");
const statTotalEpisodes = document.getElementById("stat-total-episodes");
const statTotalTime = document.getElementById("stat-total-time");
const statCompletionPct = document.getElementById("stat-completion-pct");
const statProgressBar = document.getElementById("stat-progress-bar");

// Filter Counts
const countAll = document.getElementById("count-all");
const countWatching = document.getElementById("count-watching");
const countPlanToWatch = document.getElementById("count-plan-to-watch");
const countCompleted = document.getElementById("count-completed");
const countOnHold = document.getElementById("count-on-hold");
const countHidden = document.getElementById("count-hidden");

// ==========================================================================
// TOAST NOTIFICATIONS
// ==========================================================================
function showToast(message, type = "success") {
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    
    // Add appropriate icon based on toast type
    let iconSvg = '';
    if (type === 'success') {
        iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width: 20px; height: 20px;"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    } else if (type === 'error') {
        iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width: 20px; height: 20px;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
    } else {
        iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width: 20px; height: 20px;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
    }
    
    toast.innerHTML = `
        ${iconSvg}
        <span>${message}</span>
    `;
    
    notificationContainer.appendChild(toast);
    
    // Remove after 3s
    setTimeout(() => {
        toast.classList.add("toast-fade-out");
        toast.addEventListener("transitionend", () => {
            toast.remove();
        });
    }, 3000);
}

// ==========================================================================
// IMAGE FALLBACK GENERATOR
// ==========================================================================
function getFallbackImage(title) {
    const fillStyle = "%2323252b";
    const accentStyle = "%23ff6400";
    const textStyle = "%23a0a0a5";
    
    return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="420" viewBox="0 0 300 420"><rect width="100%" height="100%" fill="${fillStyle}"/><text x="50%" y="40%" dominant-baseline="middle" text-anchor="middle" fill="${textStyle}" font-family="sans-serif" font-size="14">AFFICHE</text><text x="50%" y="46%" dominant-baseline="middle" text-anchor="middle" fill="${textStyle}" font-family="sans-serif" font-size="14">NON DISPONIBLE</text><rect x="40" y="240" width="220" height="4" fill="${accentStyle}"/><text x="50%" y="280" dominant-baseline="middle" text-anchor="middle" fill="%23ffffff" font-family="sans-serif" font-weight="bold" font-size="16">${encodeURIComponent(title.length > 25 ? title.substring(0, 22) + '...' : title)}</text></svg>`;
}

// ==========================================================================
// DATA CORE OPERATIONS (LOCAL STORAGE)
// ==========================================================================
function loadData() {
    // 1. Initialize merged list with a deep copy of DEFAULT_ANIME_DATA
    const mergedList = DEFAULT_ANIME_DATA.map(item => ({ ...item }));
    
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
    
    mergedList.forEach(anime => {
        if (!anime.adnUrl) {
            anime.adnUrl = getAdnUrlForShow(anime.titleFr);
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
                const updated = { ...defaultAnime };
                updated.episodesWatched = record.episodesWatched || 0;
                updated.status = record.status || "plan-to-watch";
                updated.rating = record.rating || 0;
                finalActiveList.push(updated);
                processedIds.add(id);
            }
        }
    });
    
    // Add remaining default catalog shows that have no progress yet
    mergedList.forEach(defaultAnime => {
        if (!processedIds.has(defaultAnime.id)) {
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
        const isCustom = !DEFAULT_ANIME_DATA.some(d => d.id === anime.id);
        if (isCustom) {
            // For custom shows, save the full object
            progressData[anime.id] = {
                ...anime,
                isCustom: true
            };
        } else {
            // For catalog shows, only save user progress fields
            if (anime.episodesWatched > 0 || anime.status !== "plan-to-watch" || anime.rating > 0) {
                progressData[anime.id] = {
                    episodesWatched: anime.episodesWatched,
                    status: anime.status,
                    rating: anime.rating
                };
            }
        }
    });
    try {
        localStorage.setItem("crunchy_tracker_progress_v2", JSON.stringify(progressData));
    } catch (e) {
        console.error("Failed to save progress to localStorage", e);
        showToast("Impossible de sauvegarder votre progression (espace insuffisant).", "error");
    }
}

// ==========================================================================
// RENDERING & LAYOUT
// ==========================================================================
function updateStats() {
    const hiddenCount = animeList.filter(a => a.status === "hidden").length;
    const visibleList = animeList.filter(a => a.status !== "hidden");
    const total = visibleList.length;
    const watched = visibleList.reduce((sum, a) => sum + parseInt(a.episodesWatched || 0), 0);
    const completed = visibleList.filter(a => a.status === "completed").length;
    
    // Minutes of anime: 24 mins per episode
    const totalMinutes = watched * 24;
    const totalHours = Math.floor(totalMinutes / 60);
    const remainingMins = totalMinutes % 60;
    
    // Updates
    statTotalAnime.textContent = total;
    statTotalEpisodes.textContent = watched;
    
    if (totalHours > 0) {
        statTotalTime.textContent = `${totalHours}h ${remainingMins}m`;
    } else {
        statTotalTime.textContent = `${totalMinutes}m`;
    }
    
    // Completion Pct (completed animes / total animes)
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    statCompletionPct.textContent = `${pct}%`;
    statProgressBar.style.width = `${pct}%`;
    
    // Tab Counts
    countAll.textContent = total;
    countWatching.textContent = animeList.filter(a => a.status === "watching").length;
    countPlanToWatch.textContent = animeList.filter(a => a.status === "plan-to-watch").length;
    countCompleted.textContent = completed;
    countOnHold.textContent = animeList.filter(a => a.status === "on-hold").length;
    if (countHidden) countHidden.textContent = hiddenCount;
}

function renderGrid() {
    // 1. Filter
    let filteredList = animeList.filter(anime => {
        // Hide "hidden" anime from all tabs except the "hidden" tab
        if (currentFilter !== "hidden" && anime.status === "hidden") {
            return false;
        }
        // Status filter
        if (currentFilter !== "all" && anime.status !== currentFilter) {
            return false;
        }
        
        // Search filter
        if (currentSearch) {
            const query = currentSearch.toLowerCase();
            const matchTitleFr = anime.titleFr.toLowerCase().includes(query);
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
        if (anime.airingStatus === 'RELEASING') return Date.now() + 10000000000; // ongoing shows at the top of latest episodes
        if (!anime.rawEndDate || !anime.rawEndDate.year) return 0;
        const y = anime.rawEndDate.year;
        const m = (anime.rawEndDate.month || 1) - 1;
        const d = anime.rawEndDate.day || 1;
        return new Date(y, m, d).getTime();
    };

    // 2. Sort
    filteredList.sort((a, b) => {
        if (currentSort === "alphabetical") {
            return a.titleFr.localeCompare(b.titleFr, "fr", { sensitivity: "base" });
        }
        
        if (currentSort === "rating") {
            // Unrated goes to the bottom
            const rA = a.rating || 0;
            const rB = b.rating || 0;
            if (rA !== rB) return rB - rA;
            return a.titleFr.localeCompare(b.titleFr, "fr", { sensitivity: "base" });
        }
        
        if (currentSort === "episodes-left") {
            const leftA = Math.max(0, (a.episodesTotal || 0) - (a.episodesWatched || 0));
            const leftB = Math.max(0, (b.episodesTotal || 0) - (b.episodesWatched || 0));
            if (leftA !== leftB) return leftA - leftB; // Lesser episodes left first
            return a.titleFr.localeCompare(b.titleFr, "fr", { sensitivity: "base" });
        }
        
        if (currentSort === "progress-pct") {
            const pctA = (a.episodesTotal || 1) > 0 ? (a.episodesWatched || 0) / (a.episodesTotal || 1) : 0;
            const pctB = (b.episodesTotal || 1) > 0 ? (b.episodesWatched || 0) / (b.episodesTotal || 1) : 0;
            if (pctA !== pctB) return pctB - pctA; // Highest progress first
            return a.titleFr.localeCompare(b.titleFr, "fr", { sensitivity: "base" });
        }

        if (currentSort === "release-date-desc") {
            const tA = getStartDateMs(a);
            const tB = getStartDateMs(b);
            if (tA !== tB) return tB - tA; // Newest first
            return a.titleFr.localeCompare(b.titleFr, "fr", { sensitivity: "base" });
        }

        if (currentSort === "release-date-asc") {
            const tA = getStartDateMs(a);
            const tB = getStartDateMs(b);
            if (tA !== tB) return tA - tB; // Oldest first
            return a.titleFr.localeCompare(b.titleFr, "fr", { sensitivity: "base" });
        }

        if (currentSort === "last-episode-desc") {
            const tA = getEndDateMs(a);
            const tB = getEndDateMs(b);
            if (tA !== tB) return tB - tA; // Latest first
            return a.titleFr.localeCompare(b.titleFr, "fr", { sensitivity: "base" });
        }
        
        return 0;
    });
    
    // 3. Render HTML
    animeGrid.innerHTML = "";
    
    if (filteredList.length === 0) {
        animeGrid.style.display = "none";
        emptyState.style.display = "flex";
        return;
    }
    
    animeGrid.style.display = "grid";
    emptyState.style.display = "none";
    
    filteredList.forEach(anime => {
        const card = document.createElement("div");
        card.className = "anime-card";
        card.setAttribute("data-id", anime.id);
        card.setAttribute("data-status", anime.status);
        
        // Progress calculations
        const watched = parseInt(anime.episodesWatched || 0);
        const total = parseInt(anime.episodesTotal || 0);
        const progressPct = total > 0 ? Math.round((watched / total) * 100) : 0;
        
        // Image URL handling
        const coverSrc = anime.imageUrl ? anime.imageUrl : getFallbackImage(anime.titleFr);
        
        // Stars rendering
        const starsText = anime.rating > 0 ? `★ ${anime.rating}` : "Pas noté";
        
        card.innerHTML = `
            <div class="card-status-bar ${anime.status}"></div>
            <div class="card-image-wrapper js-open-details">
                <img class="card-image" src="${coverSrc}" alt="Affiche de ${anime.titleFr}" loading="lazy">
                <div class="card-overlay"></div>
                <span class="card-badge-vf">VF</span>
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
                </div>
                ${anime.airingStatus ? `
                    <span class="card-badge-airing ${anime.airingStatus === 'RELEASING' ? 'releasing' : 'finished'}">
                        ${anime.airingStatus === 'RELEASING' ? 'En Cours' : 'Terminé'}
                    </span>
                ` : ''}
                <span class="card-rating-overlay" title="Note officielle de la communauté (Crunchyroll / AniList)">
                    <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                    <span>${anime.siteRating || '4.2'}</span>
                </span>
            </div>
            
            <div class="card-content">
                <div class="card-header-info js-open-details">
                    <h3 class="card-title-fr">${anime.titleFr}</h3>
                    <div class="card-title-orig">
                        ${anime.seasons && Array.isArray(anime.seasons) && anime.seasons.length > 0
                            ? `${anime.seasons.length} Saison${anime.seasons.length > 1 ? 's' : ''}${anime.titleOrig ? ' • ' + anime.titleOrig : ''}`
                            : `${anime.season ? anime.season + ' • ' : ''}${anime.titleOrig || ""}`
                        }
                    </div>
                    ${anime.cast ? `
                        <div class="card-cast" title="${anime.cast.replace(/"/g, '&quot;')}">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
                                <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                                <line x1="12" y1="19" x2="12" y2="22"></line>
                            </svg>
                            <span>VF : ${anime.cast}</span>
                        </div>
                    ` : ''}
                </div>
                
                <div class="card-progress-section">
                    <div class="progress-info-row">
                        <span class="progress-label">Épisodes</span>
                        <span class="progress-value">${watched} / ${total} (${progressPct}%)</span>
                    </div>
                    <div class="card-progress-bar-bg">
                        <div class="card-progress-bar-fill" style="width: ${progressPct}%"></div>
                    </div>
                    <div class="user-rating-row">
                        <span class="label">Ma Note :</span>
                        <span class="stars">${anime.rating > 0 ? '★'.repeat(anime.rating) + '☆'.repeat(5 - anime.rating) : 'Non noté'}</span>
                    </div>
                    
                    <div class="episode-adjuster">
                        <button class="adjust-btn btn-minus" aria-label="Retirer un épisode" ${watched === 0 ? "disabled" : ""}>-</button>
                        <input type="number" class="episode-input-display" value="${watched}" min="0" max="${total}">
                        <button class="adjust-btn btn-plus" aria-label="Ajouter un épisode" ${watched >= total ? "disabled" : ""}>+</button>
                    </div>
                </div>
                
                <div class="card-actions">
                    <button class="card-btn-details js-open-details">
                        Détails
                    </button>
                    <button class="btn-primary card-btn-play js-play-episode" style="padding: 6px 12px; font-size: 13px; gap: 4px;">
                        <svg viewBox="0 0 24 24" fill="currentColor" style="width: 12px; height: 12px;"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                        <span>Regarder</span>
                    </button>
                    ${anime.crunchyrollUrl ? `
                        <a href="${anime.crunchyrollUrl}" target="_blank" class="card-link-crunchy" title="Ouvrir sur Crunchyroll">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                        </a>
                    ` : ''}
                </div>
            </div>
        `;
        
        // Add onerror handler to the image element
        const cardImg = card.querySelector(".card-image");
        cardImg.onerror = () => {
            cardImg.src = getFallbackImage(anime.titleFr);
        };
        
        // Setup card interactivity
        // Detail Trigger elements
        card.querySelectorAll(".js-open-details").forEach(elem => {
            elem.addEventListener("click", () => showAnimeDetails(anime.id));
        });

        // Play Trigger
        const btnPlay = card.querySelector(".js-play-episode");
        if (btnPlay) {
            btnPlay.addEventListener("click", (e) => {
                e.stopPropagation();
                openPlayerModal(anime.id);
            });
        }
        
        // Episode decrement
        const btnMinus = card.querySelector(".btn-minus");
        btnMinus.addEventListener("click", (e) => {
            e.stopPropagation();
            changeEpisodeCount(anime.id, watched - 1);
        });
        
        // Episode increment
        const btnPlus = card.querySelector(".btn-plus");
        btnPlus.addEventListener("click", (e) => {
            e.stopPropagation();
            changeEpisodeCount(anime.id, watched + 1);
        });
        
        // Direct input change
        const episodeInput = card.querySelector(".episode-input-display");
        episodeInput.addEventListener("click", (e) => e.stopPropagation());
        episodeInput.addEventListener("change", (e) => {
            const val = parseInt(e.target.value);
            if (isNaN(val) || val < 0) {
                e.target.value = watched;
            } else {
                changeEpisodeCount(anime.id, Math.min(val, total));
            }
        });
        
        animeGrid.appendChild(card);
    });
}

// ==========================================================================
// ANIME MUTATION FUNCTIONS
// ==========================================================================
function changeEpisodeCount(id, newCount) {
    const idx = animeList.findIndex(a => a.id === id);
    if (idx === -1) return;
    
    const anime = animeList[idx];
    const total = parseInt(anime.episodesTotal || 0);
    let finalCount = Math.max(0, Math.min(newCount, total));
    
    anime.episodesWatched = finalCount;
    
    // Automatically change status on thresholds
    if (finalCount === total && total > 0 && anime.status !== "completed") {
        anime.status = "completed";
        showToast(`Félicitations ! Vous avez terminé "${anime.titleFr}" !`, "info");
    } else if (finalCount > 0 && finalCount < total && (anime.status === "plan-to-watch" || anime.status === "on-hold")) {
        anime.status = "watching";
        showToast(`Début du visionnage de "${anime.titleFr}"`, "info");
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
    
    const watched = parseInt(anime.episodesWatched || 0);
    const total = parseInt(anime.episodesTotal || 0);
    const progressPct = total > 0 ? Math.round((watched / total) * 100) : 0;
    
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

    // Build episodes progress list grouped by season
    let episodesHtml = "";
    if (anime.seasons && Array.isArray(anime.seasons) && anime.seasons.length > 0) {
        let globalIndex = 0;
        anime.seasons.forEach((season, seasonIdx) => {
            episodesHtml += `
                <div class="detail-season-block" style="margin-top: 14px;">
                    <div style="font-size: 13px; font-weight: 700; color: var(--text-white); margin-bottom: 6px;">
                        ${season.name} <span style="font-weight: 400; color: var(--text-muted); font-size: 11px;">(${season.episodesCount} épisodes)</span>
                    </div>
                    <div class="detail-episodes-grid">
            `;
            for (let i = 1; i <= season.episodesCount; i++) {
                globalIndex++;
                const isWatched = globalIndex <= watched;
                episodesHtml += `
                    <button class="detail-ep-btn ${isWatched ? 'watched' : ''}" data-global-ep="${globalIndex}" title="${isWatched ? 'Marquer comme non vu' : 'Marquer comme vu'}">
                        ${i}
                    </button>
                `;
            }
            episodesHtml += `
                    </div>
                </div>
            `;
        });
    } else {
        // Fallback for single season if seasons is empty
        episodesHtml += `<div class="detail-episodes-grid">`;
        for (let i = 1; i <= total; i++) {
            const isWatched = i <= watched;
            episodesHtml += `
                <button class="detail-ep-btn ${isWatched ? 'watched' : ''}" data-global-ep="${i}" title="${isWatched ? 'Marquer comme non vu' : 'Marquer comme vu'}">
                    ${i}
                </button>
            `;
        }
        episodesHtml += `</div>`;
    }
    
    // Build hero banner (we can use the poster image with custom styles or a blurred fallback)
    detailModalBody.innerHTML = `
        <div class="detail-header-hero" style="background-image: linear-gradient(rgba(20, 21, 25, 0.5), rgba(20, 21, 25, 1)), url('${coverSrc}');">
            <div class="detail-hero-content">
                <img class="detail-poster-img" src="${coverSrc}" alt="Affiche" onerror="this.src=getFallbackImage('${anime.titleFr.replace(/'/g, "\\'")}')">
                <div class="detail-title-block">
                    <h2 class="detail-title-fr">${anime.titleFr}</h2>
                    <div class="detail-title-orig">${anime.titleOrig || ""}</div>
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
                    <span class="sidebar-label">Ma Note</span>
                    <div class="detail-rating-display">
                        ${starsHtml}
                    </div>
                </div>
                
                <div class="detail-sidebar-section">
                    <span class="sidebar-label">Progression</span>
                    <span class="sidebar-value">${watched} / ${total} épisodes (${progressPct}%)</span>
                </div>
            </div>
            
            <div class="detail-content-area">
                <div class="detail-genre-tags">
                    ${genreTagsHtml}
                </div>
                
                <div>
                    <h3 class="detail-section-title">Synopsis</h3>
                    <p class="detail-synopsis-text">${anime.synopsis || "Aucun synopsis disponible pour cet animé."}</p>
                </div>
                
                ${anime.cast ? `
                <div>
                    <h3 class="detail-section-title">Doublage VF</h3>
                    <p class="detail-cast-list">${anime.cast}</p>
                </div>
                ` : ''}

                <div class="detail-episodes-section">
                    <h3 class="detail-section-title">Progression des Épisodes</h3>
                    ${episodesHtml}
                </div>
                
                <div class="detail-btn-row">
                    <button class="btn-primary card-btn-play" id="detail-play-btn">
                        <svg viewBox="0 0 24 24" fill="currentColor" style="width: 14px; height: 14px;"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                        <span style="margin-left: 6px;">Regarder</span>
                    </button>
                    ${anime.crunchyrollUrl ? `
                        <a href="${anime.crunchyrollUrl}" target="_blank" class="btn-secondary" style="text-decoration: none;" title="Ouvrir sur Crunchyroll">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                            <span style="margin-left: 6px;">Crunchyroll</span>
                        </a>
                    ` : ''}
                    ${anime.adnUrl ? `
                        <a href="${anime.adnUrl}" target="_blank" class="btn-secondary btn-adn" style="text-decoration: none;" title="Ouvrir sur ADN">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px; color: #00a8e8;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                            <span style="margin-left: 6px;">ADN</span>
                        </a>
                    ` : ''}
                    <button class="btn-secondary" id="detail-hide-btn" style="margin-left: auto;">
                        ${anime.status === "hidden" ? `
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                            <span style="margin-left: 6px;">Afficher</span>
                        ` : `
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
                            <span style="margin-left: 6px;">Masquer</span>
                        `}
                    </button>
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
            showToast(`"${anime.titleFr}" est de nouveau visible.`, "success");
        } else {
            anime.status = "hidden";
            showToast(`"${anime.titleFr}" a été masqué.`, "info");
        }
        saveData();
        updateStats();
        renderGrid();
        closeModal(detailModal);
    });

    // Bind click events on the episodes progression grid
    detailModalBody.querySelectorAll(".detail-ep-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const epNum = parseInt(e.currentTarget.getAttribute("data-global-ep"));
            if (epNum === watched) {
                changeEpisodeCount(anime.id, watched - 1);
            } else {
                changeEpisodeCount(anime.id, epNum);
            }
            // Re-open/update in place
            showAnimeDetails(anime.id);
        });
    });
    
    openModal(detailModal);
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
    const episodesTotal = parseInt(formEpisodesTotal.value) || 1;
    const episodesWatched = parseInt(formEpisodesWatched.value) || 0;
    const status = formStatus.value;
    const rating = parseInt(formRating.value) || 0;
    const season = formSeason.value.trim() || "Saison 1";
    const genres = formGenres.value.trim();
    const synopsis = formSynopsis.value.trim();
    const cast = formCast.value.trim();
    
    // Validation
    if (episodesWatched > episodesTotal) {
        showToast("Le nombre d'épisodes vus ne peut pas dépasser le total !", "error");
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
                episodesTotal,
                episodesWatched,
                status: finalStatus,
                rating,
                genres,
                synopsis,
                cast
            };
            showToast(`"${titleFr}" mis à jour avec succès.`);
        }
    } else {
        // Create mode
        const newAnime = {
            id: 'anime-' + Date.now(),
            titleFr,
            titleOrig,
            season,
            imageUrl,
            crunchyrollUrl,
            adnUrl,
            episodesTotal,
            episodesWatched,
            status: finalStatus,
            rating,
            genres,
            synopsis,
            cast
        };
        
        animeList.push(newAnime);
        showToast(`"${titleFr}" ajouté à votre liste.`);
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
        showToast(`"${title}" supprimé de votre liste.`, "info");
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
    showToast("Données exportées avec succès !");
}

function importFromJSON(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(event) {
        try {
            const importedData = JSON.parse(event.target.result);
            
            if (Array.isArray(importedData) && importedData.length > 0) {
                // Vérifier si c'est un fichier d'historique partiel (export de compte)
                const isPartialHistory = importedData.every(item => item.titleFr && typeof item.episodesTotal === 'undefined');
                const isFullBackup = importedData.every(item => item.titleFr && typeof item.episodesTotal === 'number');
                
                if (isFullBackup) {
                    animeList = importedData;
                    saveData();
                    updateStats();
                    renderGrid();
                    showToast("Données restaurées avec succès !", "success");
                } else if (isPartialHistory) {
                    // Mode Fusion Historique Crunchyroll
                    let updatedCount = 0;
                    importedData.forEach(importedItem => {
                        const query = importedItem.titleFr.toLowerCase().trim();
                        let localAnime = animeList.find(a => 
                            a.titleFr.toLowerCase().trim() === query || 
                            (a.titleOrig && a.titleOrig.toLowerCase().trim() === query)
                        );
                        
                        if (!localAnime && typeof DEFAULT_ANIME_DATA !== 'undefined') {
                            const catalogAnime = DEFAULT_ANIME_DATA.find(a => 
                                a.titleFr.toLowerCase().trim() === query || 
                                (a.titleOrig && a.titleOrig.toLowerCase().trim() === query)
                            );
                            if (catalogAnime) {
                                localAnime = { ...catalogAnime };
                                animeList.push(localAnime);
                            }
                        }
                        
                        if (localAnime) {
                            const total = parseInt(localAnime.episodesTotal || 12);
                            const watched = Math.max(0, Math.min(parseInt(importedItem.episodesWatched || 0), total));
                            localAnime.episodesWatched = watched;
                            
                            if (watched === total && total > 0) {
                                localAnime.status = "completed";
                            } else if (watched > 0) {
                                localAnime.status = "watching";
                            } else {
                                localAnime.status = "plan-to-watch";
                            }
                            updatedCount++;
                        }
                    });
                    
                    if (updatedCount > 0) {
                        saveData();
                        updateStats();
                        renderGrid();
                        showToast(`${updatedCount} animés mis à jour depuis votre historique Crunchyroll !`, "success");
                    } else {
                        showToast("Aucune correspondance trouvée entre votre historique et les animés du catalogue.", "warning");
                    }
                } else {
                    showToast("Le fichier JSON ne respecte pas le format attendu.", "error");
                }
            } else {
                showToast("Format de fichier JSON non valide ou vide.", "error");
            }
        } catch (err) {
            console.error(err);
            showToast("Erreur lors de la lecture du fichier.", "error");
        }
    };
    reader.readAsText(file);
    
    // Clear input so same file can be selected again
    e.target.value = "";
}

function resetToDefault() {
    if (confirm("Attention ! Vous allez réinitialiser l'application. Toutes vos modifications personnelles seront perdues. Continuer ?")) {
        localStorage.removeItem("crunchy_tracker_progress_v2");
        localStorage.removeItem("crunchy_tracker_animes");
        loadData();
        updateStats();
        renderGrid();
        showToast("Application réinitialisée par défaut.", "info");
    }
}

// ==========================================================================
// PLAYER MODAL ENGINE
// ==========================================================================
// ==========================================================================
// SEASONS AND EPISODES UTILS
// ==========================================================================
function getSeasonAndEpisodeFromGlobal(seasons, globalCount) {
    if (!seasons || !Array.isArray(seasons) || seasons.length === 0) {
        return { seasonIdx: 0, seasonName: "Saison 1", epNum: globalCount };
    }
    let remaining = globalCount;
    for (let i = 0; i < seasons.length; i++) {
        if (remaining <= seasons[i].episodesCount) {
            return { seasonIdx: i, seasonName: seasons[i].name, epNum: remaining };
        }
        remaining -= seasons[i].episodesCount;
    }
    return { 
        seasonIdx: seasons.length - 1, 
        seasonName: seasons[seasons.length - 1].name, 
        epNum: seasons[seasons.length - 1].episodesCount 
    };
}

// ==========================================================================
// PLAYER MODAL ENGINE
// ==========================================================================
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
    
    // Function to render the list of episodes in the sidebar
    const renderPlaylist = () => {
        const listContainer = document.getElementById("player-episodes-list");
        if (!listContainer) return;
        
        listContainer.innerHTML = "";
        const currentWatched = parseInt(anime.episodesWatched || 0);
        
        if (anime.seasons && Array.isArray(anime.seasons) && anime.seasons.length > 0) {
            let globalIndex = 0;
            anime.seasons.forEach((season, seasonIdx) => {
                const seasonHeader = document.createElement("div");
                seasonHeader.style.cssText = "font-size: 12px; font-weight: 700; color: var(--text-muted); margin: 12px 0 6px 0; text-transform: uppercase; letter-spacing: 0.5px;";
                seasonHeader.textContent = season.name;
                listContainer.appendChild(seasonHeader);
                
                for (let i = 1; i <= season.episodesCount; i++) {
                    globalIndex++;
                    const currentGlobalIndex = globalIndex;
                    const item = document.createElement("div");
                    item.className = "player-episode-item";
                    if (currentGlobalIndex === currentPlayingEp) item.classList.add("active");
                    if (currentGlobalIndex <= currentWatched) item.classList.add("watched");
                    
                    const isWatched = currentGlobalIndex <= currentWatched;
                    
                    item.innerHTML = `
                        <span class="player-episode-title">Épisode ${i}</span>
                        <span class="player-episode-status ${isWatched ? 'watched-label' : ''}">
                            ${isWatched ? `
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="width:12px; height:12px;"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                Vu
                            ` : `
                                <svg viewBox="0 0 24 24" fill="currentColor" style="width:10px; height:10px; opacity:0.6;"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                                Lire
                            `}
                        </span>
                    `;
                    
                    item.addEventListener("click", () => {
                        clearCountdown();
                        loadEpisode(currentGlobalIndex);
                    });
                    
                    listContainer.appendChild(item);
                }
            });
        } else {
            // Fallback flat list
            for (let i = 1; i <= total; i++) {
                const currentGlobalIndex = i;
                const item = document.createElement("div");
                item.className = "player-episode-item";
                if (currentGlobalIndex === currentPlayingEp) item.classList.add("active");
                if (currentGlobalIndex <= currentWatched) item.classList.add("watched");
                
                const isWatched = currentGlobalIndex <= currentWatched;
                
                item.innerHTML = `
                    <span class="player-episode-title">Épisode ${i}</span>
                    <span class="player-episode-status ${isWatched ? 'watched-label' : ''}">
                        ${isWatched ? `
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="width:12px; height:12px;"><polyline points="20 6 9 17 4 12"></polyline></svg>
                            Vu
                        ` : `
                            <svg viewBox="0 0 24 24" fill="currentColor" style="width:10px; height:10px; opacity:0.6;"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                            Lire
                        `}
                    </span>
                `;
                
                item.addEventListener("click", () => {
                    clearCountdown();
                    loadEpisode(currentGlobalIndex);
                });
                
                listContainer.appendChild(item);
            }
        }
    };
    
    let countdownInterval = null;
    let countdownTimeout = null;
    
    const clearCountdown = () => {
        if (countdownInterval) clearInterval(countdownInterval);
        if (countdownTimeout) clearTimeout(countdownTimeout);
        const overlay = videoPlayerWrapper.querySelector(".player-countdown-overlay");
        if (overlay) overlay.remove();
    };
    
    const loadEpisode = (epNum) => {
        currentPlayingEp = epNum;
        const currentWatched = parseInt(anime.episodesWatched || 0);
        
        playerAnimeName.textContent = anime.titleFr;
        
        let displayDesc = `Épisode ${epNum} sur ${total}`;
        if (anime.seasons && Array.isArray(anime.seasons) && anime.seasons.length > 0) {
            const mapped = getSeasonAndEpisodeFromGlobal(anime.seasons, epNum);
            displayDesc = `${mapped.seasonName} - Épisode ${mapped.epNum} sur ${total}`;
        }
        playerEpisodeDesc.textContent = displayDesc;
        
        if (epNum <= currentWatched) {
            playerWatchedBtn.disabled = true;
            playerWatchedBtn.querySelector("span").textContent = "Déjà vu";
            playerWatchedBtn.style.opacity = "0.5";
        } else {
            playerWatchedBtn.disabled = false;
            playerWatchedBtn.style.opacity = "1";
            playerWatchedBtn.querySelector("span").textContent = `Marquer l'épisode ${epNum} comme vu`;
        }
        
        videoPlayerWrapper.innerHTML = `
            <div class="crunchy-mock-player">
                <div class="player-placeholder" style="background: linear-gradient(135deg, rgba(20, 21, 25, 0.95), rgba(255, 100, 0, 0.1));">
                    <div class="crunchy-player-overlay-btn-wrapper" style="gap: 12px;">
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
                    </div>
                </div>
            </div>
        `;
        
        playerWatchedBtn.onclick = () => {
            changeEpisodeCount(anime.id, epNum);
            renderPlaylist();
            
            playerWatchedBtn.disabled = true;
            playerWatchedBtn.style.opacity = "0.5";
            playerWatchedBtn.querySelector("span").textContent = "Déjà vu";
            
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
            }
        };
        
        renderPlaylist();
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
    
    const closeBtns = playerModal.querySelectorAll(".close-modal-btn, .modal-overlay");
    closeBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            clearCountdown();
            videoPlayerWrapper.innerHTML = "";
        }, { once: true });
    });
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
        
        // Filter Navigation
        filterTabs.forEach(tab => {
            tab.addEventListener("click", () => {
                filterTabs.forEach(t => t.classList.remove("active"));
                tab.classList.add("active");
                currentFilter = tab.getAttribute("data-status");
                renderGrid();
            });
        });
        
        // Search Listener
        searchInput.addEventListener("input", (e) => {
            currentSearch = e.target.value;
            if (currentSearch.trim() !== "") {
                clearSearchBtn.style.display = "flex";
            } else {
                clearSearchBtn.style.display = "none";
            }
            renderGrid();
        });
        
        // Clear search trigger
        clearSearchBtn.addEventListener("click", () => {
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
        
        // Run background sync automatically after 2 seconds
        setTimeout(syncWithAniList, 2000);
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
                    const titleFr = item.title.english || item.title.romaji;
                    
                    const exists = animeList.some(a => 
                        a.id === localId || 
                        a.id === `franchise-anilist-${item.id}` || 
                        a.titleFr.toLowerCase() === titleFr.toLowerCase()
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
        
        if (newShowsCount > 0 || updatedShowsCount > 0) {
            let msg = "Mise à jour terminée !";
            if (newShowsCount > 0) msg += ` +${newShowsCount} nouveautés VF ajoutées.`;
            if (updatedShowsCount > 0) msg += ` ${updatedShowsCount} animés mis à jour.`;
            showToast(msg, "success");
        } else {
            showToast("Catalogue et épisodes déjà à jour !", "success");
        }
        
    } catch (err) {
        console.error("Sync error :", err);
        syncStatusEl.className = "sync-indicator-badge error";
        syncStatusEl.querySelector(".sync-text").textContent = "Erreur Sync";
        showToast("Impossible de se connecter à AniList pour la mise à jour.", "error");
    }
}
