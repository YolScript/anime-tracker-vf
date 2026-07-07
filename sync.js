// ==========================================================================
// SYNC DISCORD (via Supabase) — synchronise la progression entre appareils
// ==========================================================================
// Configuration : remplir les deux valeurs ci-dessous après avoir créé le
// projet Supabase (Settings > API). Tant qu'elles sont vides, le bouton
// Discord reste masqué et le site fonctionne comme avant (localStorage seul).
const SUPABASE_URL = "https://xjhdqrelwlthecoljuxm.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_3NPZsB8HBSK37ZCekjARBg_8soutVCi";

const SYNC_STORAGE_KEY = "crunchy_tracker_progress_v2";
const SYNC_TABLE = "anime_progress";
const SYNC_VERSION = "15";

// Dans l'APK Android (WebView), le retour du login Discord passe par un
// deep link géré par l'app (voir android-app/MainActivity.java) : le login
// s'ouvre dans l'app Discord installée, puis revient automatiquement ici.
// L'APK ajoute "AnimeTrackerApp" au user-agent (détection fiable) ;
// "; wv)" reste en repli pour les anciennes versions de l'app.
const IS_ANDROID_APP = navigator.userAgent.indexOf("AnimeTrackerApp") !== -1
    || /; wv\)/.test(navigator.userAgent);
const OAUTH_REDIRECT = IS_ANDROID_APP
    ? "animetrackervf://callback"
    : window.location.origin + window.location.pathname;

// Vrai si la page vient d'être ouverte au retour du login Discord
// (jetons dans le fragment en flux implicite, ou ?code= en flux PKCE) :
// après la première synchronisation on recharge la page pour repartir
// sur une UI propre.
const CAME_FROM_OAUTH = window.location.hash.indexOf("access_token") !== -1
    || /[?&]code=/.test(window.location.search);

let sbClient = null;
let syncUser = null;
let syncPushTimer = null;
let lastPushedJson = null;

function isSyncConfigured() {
    return SUPABASE_URL !== "" && SUPABASE_ANON_KEY !== "" && typeof supabase !== "undefined";
}

// Journal de diagnostic : console partout + panneau visible dans l'APK
// (pas de DevTools sur téléphone). Un appui sur le panneau le ferme.
function syncLog(msg) {
    console.log("[Sync] " + msg);
    if (!IS_ANDROID_APP) return;
    let box = document.getElementById("sync-debug-box");
    if (!box) {
        box = document.createElement("div");
        box.id = "sync-debug-box";
        box.style.cssText = "position:fixed;bottom:0;left:0;right:0;max-height:35vh;overflow:auto;"
            + "background:rgba(0,0,0,0.88);color:#7CFC00;font:11px/1.5 monospace;"
            + "padding:8px 10px;z-index:99999;white-space:pre-wrap;border-top:2px solid #ff6400;";
        box.addEventListener("click", () => box.remove());
        (document.body || document.documentElement).appendChild(box);
    }
    box.textContent += msg + "\n";
    box.scrollTop = box.scrollHeight;
}

// ---------- Fusion des progressions (local + cloud) ----------
// Pour chaque animé : max d'épisodes vus, meilleure note, statut le plus avancé.
function mergeProgress(local, cloud) {
    const statusRank = {
        "completed": 4,
        "watching": 3,
        "hidden": 2,
        "on-hold": 1,
        "plan-to-watch": 0
    };
    const merged = { ...cloud };
    Object.keys(local).forEach((id) => {
        const l = local[id];
        const c = merged[id];
        if (!c) {
            merged[id] = l;
            return;
        }
        if (l.isCustom || c.isCustom) {
            // Animé ajouté manuellement : garder la version la plus avancée
            merged[id] = (l.episodesWatched || 0) >= (c.episodesWatched || 0) ? l : c;
            return;
        }
        merged[id] = {
            episodesWatched: Math.max(l.episodesWatched || 0, c.episodesWatched || 0),
            rating: Math.max(l.rating || 0, c.rating || 0),
            status: (statusRank[l.status] || 0) >= (statusRank[c.status] || 0) ? l.status : c.status
        };
    });
    return merged;
}

