import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="es">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
        <meta name="theme-color" content="#050814" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="mobile-web-app-capable" content="yes" />
        <title>AMO Cartagena — Tu guía definitiva de Cartagena de Indias</title>
        <meta name="description" content="Descubre 700+ restaurantes, bares, hoteles, playas y experiencias en Cartagena de Indias. Reservas, City Pass, recompensas y concierge IA." />
        <meta property="og:title" content="AMO Cartagena" />
        <meta property="og:description" content="Descubre 700+ lugares, eventos y experiencias en Cartagena de Indias. Tu guía definitiva." />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://www.amocartagena.co" />
        <meta property="og:image" content="https://www.amocartagena.co/data/og-image.jpg" />
        <meta property="og:locale" content="es_CO" />
        <meta property="og:locale:alternate" content="en_US" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="AMO Cartagena" />
        <meta name="twitter:description" content="Descubre 700+ lugares en Cartagena de Indias" />
        <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 56 56'%3E%3Cdefs%3E%3ClinearGradient id='h' x1='8' y1='12' x2='48' y2='48'%3E%3Cstop offset='0%25' stop-color='%23F59E0B'/%3E%3Cstop offset='100%25' stop-color='%23D97706'/%3E%3C/linearGradient%3E%3C/defs%3E%3Cpath d='M28 48s-18-11.2-18-24.5C10 16.6 15.6 11 22.5 11c4 0 5.5 2.5 5.5 2.5S29.5 11 33.5 11C40.4 11 46 16.6 46 23.5 46 36.8 28 48 28 48z' fill='url(%23h)'/%3E%3C/svg%3E" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: `
          /* ── Icon fonts (Expo static export does not bundle these automatically) ── */
          @font-face {
            font-family: 'Ionicons';
            src: url('https://cdn.jsdelivr.net/npm/@expo/vector-icons@15.0.3/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf') format('truetype');
            font-display: swap;
          }
          @font-face {
            font-family: 'MaterialIcons';
            src: url('https://cdn.jsdelivr.net/npm/@expo/vector-icons@15.0.3/build/vendor/react-native-vector-icons/Fonts/MaterialIcons.ttf') format('truetype');
            font-display: swap;
          }
          @font-face {
            font-family: 'FontAwesome';
            src: url('https://cdn.jsdelivr.net/npm/@expo/vector-icons@15.0.3/build/vendor/react-native-vector-icons/Fonts/FontAwesome.ttf') format('truetype');
            font-display: swap;
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
                radial-gradient(ellipse at 30% 20%, rgba(217,119,6,0.03) 0%, transparent 50%),
                radial-gradient(ellipse at 70% 80%, rgba(217,119,6,0.02) 0%, transparent 50%);
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
                0 0 120px rgba(217,119,6,0.04);
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
            background: rgba(217,119,6,0.3);
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
            background: #020408;
            background-image:
              radial-gradient(ellipse 600px 400px at 30% 35%, rgba(217,119,6,0.06) 0%, transparent 70%),
              radial-gradient(ellipse 500px 500px at 75% 60%, rgba(217,119,6,0.03) 0%, transparent 70%);
            transition: opacity 0.5s ease, visibility 0.5s ease;
          }
          #amo-preloader.hide {
            opacity: 0;
            visibility: hidden;
            pointer-events: none;
          }

          /* Heart icon */
          .amo-heart {
            width: 56px;
            height: 56px;
            margin-bottom: 20px;
            animation: amo-heartbeat 1.6s ease-in-out infinite;
          }
          .amo-heart svg {
            width: 100%;
            height: 100%;
            filter: drop-shadow(0 0 20px rgba(217,119,6,0.3));
          }
          @keyframes amo-heartbeat {
            0%, 100% { transform: scale(1); }
            15% { transform: scale(1.15); }
            30% { transform: scale(1); }
            45% { transform: scale(1.1); }
            60% { transform: scale(1); }
          }

          /* Brand text */
          .amo-brand {
            font-family: 'Outfit', system-ui, sans-serif;
            font-weight: 700;
            font-size: 28px;
            letter-spacing: 4px;
            text-transform: uppercase;
            background: linear-gradient(135deg, #D97706, #F59E0B, #D97706);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            opacity: 0;
            animation: amo-fadein 0.8s ease 0.2s forwards;
          }
          .amo-sub {
            font-family: 'Outfit', system-ui, sans-serif;
            font-weight: 300;
            font-size: 12px;
            letter-spacing: 3px;
            text-transform: uppercase;
            color: rgba(255,255,255,0.25);
            margin-top: 6px;
            opacity: 0;
            animation: amo-fadein 0.8s ease 0.5s forwards;
          }
          @keyframes amo-fadein {
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
            background: linear-gradient(90deg, transparent, #D97706, transparent);
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
          <div className="amo-heart">
            <svg viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="hg" x1="8" y1="12" x2="48" y2="48">
                  <stop offset="0%" stopColor="#F59E0B" />
                  <stop offset="50%" stopColor="#D97706" />
                  <stop offset="100%" stopColor="#B45309" />
                </linearGradient>
              </defs>
              <path d="M28 48s-18-11.2-18-24.5C10 16.6 15.6 11 22.5 11c4 0 5.5 2.5 5.5 2.5S29.5 11 33.5 11C40.4 11 46 16.6 46 23.5 46 36.8 28 48 28 48z" fill="url(#hg)" />
            </svg>
          </div>
          <div className="amo-brand">AMO</div>
          <div className="amo-sub">Cartagena</div>
          <div className="amo-progress"><i></i></div>
        </div>
        {children}
        <script dangerouslySetInnerHTML={{ __html: `
          (function(){
            var p=document.getElementById('amo-preloader');
            if(!p)return;
            var dismiss=function(){
              p.classList.add('hide');
              setTimeout(function(){if(p.parentNode)p.parentNode.removeChild(p)},600);
            };
            // Watch for React hydration: Expo sets __EXPO_ROUTER_HYDRATE__ then
            // the real UI replaces the static shell. Use MutationObserver on #root
            // to detect when the ActivityIndicator is gone and real content appears.
            var mo=new MutationObserver(function(){
              // Once the tab bar or any nav element renders, the app is ready
              var ready=document.querySelector('[role="tablist"]')||
                        document.querySelector('[data-testid]')||
                        document.querySelector('img[src*="googleusercontent"]');
              if(ready){mo.disconnect();dismiss();}
            });
            var root=document.getElementById('root');
            if(root)mo.observe(root,{childList:true,subtree:true});
            // Fallback: dismiss after 4s no matter what (never block the user)
            setTimeout(function(){mo.disconnect();dismiss()},4000);
          })();
        `}} />
        <script dangerouslySetInnerHTML={{ __html: `
          if ('serviceWorker' in navigator) {
            window.addEventListener('load', function() {
              navigator.serviceWorker.register('/sw.js');
            });
          }
        `}} />
      </body>
    </html>
  );
}
