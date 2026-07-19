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
const SYNC_VERSION = "16";

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
let pushRetryTimer = null;
let lastPushedJson = null;

// Validation minimale des donnees cloud avant de les appliquer en local :
// rejette les entrees qui ne sont pas des objets simples (une ligne Supabase
// corrompue ou d'un ancien format ne doit pas se propager telle quelle).
function sanitizeCloudProgress(cloud) {
    const clean = {};
    if (!cloud || typeof cloud !== "object") return clean;
    Object.keys(cloud).forEach(key => {
        const val = cloud[key];
        if (val && typeof val === "object" && !Array.isArray(val)) {
            clean[key] = val;
        }
    });
    return clean;
}

function isSyncConfigured() {
    return SUPABASE_URL !== "" && SUPABASE_ANON_KEY !== "" && typeof supabase !== "undefined";
}

// Journal de diagnostic : console uniquement
function syncLog(msg) {
    console.log("[Sync] " + msg);
}

// ---------- Cloud <-> localStorage ----------
// Le cloud est la seule source de vérité quand on est connecté : au pull,
// il REMPLACE les données locales (pas de fusion — la dernière modification
// faite sur n'importe quel appareil gagne). Si le cloud est encore vide
// (première connexion), il est initialisé avec les données locales.
async function pullAndMergeFromCloud(showFeedback) {
    if (!sbClient || !syncUser) return;

    // Une modification locale attend encore son envoi (schedulePush pas
    // encore declenche) : l'envoyer d'abord plutot que de laisser ce pull
    // ecraser le changement tout juste fait avec d'anciennes donnees cloud.
    if (syncPushTimer) {
        clearTimeout(syncPushTimer);
        syncPushTimer = null;
        await pushToCloud();
        return;
    }

    const { data, error } = await sbClient
        .from(SYNC_TABLE)
        .select("data")
        .eq("user_id", syncUser.id)
        .maybeSingle();
    if (error) {
        syncLog("Erreur de lecture cloud: " + error.message);
        return;
    }
    const cloud = (data && data.data) ? sanitizeCloudProgress(data.data) : null;

    if (cloud && Object.keys(cloud).length > 0) {
        const json = JSON.stringify(cloud);
        localStorage.setItem(SYNC_STORAGE_KEY, json);
        lastPushedJson = json;
        syncLog("Données cloud appliquées (" + Object.keys(cloud).length + " animés).");
    } else {
        // Cloud vide : première connexion, on l'initialise avec le local
        syncLog("Cloud vide, envoi des données locales...");
        await pushToCloud();
    }

    // Recharger l'interface avec les données à jour
    if (typeof loadData === "function") {
        loadData();
        if (typeof updateStats === "function") updateStats();
        if (typeof renderGrid === "function") renderGrid();
    }
}

async function pushToCloud() {
    if (!sbClient || !syncUser) return;
    const json = localStorage.getItem(SYNC_STORAGE_KEY) || "{}";
    if (json === lastPushedJson) return;

    let progressData = {};
    try {
        progressData = JSON.parse(json);
    } catch(e) {
        console.error("Error parsing progress for pushToCloud", e);
        progressData = {};
    }

    const { error } = await sbClient.from(SYNC_TABLE).upsert({
        user_id: syncUser.id,
        data: progressData,
        updated_at: new Date().toISOString()
    });
    if (error) {
        console.error("[Sync] Erreur d'écriture cloud:", error);
        // Retente automatiquement (erreur transitoire / perte de connexion)
        // au lieu d'abandonner en silence : sans ca, une modification faite
        // hors-ligne pouvait rester bloquee en local indefiniment si aucune
        // autre modification ne relance schedulePush() par la suite.
        if (!pushRetryTimer) {
            pushRetryTimer = setTimeout(() => {
                pushRetryTimer = null;
                if (syncUser) pushToCloud();
            }, 5000);
        }
    } else {
        clearTimeout(pushRetryTimer);
        pushRetryTimer = null;
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
        btn.setAttribute("aria-label", btn.title);
    } else {
        if (label) label.textContent = "Discord";
        if (avatar) avatar.style.display = "none";
        btn.classList.remove("connected");
        btn.title = "Connecter Discord pour synchroniser PC et téléphone";
        btn.setAttribute("aria-label", btn.title);
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
        history.replaceState(null, "", window.location.pathname);
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
        }
    });

    sbClient.auth.onAuthStateChange((event, session) => {
        syncLog("Événement auth: " + event + " | session: " + (session ? "OUI" : "non"));
        if (event === "TOKEN_REFRESHED") {
            // Rafraichissement silencieux du token : meme utilisateur, ne pas
            // reinitialiser l'etat de sync (lastPushedJson) ni redeclencher
            // un pull qui pourrait courir en meme temps qu'un push en cours.
            if (session) syncUser = session.user;
            return;
        }
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

    // Nettoyage du flag de rechargement post-login
    if (sessionStorage.getItem("discord_login_reload")) {
        sessionStorage.removeItem("discord_login_reload");
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
    // Envoie immediatement une modification encore en attente (schedulePush)
    // au lieu de laisser son delai de 2s courir : sans ca, cocher un episode
    // puis fermer l'onglet/l'app aussitot perdait le push cloud.
    const flushPendingPush = () => {
        if (syncPushTimer) {
            clearTimeout(syncPushTimer);
            syncPushTimer = null;
            pushToCloud();
        }
    };
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            flushPendingPush();
        } else {
            pullIfConnected();
        }
    });
    window.addEventListener("pagehide", flushPendingPush);
    window.addEventListener("focus", pullIfConnected);
    window.addEventListener("pageshow", pullIfConnected);
    // Retente un push reste en echec (hors-ligne) des que la connexion revient.
    window.addEventListener("online", () => {
        if (syncUser) pushToCloud();
    });
    setInterval(pullIfConnected, 60000);
    // Appelé par MainActivity (APK) à chaque retour au premier plan
    window.__animeSyncPull = pullIfConnected;

    updateDiscordUi();
}

window.addEventListener("load", initDiscordSync);
