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
        <title>AMO Cartagena</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: `
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
        `}} />
      </head>
      <body>{children}</body>
    </html>
  );
}
