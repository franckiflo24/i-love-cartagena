// Web build only (Metro picks .web.tsx): the real expo-router Head so <title> reaches
// react-helmet-async and document.title is set per route. See WebHead.tsx for native.
export { default } from 'expo-router/head';