// ---------- Cloud <-> localStorage ----------
async function pullAndMergeFromCloud(showFeedback) {
    if (!sbClient || !syncUser) return;
    const { data, error } = await sbClient
        .from(SYNC_TABLE)
        .select("data")
        .eq("user_id", syncUser.id)
        .maybeSingle();
    if (error) {
        console.error("[Sync] Erreur de lecture cloud:", error);
        if (showFeedback) showToast("Erreur de synchronisation Discord.", "error");
        return;
    }
    const cloud = (data && data.data) ? data.data : {};
    let local = {};
    try {
        local = JSON.parse(localStorage.getItem(SYNC_STORAGE_KEY) || "{}");
    } catch (e) { /* localStorage corrompu : on repart du cloud */ }

    const merged = mergeProgress(local, cloud);
    localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify(merged));
    await pushToCloud();

    // Recharger l'interface avec les données fusionnées
    if (typeof loadData === "function") {
        loadData();
        if (typeof updateStats === "function") updateStats();
        if (typeof renderGrid === "function") renderGrid();
    }
    if (showFeedback) showToast("Progression synchronisée avec Discord !", "success");
}

async function pushToCloud() {
    if (!sbClient || !syncUser) return;
    const json = localStorage.getItem(SYNC_STORAGE_KEY) || "{}";
    if (json === lastPushedJson) return;
    const { error } = await sbClient.from(SYNC_TABLE).upsert({
        user_id: syncUser.id,
        data: JSON.parse(json),
        updated_at: new Date().toISOString()
    });
    if (error) {
        console.error("[Sync] Erreur d'écriture cloud:", error);
    } else {
        lastPushedJson = json;
    }
}

function schedulePush() {
    if (!syncUser) return;
    clearTimeout(syncPushTimer);
    syncPushTimer = setTimeout(pushToCloud, 2000);
}

// ---------- Interface du bouton ----------
function updateDiscordUi() {
    const btn = document.getElementById("discord-login-btn");
    const label = document.getElementById("discord-btn-label");
    const avatar = document.getElementById("discord-btn-avatar");
    if (!btn) return;
    btn.style.display = "flex";
    if (syncUser) {
        const meta = syncUser.user_metadata || {};
        const name = meta.custom_claims && meta.custom_claims.global_name
            ? meta.custom_claims.global_name
            : (meta.full_name || meta.name || "Discord");
        if (label) label.textContent = name;
        if (avatar && meta.avatar_url) {
            avatar.src = meta.avatar_url;
            avatar.style.display = "block";
        }
        btn.classList.add("connected");
        btn.title = "Synchronisation Discord active — cliquer pour se déconnecter";
    } else {
        if (label) label.textContent = "Discord";
        if (avatar) avatar.style.display = "none";
        btn.classList.remove("connected");
        btn.title = "Connecter Discord pour synchroniser PC et téléphone";
    }
}

