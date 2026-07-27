import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type CurrentUser, ApiError } from "../api/client";

type AuthContextValue = {
  user: CurrentUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const loggedInUser = await api.login(email, password);
    setUser(loggedInUser);
  }

  async function logout() {
    await api.logout();
    setUser(null);
  }

  // Recarrega o utilizador actual do servidor — usado depois de mudanças no Perfil (nome,
  // avatar, idioma) para o resto da aplicação (ex: sidebar) reflectir logo a alteração.
  async function refreshUser() {
    const current = await api.me();
    setUser(current);
  }

  return <AuthContext.Provider value={{ user, loading, login, logout, refreshUser }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de AuthProvider");
  return ctx;
}

export { ApiError };
