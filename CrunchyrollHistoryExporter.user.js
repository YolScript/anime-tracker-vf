// ==UserScript==
// @name         Crunchyroll → Anime Tracker VF (Sync Historique)
// @namespace    https://anime-tracker-vf.web.app
// @version      2.0
// @description  Synchronise automatiquement votre historique Crunchyroll vers Anime Tracker VF. Récupère vos épisodes vus via l'API interne de Crunchyroll.
// @author       Anime Tracker VF
// @match        https://www.crunchyroll.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // =====================================================================
    // 1. Récupérer le Bearer Token depuis les cookies/session Crunchyroll
    // =====================================================================
    async function getAuthToken() {
        // Méthode 1 : Intercepter le token depuis le localStorage de Crunchyroll
        // Crunchyroll stocke souvent les infos de session dans le localStorage
        const keys = Object.keys(localStorage);
        for (const key of keys) {
            try {
                const val = localStorage.getItem(key);
                if (val && val.includes("access_token")) {
                    const parsed = JSON.parse(val);
                    if (parsed.access_token) {
                        return parsed.access_token;
                    }
                }
            } catch (e) { /* ignore */ }
        }

        // Méthode 3 : Récupérer via l'endpoint token
        try {
            const tokenResp = await fetch("https://www.crunchyroll.com/auth/v1/token", {
                method: "POST",
                credentials: "include",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Authorization": "Basic " + btoa("cr_web:")
                },
                body: "grant_type=etp_rt_cookie"
            });
            if (tokenResp.ok) {
                const tokenData = await tokenResp.json();
                if (tokenData.access_token) {
                    return tokenData.access_token;
                }
            }
        } catch (e) {
            console.error("[CR Sync] Erreur récupération token:", e);
        }

        return null;
    }

    // =====================================================================
    // 2. Récupérer l'Account ID
    // =====================================================================
    async function getAccountId(token) {
        try {
            const resp = await fetch("https://www.crunchyroll.com/accounts/v1/me", {
                credentials: "include",
                headers: {
                    "Authorization": "Bearer " + token,
                    "Accept": "application/json"
                }
            });
            if (resp.ok) {
                const data = await resp.json();
                return data.account_id || data.external_id || null;
            }
        } catch (e) {
            console.error("[CR Sync] Erreur récupération account:", e);
        }
        return null;
    }

    // =====================================================================
    // 3. Récupérer l'historique complet de visionnage
    // =====================================================================
    async function fetchWatchHistory(token, accountId) {
        const allItems = [];
        let nextPage = `https://www.crunchyroll.com/content/v2/${accountId}/watch-history?page_size=100&locale=fr-FR`;

        while (nextPage) {
            try {
                const resp = await fetch(nextPage, {
                    credentials: "include",
                    headers: {
                        "Authorization": "Bearer " + token,
                        "Accept": "application/json"
                    }
                });

                if (!resp.ok) {
                    console.error("[CR Sync] Erreur API watch-history:", resp.status);
                    break;
                }

                const data = await resp.json();

                if (data.data && Array.isArray(data.data)) {
                    allItems.push(...data.data);
                } else if (data.items && Array.isArray(data.items)) {
                    allItems.push(...data.items);
                }

                // Pagination
                if (data.meta && data.meta.next_page) {
                    nextPage = data.meta.next_page;
                } else if (data.next) {
                    nextPage = data.next;
                } else {
                    nextPage = null;
                }
            } catch (e) {
                console.error("[CR Sync] Erreur fetch historique:", e);
                break;
            }
        }

        return allItems;
    }

    // =====================================================================
    // 4. Transformer les données pour Anime Tracker VF
    // =====================================================================
    function transformToTrackerFormat(historyItems) {
        // Regrouper par série
        const seriesMap = {};

        historyItems.forEach(item => {
            // Extraire les infos de la série
            const seriesTitle = item.panel?.episode_metadata?.series_title
                || item.episode_metadata?.series_title
                || item.parent_title
                || item.series_title
                || "";

            if (!seriesTitle) return;

            const episodeNumber = item.panel?.episode_metadata?.episode_number
                || item.episode_metadata?.episode_number
                || item.episode_number
                || 0;

            const seasonNumber = item.panel?.episode_metadata?.season_number
                || item.episode_metadata?.season_number
                || item.season_number
                || 1;

            const seriesId = item.panel?.episode_metadata?.series_id
                || item.episode_metadata?.series_id
                || item.series_id
                || "";

            const seriesSlugTitle = item.panel?.episode_metadata?.series_slug_title
                || item.episode_metadata?.series_slug_title
                || item.series_slug_title
                || "";

            // Calcul de l'épisode global (pour les séries multi-saisons)
            // On additionne les épisodes des saisons précédentes
            const key = seriesTitle.toLowerCase().trim();

            if (!seriesMap[key]) {
                seriesMap[key] = {
                    titleFr: seriesTitle,
                    seriesId: seriesId,
                    seriesSlug: seriesSlugTitle,
                    maxEpisode: 0,
                    seasons: {},
                    crunchyrollUrl: seriesSlugTitle
                        ? `https://www.crunchyroll.com/fr/series/${seriesSlugTitle}`
                        : ""
                };
            }

            // Détecter si c'est du doublage VF (audio_locale == fr-FR)
            const audioLocale = item.panel?.episode_metadata?.audio_locale
                || item.episode_metadata?.audio_locale
                || item.audio_locale
                || "";
            
            const isVf = audioLocale === "fr-FR" || audioLocale.startsWith("fr");

            if (!isVf) return; // Ne garder que le doublage FR (VF)

            // Tracker le max épisode par saison
            if (!seriesMap[key].seasons[seasonNumber]) {
                seriesMap[key].seasons[seasonNumber] = 0;
            }
            seriesMap[key].seasons[seasonNumber] = Math.max(
                seriesMap[key].seasons[seasonNumber],
                parseInt(episodeNumber) || 0
            );

            // Privilégier la VF si au moins un épisode est regardé en VF
            if (!seriesMap[key].audio) {
                seriesMap[key].audio = isVf ? "vf" : "vostfr";
            } else if (isVf) {
                seriesMap[key].audio = "vf";
            }
        });

        // Convertir en format Anime Tracker VF
        const result = [];
        Object.values(seriesMap).forEach(series => {
            // Calculer le total d'épisodes vus (somme de tous les max par saison)
            let totalWatched = 0;
            Object.values(series.seasons).forEach(maxEp => {
                totalWatched += maxEp;
            });

            if (totalWatched > 0) {
                result.push({
                    titleFr: series.titleFr,
                    episodesWatched: totalWatched,
                    crunchyrollUrl: series.crunchyrollUrl,
                    audio: series.audio,
                    source: "crunchyroll"
                });
            }
        });

        return result;
    }

    // =====================================================================
    // 5. Interface utilisateur — Bouton de synchronisation
    // =====================================================================
    function createSyncButton() {
        if (document.getElementById("anime-tracker-sync-btn")) return;

        const btn = document.createElement("button");
        btn.id = "anime-tracker-sync-btn";
        btn.innerHTML = `
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px; vertical-align: middle;">
                <polyline points="23 4 23 10 17 10"></polyline>
                <polyline points="1 20 1 14 7 14"></polyline>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
            </svg>
            Sync → Anime Tracker VF
        `;

        Object.assign(btn.style, {
            position: "fixed",
            bottom: "24px",
            right: "24px",
            backgroundColor: "#ff6400",
            color: "#000000",
            border: "none",
            borderRadius: "24px",
            padding: "12px 20px",
            fontSize: "14px",
            fontWeight: "bold",
            cursor: "pointer",
            boxShadow: "0 8px 24px rgba(255, 100, 0, 0.4)",
            zIndex: "99999",
            fontFamily: "'Outfit', sans-serif",
            transition: "transform 0.2s, background-color 0.2s",
            display: "flex",
            alignItems: "center"
        });

        btn.onmouseover = () => {
            btn.style.backgroundColor = "#ff8533";
            btn.style.transform = "scale(1.05)";
        };
        btn.onmouseout = () => {
            btn.style.backgroundColor = "#ff6400";
            btn.style.transform = "scale(1)";
        };

        btn.addEventListener("click", runSync);
        document.body.appendChild(btn);
    }

    // =====================================================================
    // 6. Exécution de la synchronisation
    // =====================================================================
    async function runSync() {
        const btn = document.getElementById("anime-tracker-sync-btn");
        const originalText = btn.innerHTML;

        btn.innerHTML = `
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px; vertical-align: middle; animation: spin 1s linear infinite;">
                <circle cx="12" cy="12" r="10"></circle>
                <path d="M12 6v6l4 2"></path>
            </svg>
            Synchronisation...
        `;
        btn.disabled = true;
        btn.style.opacity = "0.7";

        // Ajouter l'animation de rotation
        if (!document.getElementById("anime-tracker-spin-style")) {
            const style = document.createElement("style");
            style.id = "anime-tracker-spin-style";
            style.textContent = "@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }";
            document.head.appendChild(style);
        }

        try {
            // Étape 1 : Token
            const token = await getAuthToken();
            if (!token) {
                showNotification("❌ Impossible de récupérer votre session. Êtes-vous bien connecté sur Crunchyroll ?", "error");
                resetButton(btn, originalText);
                return;
            }

            // Étape 2 : Account ID
            const accountId = await getAccountId(token);
            if (!accountId) {
                showNotification("❌ Impossible de récupérer votre profil Crunchyroll.", "error");
                resetButton(btn, originalText);
                return;
            }

            // Étape 3 : Historique
            const history = await fetchWatchHistory(token, accountId);
            if (history.length === 0) {
                showNotification("⚠️ Aucun historique de visionnage trouvé.", "warning");
                resetButton(btn, originalText);
                return;
            }

            // Étape 4 : Transformer
            const trackerData = transformToTrackerFormat(history);

            // Redirection pour synchronisation automatique
            try {
                const b64Data = btoa(unescape(encodeURIComponent(JSON.stringify(trackerData))));
                const trackerUrl = `https://yolscript.github.io/anime-tracker-vf/#sync-data=${b64Data}`;
                window.open(trackerUrl, "_blank");
            } catch (e) {
                console.error("[CR Sync] Erreur redirection auto-sync:", e);
            }

            // Étape 5 : Télécharger le fichier JSON (fallback)
            const dataStr = JSON.stringify(trackerData, null, 2);
            const blob = new Blob([dataStr], { type: "application/json" });
            const url = URL.createObjectURL(blob);

            const a = document.createElement("a");
            a.href = url;
            a.download = `crunchyroll_sync_${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            showNotification(
                `✅ ${trackerData.length} animés synchronisés avec succès vers Anime Tracker VF !`,
                "success"
            );
        } catch (e) {
            console.error("[CR Sync] Erreur:", e);
            showNotification("❌ Erreur lors de la synchronisation : " + e.message, "error");
        }

        resetButton(btn, originalText);
    }

    function resetButton(btn, originalText) {
        btn.innerHTML = originalText;
        btn.disabled = false;
        btn.style.opacity = "1";
    }

    // =====================================================================
    // 7. Notification visuelle
    // =====================================================================
    function showNotification(message, type) {
        const existing = document.getElementById("anime-tracker-notif");
        if (existing) existing.remove();

        const notif = document.createElement("div");
        notif.id = "anime-tracker-notif";

        const bgColor = type === "success" ? "#22c55e"
            : type === "error" ? "#ef4444"
            : "#f59e0b";

        Object.assign(notif.style, {
            position: "fixed",
            top: "24px",
            right: "24px",
            backgroundColor: bgColor,
            color: "#fff",
            padding: "14px 20px",
            borderRadius: "12px",
            fontSize: "14px",
            fontWeight: "600",
            fontFamily: "'Outfit', sans-serif",
            zIndex: "100000",
            maxWidth: "400px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
            transition: "opacity 0.3s, transform 0.3s",
            cursor: "pointer"
        });

        notif.textContent = message;
        notif.addEventListener("click", () => notif.remove());
        document.body.appendChild(notif);

        setTimeout(() => {
            notif.style.opacity = "0";
            notif.style.transform = "translateY(-10px)";
            setTimeout(() => notif.remove(), 300);
        }, 6000);
    }

    // =====================================================================
    // Initialisation
    // =====================================================================
    // Attendre que la page soit chargée, puis afficher le bouton
    if (document.readyState === "complete") {
        setTimeout(createSyncButton, 2000);
    } else {
        window.addEventListener("load", () => setTimeout(createSyncButton, 2000));
    }
})();