// ---------- Initialisation ----------
function initDiscordSync() {
    const btn = document.getElementById("discord-login-btn");
    if (!isSyncConfigured()) {
        if (btn) btn.style.display = "none";
        return;
    }
    // Flux PKCE partout : le ?code= en query string survit au retour deep link
    // Android (le fragment #access_token du flux implicite y est coupé — vérifié
    // sur appareil : retour avec hash vide). Le code verifier reste dans le
    // localStorage du WebView, qui ne quitte jamais la page : l'échange manuel
    // ci-dessous fonctionne donc aussi dans l'application.
    // detectSessionInUrl désactivé : on gère le retour nous-mêmes pour
    // pouvoir afficher les erreurs à l'écran (sinon échec silencieux).
    sbClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { flowType: "pkce", detectSessionInUrl: false }
    });
    syncLog("v" + SYNC_VERSION + " | APK:" + IS_ANDROID_APP
        + " | query:" + (window.location.search || "(vide)")
        + " | hash:" + (window.location.hash ? window.location.hash.substring(0, 30) + "..." : "(vide)"));
    syncLog("verifier localStorage: " + (Object.keys(localStorage).some(k => k.indexOf("code-verifier") !== -1) ? "présent" : "ABSENT"));

    const returnedCode = new URLSearchParams(window.location.search).get("code");
    if (returnedCode) {
        syncLog("Code OAuth reçu, échange en cours...");
        sbClient.auth.exchangeCodeForSession(returnedCode).then(({ error }) => {
            if (error) {
                syncLog("ÉCHEC échange: " + error.message);
                alert("Échec de la connexion Discord :\n\n" + error.message);
                history.replaceState(null, "", window.location.pathname);
            } else {
                syncLog("Échange réussi, session établie.");
            }
        });
    }

    // Flux implicite (application) : jetons directement dans le fragment,
    // session établie manuellement (recommandation Supabase pour mobile).
    const tokenParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const accessToken = tokenParams.get("access_token");
    const refreshToken = tokenParams.get("refresh_token");
    if (accessToken && refreshToken) {
        syncLog("Jetons reçus, établissement de la session...");
        sbClient.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }).then(({ error }) => {
            if (error) {
                syncLog("ÉCHEC setSession: " + error.message);
                alert("Échec de la connexion Discord :\n\n" + error.message);
            } else {
                syncLog("Session établie avec succès.");
            }
            history.replaceState(null, "", window.location.pathname);
        });
    }

    // Si Supabase renvoie une erreur OAuth dans l'URL (mauvais secret Discord,
    // redirect refusé...), l'afficher clairement au lieu d'échouer en silence.
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const queryParams = new URLSearchParams(window.location.search);
    const oauthError = hashParams.get("error_description") || hashParams.get("error")
        || queryParams.get("error_description") || queryParams.get("error");
    if (oauthError) {
        const message = oauthError.replace(/\+/g, " ");
        console.error("[Sync] Erreur OAuth retournée par Supabase:", message);
        if (typeof showToast === "function") {
            showToast("Échec connexion Discord : " + message, "error");
        }
        alert("Échec de la connexion Discord :\n\n" + message);
    }

    btn.addEventListener("click", async () => {
        if (syncUser) {
            if (confirm("Se déconnecter de Discord ? (vos données restent sur cet appareil)")) {
                await sbClient.auth.signOut();
            }
            return;
        }
        syncLog("Lancement login Discord, retour attendu: " + OAUTH_REDIRECT);
        const { error } = await sbClient.auth.signInWithOAuth({
            provider: "discord",
            options: { redirectTo: OAUTH_REDIRECT }
        });
        if (error) {
            syncLog("Échec lancement OAuth: " + error.message);
            showToast("Connexion Discord impossible : " + error.message, "error");
        }
    });

    sbClient.auth.onAuthStateChange((event, session) => {
        syncLog("Événement auth: " + event + " | session: " + (session ? "OUI" : "non"));
        const wasConnected = !!syncUser;
        syncUser = session ? session.user : null;
        lastPushedJson = null;
        updateDiscordUi();
        if (syncUser && !wasConnected) {
            pullAndMergeFromCloud(!CAME_FROM_OAUTH).then(() => {
                if (CAME_FROM_OAUTH) {
                    // Recharger la page une seule fois après le login
                    // (le fragment OAuth disparaît, donc pas de boucle)
                    sessionStorage.setItem("discord_login_reload", "1");
                    window.location.replace(window.location.pathname + window.location.search);
                }
            });
        }
    });

    // Toast de confirmation après le rechargement post-login
    if (sessionStorage.getItem("discord_login_reload")) {
        sessionStorage.removeItem("discord_login_reload");
        if (typeof showToast === "function") {
            showToast("Connexion Discord réussie, progression synchronisée !", "success");
        }
    }

    // Envoyer les modifications locales vers le cloud après chaque sauvegarde
    if (typeof saveData === "function") {
        const originalSaveData = saveData;
        saveData = function (...args) {
            const result = originalSaveData.apply(this, args);
            schedulePush();
            return result;
        };
    }

    // Re-synchroniser quand on revient sur l'onglet / l'app.
    // Plusieurs déclencheurs car le WebView Android n'émet pas toujours
    // visibilitychange : focus, pageshow, hook natif onResume et intervalle.
    const pullIfConnected = () => {
        if (syncUser) pullAndMergeFromCloud(false);
    };
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) pullIfConnected();
    });
    window.addEventListener("focus", pullIfConnected);
    window.addEventListener("pageshow", pullIfConnected);
    setInterval(pullIfConnected, 60000);
    // Appelé par MainActivity (APK) à chaque retour au premier plan
    window.__animeSyncPull = pullIfConnected;

    updateDiscordUi();
}

window.addEventListener("load", initDiscordSync);
