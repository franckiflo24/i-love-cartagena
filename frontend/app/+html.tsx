import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

// Evaluated ONCE at static-export time → every deploy gets a unique version.
// Stale clients see stored ≠ current on their next HTML load and hard-reload
// once (the '3.1.0' era required a MANUAL bump on every deploy — five Walking
// Layer deploys shipped without one, leaving returning devices on the old
// bundle. Never again: the stamp is automatic.)
const BUILD_VERSION = `3.2.0-${Date.now()}`;

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
        <meta name="apple-mobile-web-app-title" content="AMO Cartagena" />
        {/* PWA manifest + installed-app icon (red brand, matches the preloader) */}
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/splash/amo-icon-192.png" />
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
        <title>AMO Cartagena — Tu guía definitiva de Cartagena de Indias</title>
        <meta name="description" content="Descubre 800+ restaurantes, bares, hoteles, playas y experiencias en Cartagena de Indias. Reservas, City Pass, recompensas y concierge IA." />
        <meta property="og:title" content="AMO Cartagena" />
        <meta property="og:description" content="Descubre 800+ lugares, eventos y experiencias en Cartagena de Indias. Tu guía definitiva." />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://www.amocartagena.co" />
        <meta property="og:image" content="https://www.amocartagena.co/data/og-image.jpg" />
        <meta property="og:locale" content="es_CO" />
        <meta property="og:locale:alternate" content="en_US" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="AMO Cartagena" />
        <meta name="twitter:description" content="Descubre 800+ lugares en Cartagena de Indias" />
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

            /* iPhone dynamic island notch */
            #root::before {
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

          /* Brand logo video (animated AMO ❤ world · Cityguide & Lifestyle lockup) */
          .amo-logo-video {
            width: min(76vw, 400px);
            height: auto;
            object-fit: contain;
            /* Feather the video edges into the black bg so the compression-gray border
               and the reveal glow never read as a rectangle. The center stays fully
               opaque, so the AMO ❤ lockup + tagline are never clipped. */
            -webkit-mask-image: radial-gradient(ellipse 72% 82% at 50% 50%, #000 62%, transparent 96%);
            mask-image: radial-gradient(ellipse 72% 82% at 50% 50%, #000 62%, transparent 96%);
            animation: amo-fadein 0.5s ease forwards;
          }
          @keyframes amo-fadein {
            from { opacity: 0; }
            to { opacity: 1; }
          }

          /* Progress bar */
          .amo-progress {
            position: absolute;
            bottom: max(40px, env(safe-area-inset-bottom, 20px));
            left: 50%;
            transform: translateX(-50%);
            width: 120px;
            height: 2px;
            background: rgba(255,255,255,0.06);
            border-radius: 2px;
            overflow: hidden;
            opacity: 0;
            animation: amo-fadein 0.6s ease 0.8s forwards;
          }
          .amo-progress i {
            display: block;
            height: 100%;
            width: 40%;
            border-radius: 2px;
            background: linear-gradient(90deg, transparent, #12B5A5, transparent);
            animation: amo-slide 1.4s ease-in-out infinite;
          }
          @keyframes amo-slide {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(350%); }
          }
        `}} />
      </head>
      <body>
        <div id="amo-preloader">
          {/* New brand logo (AMO ❤ world · Cityguide & Lifestyle). The <video> plays
              the animated reveal; the poster is the final logo frame so the full brand
              paints instantly and remains if the video can't play (Safari-only HEVC is
              transcoded to H.264 mp4 + VP9 webm, muted+playsinline for autoplay). */}
          <video className="amo-logo-video" autoPlay muted playsInline poster="/brand/amo-logo-poster.jpg" aria-label="AMO — Cityguide & Lifestyle">
            <source src="/brand/amo-logo.webm" type="video/webm" />
            <source src="/brand/amo-logo.mp4" type="video/mp4" />
          </video>
          <div className="amo-progress"><i></i></div>
        </div>
        {children}
        <script dangerouslySetInnerHTML={{ __html: `
          (function(){
            var p=document.getElementById('amo-preloader');
            if(!p)return;
            // Hold the brand moment at least MIN ms so the logo reveal (AMO → heart →
            // tagline) always completes even when the app hydrates in <1s. Fast loads
            // wait up to MIN; slow loads dismiss as soon as they're ready past it.
            var START=Date.now(), MIN=2000, done=false;
            var dismiss=function(){
              if(done)return; done=true;
              setTimeout(function(){
                p.classList.add('hide');
                setTimeout(function(){if(p.parentNode)p.parentNode.removeChild(p)},600);
              }, Math.max(0, MIN-(Date.now()-START)));
            };
            // Watch for React hydration: Expo sets __EXPO_ROUTER_HYDRATE__ then
            // the real UI replaces the static shell. Use MutationObserver on #root
            // to detect when the ActivityIndicator is gone and real content appears.
            var mo=new MutationObserver(function(){
              // Once the tab bar or any nav element renders, the app is ready
              var ready=document.querySelector('[role="tablist"]')||
                        document.querySelector('[data-testid]')||
                        document.querySelector('img[src*="googleapis"]');
              if(ready){mo.disconnect();dismiss();}
            });
            var root=document.getElementById('root');
            if(root)mo.observe(root,{childList:true,subtree:true});
            // Fallback: dismiss after 4s no matter what (never block the user)
            setTimeout(function(){mo.disconnect();dismiss()},4000);
          })();
        `}} />
        <script dangerouslySetInnerHTML={{ __html: `
          (function(){
            var APP_VERSION = '${BUILD_VERSION}';
            // Listen for SW update message → reload
            if (navigator.serviceWorker) {
              navigator.serviceWorker.addEventListener('message', function(e) {
                if (e.data && e.data.type === 'SW_UPDATED') {
                  window.location.reload();
                }
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
            // Version check: if user has old cached version, force reload once
            try {
              var stored = localStorage.getItem('amo_app_version');
              if (stored && stored !== APP_VERSION) {
                localStorage.setItem('amo_app_version', APP_VERSION);
                window.location.reload();
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
