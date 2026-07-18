package com.app.animetracker;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {

    private static final String APP_URL = "https://yolscript.github.io/anime-tracker-vf/";
    private static final String APP_HOST = "yolscript.github.io";

    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        // Cache local : DOM storage (localStorage), base de données et cache HTTP.
        // Le service worker du site (sw.js) est aussi actif dans le WebView et
        // pre-cache toutes les ressources pour un usage hors-ligne.
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        // Marqueur fiable pour que le site détecte l'application
        // (le "; wv)" du user-agent n'est pas garanti sur tous les appareils)
        settings.setUserAgentString(settings.getUserAgentString() + " AnimeTrackerApp/1.7");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String host = uri.getHost();
                String path = uri.getPath() == null ? "" : uri.getPath();

                // Page d'autorisation Discord : ouvrir l'app Discord installée
                // (deep link) pour autoriser sans retaper de mot de passe. Le
                // retour se fait via animetrackervf://callback (voir manifest).
                boolean isDiscordAuthorize = host != null
                        && (host.equals("discord.com") || host.endsWith(".discord.com"))
                        && path.contains("/oauth2/authorize");
                if (isDiscordAuthorize) {
                    Uri target = uri;
                    if (path.startsWith("/api/")) {
                        // /api/oauth2/authorize -> /oauth2/authorize : l'app Discord
                        // ne gère le deep link que sur ce second chemin.
                        target = Uri.parse(uri.toString().replace("/api/oauth2/authorize", "/oauth2/authorize"));
                    }
                    // 1. Forcer l'app Discord si elle est installée et accepte ce lien
                    Intent discordApp = new Intent(Intent.ACTION_VIEW, target);
                    discordApp.setPackage("com.discord");
                    try {
                        startActivity(discordApp);
                    } catch (Exception notHandledByDiscordApp) {
                        // 2. Sinon : navigateur (session Discord web souvent déjà active)
                        try {
                            startActivity(new Intent(Intent.ACTION_VIEW, target));
                        } catch (Exception ignored) {
                        }
                    }
                    return true;
                }

                // Discord n'est autorise dans le WebView que sur les chemins du
                // flux OAuth lui-meme (pas tout discord.com) : reduit la surface
                // de confiance du WebView exporte au strict necessaire pour que
                // la connexion aboutisse.
                boolean isDiscordAuthFlow = host != null
                        && (host.equals("discord.com") || host.endsWith(".discord.com"))
                        && (path.startsWith("/oauth2/") || path.startsWith("/api/oauth2/") || path.startsWith("/login"));

                if (host != null && (host.equals(APP_HOST)
                        // Reste du flux Supabase (callback OAuth) : rester dans le WebView
                        || host.endsWith(".supabase.co")
                        || isDiscordAuthFlow)) {
                    return false; // navigation interne dans le WebView
                }
                // Liens externes (Crunchyroll, ADN...) -> navigateur / app dédiée
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) {
                }
                return true;
            }
        });
        webView.setWebChromeClient(new WebChromeClient());

        setContentView(webView);

        if (!handleAuthDeepLink(getIntent())) {
            if (savedInstanceState != null) {
                webView.restoreState(savedInstanceState);
            } else {
                webView.loadUrl(APP_URL);
            }
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleAuthDeepLink(intent);
    }

    // Retour du login Discord : animetrackervf://callback#access_token=... (flux implicite)
    // ou animetrackervf://callback?code=... (flux PKCE). On recharge le site avec
    // les mêmes paramètres pour que supabase-js récupère la session.
    private boolean handleAuthDeepLink(Intent intent) {
        if (intent == null || intent.getData() == null) return false;
        Uri data = intent.getData();
        if (!"animetrackervf".equals(data.getScheme())) return false;
        String fragment = data.getFragment();
        String query = data.getQuery();
        String target = APP_URL;
        if (fragment != null && !fragment.isEmpty()) {
            target = APP_URL + "#" + fragment;
        } else if (query != null && !query.isEmpty()) {
            target = APP_URL + "?" + query;
        }
        webView.loadUrl(target);
        return true;
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
            // Déclencher une synchronisation cloud à chaque retour au premier plan
            webView.evaluateJavascript("if(window.__animeSyncPull){window.__animeSyncPull();}", null);
        }
    }

    @Override
    protected void onPause() {
        if (webView != null) {
            webView.onPause();
        }
        super.onPause();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }
}
