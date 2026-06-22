import React from 'react';
import { Stack } from 'expo-router';

/**
 * /eventos  (web)
 * Embeds the self-contained ticket-wallet experience that ships as a static
 * asset at the web root (public/eventos-app.html). The iframe isolates its
 * fonts/styles/scripts so nothing bleeds into or out of the AMO app.
 *
 * If your static assets are served from a different path, change SRC only.
 */
const SRC = '/eventos-app.html';

export default function EventosScreen() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false, title: 'Mi entrada' }} />
      {React.createElement(
        'div',
        { style: { position: 'fixed', inset: 0, background: '#0c0910' } },
        React.createElement('iframe', {
          src: SRC,
          title: 'AMO Eventos — Mi entrada',
          style: { width: '100%', height: '100%', border: 'none', display: 'block' },
          allow: 'clipboard-write',
        })
      )}
    </>
  );
}
