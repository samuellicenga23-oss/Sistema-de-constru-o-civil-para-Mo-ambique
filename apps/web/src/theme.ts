// Mecanismo de tema claro/escuro (Fase 1, Etapa 4) — guarda a preferência e aplica a classe
// "dark" ao <html>. Preparação para o design system da Etapa 5: hoje só a página de Perfil e o
// AppShell reagem a esta classe; o resto da aplicação ainda não tem tokens de cor para modo
// escuro, isso é trabalho da Etapa 5, não desta.
export type Theme = "light" | "dark";

const STORAGE_KEY = "siga-theme";

export function getStoredTheme(): Theme {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "dark" ? "dark" : "light";
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  window.localStorage.setItem(STORAGE_KEY, theme);
}
