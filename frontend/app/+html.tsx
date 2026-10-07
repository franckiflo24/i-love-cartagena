import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

// Evaluated ONCE at static-export time → every deploy gets a unique version.
// Stale clients see stored ≠ current on their next HTML load and hard-reload
// once (the '3.1.0' era required a MANUAL bump on every deploy — five Walking
// Layer deploys shipped without one, leaving returning devices on the old
// bundle. Never again: the stamp is automatic.)
const BUILD_VERSION = `3.3.0-${Date.now()}`;

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="es">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
        <meta name="theme-color" content="#050814" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="AMO Life" />
        {/* Smart App Banner — iOS Safari shows a native "Amo Cartagena · GET" bar
            linking straight to the App Store (id 6809565354), so web visitors can
            install the native app in one tap without searching the store. */}
        <meta name="apple-itunes-app" content="app-id=6809565354" />
        {/* ── TRANSLATE CRASH BUNDLE (elite-audit fix #1, 2026-10-07) ─────────
            Chrome's Google Translate wraps React's text nodes in <font> tags;
            the next big re-render then throws NotFoundError on removeChild and
            the app dies to the error boundary — reproduced twice on live
            (login completion, Luna's answer). Two inline defenses that must
            run BEFORE the bundle:
            1) pre-hydration <html lang> sync from the stored choice or the
               browser language, so an English Chrome sees lang=en and never
               offers to translate the Spanish-built shell (LanguageContext
               re-syncs reactively after hydration — this closes the boot gap);
            2) the standard removeChild/insertBefore guard, so when Translate
               (or any extension) does steal nodes, React keeps working instead
               of crashing. Guarded ops behave exactly like React's own
               expectations on healthy DOM — the patch is a no-op there. */}
        <script dangerouslySetInnerHTML={{ __html: `
          (function(){
            try{
              var l = null;
              try { l = localStorage.getItem('@musica_lang'); } catch(e){}
              if (l !== 'es' && l !== 'en' && l !== 'fr' && l !== 'pt') {
                var n = (navigator.languages && navigator.languages[0]) || navigator.language || '';
                n = String(n).toLowerCase();
                l = n.indexOf('es')===0 ? 'es' : n.indexOf('fr')===0 ? 'fr' : n.indexOf('pt')===0 ? 'pt' : n ? 'en' : 'es';
              }
              document.documentElement.lang = l;
            }catch(e){}
            try{
              if (typeof Node === 'function' && Node.prototype) {
                var rc = Node.prototype.removeChild;
                Node.prototype.removeChild = function(child){
                  if (child && child.parentNode !== this) { return child; }
                  return rc.apply(this, arguments);
                };
                var ib = Node.prototype.insertBefore;
                Node.prototype.insertBefore = function(node, ref){
                  if (ref && ref.parentNode !== this) { return this.appendChild(node); }
                  return ib.apply(this, arguments);
                };
              }
            }catch(e){}
          })();
        ` }} />
        {/* PWA manifest + installed-app icon (red brand, matches the preloader) */}
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" sizes="180x180" href="/splash/amo-icon-180.png" />
        {/* Paint the loading-screen logo immediately (it is the first thing users see). */}
        <link rel="preload" as="image" href="/brand/amo-life-logo-1200.webp" type="image/webp" />
        {/* iOS home-screen LAUNCH images — the red AMO·Cartagena splash, so the
            installed app opens with the same brand moment as the web preloader
            (instead of a blank screen). Per-device. */}
        <link rel="apple-touch-startup-image" media="(device-width: 440px) and (device-height: 956px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" href="/splash/apple-splash-1320x2868.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" href="/splash/apple-splash-1290x2796.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" href="/splash/apple-splash-1284x2778.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" href="/splash/apple-splash-1242x2688.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" href="/splash/apple-splash-828x1792.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 402px) and (device-height: 874px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" href="/splash/apple-splash-1206x2622.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" href="/splash/apple-splash-1179x2556.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" href="/splash/apple-splash-1170x2532.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" href="/splash/apple-splash-1125x2436.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" href="/splash/apple-splash-750x1334.png" />
        <meta name="mobile-web-app-capable" content="yes" />
        <title>AMO Life — El mundo en tu mano | Guía de viajes con IA</title>
        <meta name="description" content="AMO Life: tu guía de viajes y concierge con IA. Empezamos en Cartagena de Indias — 800+ lugares verificados, eventos, mapas y experiencias. Próximamente, más destinos." />
        <meta property="og:title" content="AMO Life — El mundo en tu mano" />
        <meta property="og:description" content="Tu guía de viajes y concierge con IA. Empezamos en Cartagena de Indias. Próximamente, más destinos." />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://www.amocartagena.co" />
        <meta property="og:image" content="https://www.amocartagena.co/data/og-image.jpg" />
        <meta property="og:locale" content="es_CO" />
        <meta property="og:locale:alternate" content="en_US" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="AMO Life — El mundo en tu mano" />
        <meta name="twitter:description" content="Guía de viajes y concierge con IA. Empezamos en Cartagena." />
        {/* SEO: canonical + keywords + international alternates */}
        <link rel="canonical" href="https://www.amocartagena.co" />
        <meta name="keywords" content="Cartagena, guía Cartagena, turismo Cartagena, qué hacer en Cartagena, restaurantes Cartagena, hoteles Cartagena, Islas del Rosario, Barú, Getsemaní, tours Cartagena, playas, eventos Cartagena, concierge, Cartagena Colombia travel guide" />
        <link rel="alternate" hrefLang="es" href="https://www.amocartagena.co" />
        <link rel="alternate" hrefLang="en" href="https://www.amocartagena.co" />
        <link rel="alternate" hrefLang="x-default" href="https://www.amocartagena.co" />
        {/* Structured data: helps Google surface the app + an install link */}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "MobileApplication",
          "name": "AMO Life",
          "operatingSystem": "iOS",
          "applicationCategory": "TravelApplication",
          "url": "https://www.amocartagena.co",
          "downloadUrl": "https://apps.apple.com/app/id6809565354",
          "inLanguage": ["es", "en"],
          "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" },
          "description": "AMO Life: tu guía de viajes y concierge con IA. Empezamos en Cartagena de Indias con 800+ lugares verificados, eventos, mapas con rutas a pie y planes a las Islas del Rosario. Próximamente, más destinos.",
          "publisher": { "@type": "Organization", "name": "MachineMind LLC" }
        }) }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "WebSite",
          "name": "AMO Life",
          "url": "https://www.amocartagena.co",
          "inLanguage": "es"
        }) }} />
        <link rel="icon" type="image/png" sizes="512x512" href="/brand/amo-heart-512.png" />
        <link rel="icon" type="image/png" sizes="32x32" href="/brand/amo-heart-32.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: `
          /* ── Icon fonts (Expo static export does not bundle these automatically) ── */
          @font-face {
            font-family: 'Ionicons';
            src: url('https://cdn.jsdelivr.net/npm/@expo/vector-icons@15.0.3/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf') format('truetype');
            font-display: block;
          }
          @font-face {
            font-family: 'MaterialIcons';
            src: url('https://cdn.jsdelivr.net/npm/@expo/vector-icons@15.0.3/build/vendor/react-native-vector-icons/Fonts/MaterialIcons.ttf') format('truetype');
            font-display: block;
          }
          @font-face {
            font-family: 'FontAwesome';
            src: url('https://cdn.jsdelivr.net/npm/@expo/vector-icons@15.0.3/build/vendor/react-native-vector-icons/Fonts/FontAwesome.ttf') format('truetype');
            font-display: block;
          }

          @viewport { width: device-width; }

          html, body, #root {
            height: 100%;
            margin: 0;
            padding: 0;
            background: #020408;
            overflow: hidden;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
          }

          /* Mobile phone shell for desktop browsers */
          @media (min-width: 500px) {
            body {
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              background: #020408;
              background-image:
                radial-gradient(ellipse at 30% 20%, rgba(18,181,165,0.03) 0%, transparent 50%),
                radial-gradient(ellipse at 70% 80%, rgba(18,181,165,0.02) 0%, transparent 50%);
            }

            #root {
              width: 393px;
              height: 852px;
              max-height: 95vh;
              border-radius: 44px;
              overflow: hidden;
              box-shadow:
                0 0 0 1px rgba(255,255,255,0.06),
                0 0 0 8px #0a0a0a,
                0 0 0 9px rgba(255,255,255,0.08),
                0 25px 80px rgba(0,0,0,0.6),
                0 0 120px rgba(18,181,165,0.04);
              position: relative;
            }

            /* iPhone dynamic island notch — disabled: RN-web has no safe-area inset,
               so this decoration sat ON TOP of real UI (hid the /mapa "Pasaporte"
               chip, clipped "Dashboard" and the Agenda title at desktop widths). */
            #root::before {
              display: none;
              content: '';
              position: absolute;
              top: 10px;
              left: 50%;
              transform: translateX(-50%);
              width: 126px;
              height: 34px;
              background: #000;
              border-radius: 20px;
              z-index: 9999;
              pointer-events: none;
            }

            /* Subtle side buttons */
            #root::after {
              content: '';
              position: absolute;
              right: -3px;
              top: 180px;
              width: 3px;
              height: 60px;
              background: rgba(255,255,255,0.08);
              border-radius: 0 3px 3px 0;
              pointer-events: none;
            }
          }

          /* Mobile: full screen */
          @media (max-width: 499px) {
            #root {
              width: 100%;
              height: 100%;
            }
          }

          /* Smooth scrolling inside the app */
          * {
            -webkit-overflow-scrolling: touch;
            scrollbar-width: none;
          }
          *::-webkit-scrollbar { display: none; }

          /* Selection color */
          ::selection {
            background: rgba(18,181,165,0.3);
            color: #FAFAF9;
          }

          /* Disable text selection on interactive elements */
          button, [role="button"], [data-testid] {
            -webkit-user-select: none;
            user-select: none;
          }

          /* Smooth transitions for route changes */
          [data-expo-router-root] {
            height: 100%;
          }

          /* ── AMO Preloader ── */
          #amo-preloader {
            position: fixed;
            inset: 0;
            z-index: 99999;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            /* Pure black to match the logo video's own background (no visible box edge);
               the red heart in the logo provides the colour pop. */
            background: #000;
            transition: opacity 0.5s ease, visibility 0.5s ease;
          }
          #amo-preloader.hide {
            opacity: 0;
            visibility: hidden;
            pointer-events: none;
          }

          /* ── AMO Life loading screen (official art, Sep 2026) ──
             Layered from Phil's loading-screen design so it fits every viewport:
             logo (official lockup) · animated dots · Earth bleeding off the bottom.
             All three sit on pure black, matching the art's own background. */
          .amo-pl-logo {
            width: min(86vw, 560px);
            height: auto;
            margin-top: -12vh;
            opacity: 0;
            animation: amo-fadein 0.6s ease 0.05s forwards;
          }
          .amo-pl-dots {
            display: flex;
            gap: 14px;
            margin-top: 6vh;
            opacity: 0;
            animation: amo-fadein 0.5s ease 0.35s forwards;
          }
          .amo-pl-dots i {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: #ff2d3f;
            box-shadow: 0 0 10px 2px rgba(255,45,63,0.65), 0 0 22px 6px rgba(255,45,63,0.25);
            animation: amo-dot 1.2s ease-in-out infinite;
          }
          .amo-pl-dots i:nth-child(2) { animation-delay: 0.2s; }
          .amo-pl-dots i:nth-child(3) { animation-delay: 0.4s; }
          @keyframes amo-dot {
            0%, 100% { opacity: 0.28; transform: scale(0.82); }
            40% { opacity: 1; transform: scale(1); background: #ffd6da; }
          }
          .amo-pl-earth {
            position: absolute;
            bottom: 0;
            left: 50%;
            transform: translateX(-50%);
            /* full width on phones; capped by height so it never climbs into the
               logo on short/landscape screens */
            width: min(100vw, 1000px, 66vh);
            height: auto;
            pointer-events: none;
            -webkit-mask-image: linear-gradient(to right, transparent 0%, #000 14%, #000 86%, transparent 100%);
            mask-image: linear-gradient(to right, transparent 0%, #000 14%, #000 86%, transparent 100%);
            opacity: 0;
            animation: amo-fadein 0.9s ease 0.15s forwards;
          }
          @keyframes amo-fadein {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          @media (prefers-reduced-motion: reduce) {
            .amo-pl-dots i { animation: none; opacity: 0.8; }
          }
        `}} />
      </head>
      <body>
        <div id="amo-preloader">
          {/* Official AMO Life loading screen (logo + dots + Earth), layered. */}
          <picture>
            <source srcSet="/brand/amo-life-earth.webp" type="image/webp" />
            <img className="amo-pl-earth" src="/brand/amo-life-earth.jpg" alt="" aria-hidden="true" />
          </picture>
          <picture>
            <source srcSet="/brand/amo-life-logo-1200.webp" type="image/webp" />
            <img className="amo-pl-logo" src="/brand/amo-life-logo-1200.jpg" alt="AMO Life — El mundo en tu mano" width={1200} height={460} />
          </picture>
          <div className="amo-pl-dots" aria-hidden="true"><i></i><i></i><i></i></div>
        </div>
        {children}
        <script dangerouslySetInnerHTML={{ __html: `
          (function(){
            var p=document.getElementById('amo-preloader');
            if(!p)return;
            // Hold the brand moment at least MIN ms so the logo reveal (AMO → heart →
            // tagline) completes even when the app hydrates in <1s. Fast loads wait
            // up to MIN; slow loads dismiss as soon as they're ready past it.
            // MIN was 2000: the DOM was interactive at 0.4–0.7 s on every screen and
            // the preloader hid a ready app for 2.2 s (4.0–4.7 s on screens the old
            // testid heuristic never matched). 900 ms is the reveal's own length.
            var START=Date.now(), MIN=900, done=false;
            var dismiss=function(){
              if(done)return; done=true;
              setTimeout(function(){
                p.classList.add('hide');
                setTimeout(function(){if(p.parentNode)p.parentNode.removeChild(p)},600);
              }, Math.max(0, MIN-(Date.now()-START)));
            };
            // Readiness = the root layout mounted: app/_layout.tsx sets
            // <html data-app-ready="1"> in its first effect (every route, every
            // screen — no per-screen testid/tablist guessing).
            var html=document.documentElement;
            var isReady=function(){return html.getAttribute('data-app-ready')==='1';};
            var mo=new MutationObserver(function(){ if(isReady()){mo.disconnect();dismiss();} });
            if(isReady()){dismiss();}
            else mo.observe(html,{attributes:true,attributeFilter:['data-app-ready']});
            // Fallback: dismiss after 4s no matter what (never block the user)
            setTimeout(function(){mo.disconnect();dismiss()},4000);
          })();
        `}} />
        <script dangerouslySetInnerHTML={{ __html: `
          (function(){
            var APP_VERSION = '${BUILD_VERSION}';
            // Listen for SW update message → reload AT MOST ONCE per version.
            // Version-aware guard: if we've already reloaded for (or are already
            // running) this version, ignore the message. This makes reload
            // loops structurally impossible even if the SW re-activates or the
            // CDN serves inconsistent sw.js bytes — and prevents the second
            // reload that used to fire on every deploy (HTML stamp reload +
            // SW_UPDATED reload were two separate events).
            if (navigator.serviceWorker) {
              navigator.serviceWorker.addEventListener('message', function(e) {
                if (!e.data || e.data.type !== 'SW_UPDATED') return;
                var v = e.data.version || '';
                try {
                  var cur = localStorage.getItem('amo_app_version');
                  if (v && cur === v) return;           // already on this version
                  if (v && v === APP_VERSION) {          // shell already matches the new SW
                    try { localStorage.setItem('amo_app_version', v); } catch(err) {}
                    return;
                  }
                  var last = sessionStorage.getItem('amo_sw_reloaded_for');
                  if (v && last === v) return;           // this tab already reloaded for it
                  try { sessionStorage.setItem('amo_sw_reloaded_for', v); } catch(err) {}
                  if (v) { try { localStorage.setItem('amo_app_version', v); } catch(err) {} }
                } catch(err) {}
                window.location.reload();
              });
            }
            // Register/update SW on load
            if ('serviceWorker' in navigator) {
              window.addEventListener('load', function() {
                navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
                  .then(function(reg) {
                    // Force check for updates immediately
                    reg.update();
                    // Re-check on every foreground. A PWA / tab left OPEN since a
                    // previous deploy never re-runs this shell script, so the version
                    // check below never fires and it keeps serving yesterday's bundle
                    // (the recurring "I don't see the changes" report). On
                    // visibility→visible we force an SW update check; if a new SW is
                    // live it activates → nukes caches → posts SW_UPDATED → the
                    // listener above reloads. Throttled to once / 30s.
                    var lastCheck = Date.now();
                    document.addEventListener('visibilitychange', function() {
                      if (document.visibilityState !== 'visible') return;
                      var now = Date.now();
                      if (now - lastCheck < 30000) return;
                      lastCheck = now;
                      reg.update();
                    });
                  });
              });
            }
            // Referral capture (1.5): the entry URL is only trustworthy HERE,
            // before any bundle or client routing touches it.
            try {
              var rm = window.location.search.match(/[?&]ref=(AMO[A-Za-z0-9]{4,8})/);
              if (rm) localStorage.setItem('@amo_pending_ref', rm[1].toUpperCase());
            } catch(e) {}
            // Group invite capture (8C2): a ?join=AMOG-XXXX link survives the
            // login redirect only if we grab it in the shell, before routing.
            try {
              var gm = window.location.search.match(/[?&]join=(AMOG-[A-Za-z0-9]{4,8})/i);
              if (gm) localStorage.setItem('@amo_pending_group', gm[1].toUpperCase());
            } catch(e) {}
            // Version check: if user has old cached version, force reload once.
            // Per-tab sessionStorage guard: even if localStorage writes fail or
            // stamps disagree pathologically, one tab can never reload twice in
            // a row for the same version — loops are impossible by construction.
            try {
              var stored = localStorage.getItem('amo_app_version');
              if (stored && stored !== APP_VERSION) {
                var vGuard = sessionStorage.getItem('amo_ver_reloaded_for');
                localStorage.setItem('amo_app_version', APP_VERSION);
                if (vGuard !== APP_VERSION) {
                  try { sessionStorage.setItem('amo_ver_reloaded_for', APP_VERSION); } catch(err) {}
                  window.location.reload();
                }
              } else if (!stored) {
                localStorage.setItem('amo_app_version', APP_VERSION);
              }
            } catch(e) {}
          })();
        `}} />
      </body>
    </html>
  );
}
