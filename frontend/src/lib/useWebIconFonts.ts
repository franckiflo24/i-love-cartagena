// Native no-op twin of useWebIconFonts.web.ts. On iOS/Android there is no
// hydration, and @expo/vector-icons loads its own font per icon, so the
// binaries keep exactly the behaviour they shipped with.
export function useWebIconFonts(): void {}
