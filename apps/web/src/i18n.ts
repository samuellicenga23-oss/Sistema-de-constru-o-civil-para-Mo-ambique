import { useAuth } from "./auth/AuthContext";

const messages = {
  pt: {
    platformPanel: "Painel da Plataforma",
    dashboard: "Painel",
    measurements: "Levantamentos",
    budgets: "Orçamentos",
    catalog: "Catálogo de Preços",
    suppliers: "Fornecedores",
    quickCalculations: "Cálculos Rápidos",
    companySettings: "Definições da Empresa",
    work: "Trabalho",
    operations: "Operações",
    administration: "Administração",
    profile: "Perfil",
    logout: "Sair",
    collapseMenu: "Recolher menu",
    expandMenu: "Expandir menu",
    openMenu: "Abrir menu",
    closeMenu: "Fechar menu",
    accountSecurity: "Conta, segurança e sessões activas",
    preferences: "Preferências",
    language: "Idioma",
    portuguese: "Português",
    english: "Inglês",
    languageSaved: "Idioma actualizado.",
  },
  en: {
    platformPanel: "Platform Control Center",
    dashboard: "Dashboard",
    measurements: "Quantity take-offs",
    budgets: "Budgets",
    catalog: "Price Catalogue",
    suppliers: "Suppliers",
    quickCalculations: "Quick Calculations",
    companySettings: "Company Settings",
    work: "Workspace",
    operations: "Operations",
    administration: "Administration",
    profile: "Profile",
    logout: "Sign out",
    collapseMenu: "Collapse menu",
    expandMenu: "Expand menu",
    openMenu: "Open menu",
    closeMenu: "Close menu",
    accountSecurity: "Account, security and active sessions",
    preferences: "Preferences",
    language: "Language",
    portuguese: "Portuguese",
    english: "English",
    languageSaved: "Language updated.",
  },
} as const;

export type Language = keyof typeof messages;
export type TranslationKey = keyof typeof messages.pt;

export function useLanguage() {
  const { user } = useAuth();
  const language: Language = user?.preferredLanguage === "en" ? "en" : "pt";
  return { language, t: (key: TranslationKey) => messages[language][key] };
}
