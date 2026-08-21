import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { lazy, Suspense } from "react";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { canAccessPath, isModuleEnabled } from "./permissions";
import LoadingState from "./components/LoadingState";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import PublicLandingPage from "./pages/PublicLandingPage";
import CheckoutPage from "./pages/CheckoutPage";
import PublicProjectPage from "./pages/PublicProjectPage";
import LegalPage from "./pages/LegalPage";
import { ForgotPasswordPage, ResetPasswordPage } from "./pages/PasswordRecoveryPage";

const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const CatalogPage = lazy(() => import("./pages/CatalogPage"));
const ProjectsPage = lazy(() => import("./pages/ProjectsPage"));
const ProjectDetailPage = lazy(() => import("./pages/ProjectDetailPage"));
const BudgetDocumentPage = lazy(() => import("./pages/BudgetDocumentPage"));
const MeasurementCertificatePage = lazy(() => import("./pages/MeasurementCertificatePage"));
const PlantReviewPage = lazy(() => import("./pages/PlantReviewPage"));
const PlantManualIntakePage = lazy(() => import("./pages/PlantManualIntakePage"));
const SuperAdminPage = lazy(() => import("./pages/SuperAdminPage"));
const CompositionDetailPage = lazy(() => import("./pages/CompositionDetailPage"));
const CompanySettingsPage = lazy(() => import("./pages/CompanySettingsPage"));
const CreditsPage = lazy(() => import("./pages/CreditsPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const QuickCalcPage = lazy(() => import("./pages/QuickCalcPage"));
const ProjectFinancialPage = lazy(() => import("./pages/ProjectFinancialPage"));
const ProjectSiteDiaryPage = lazy(() => import("./pages/ProjectSiteDiaryPage"));
const ProjectFieldQualityPage = lazy(() => import("./pages/ProjectFieldQualityPage"));
const QuoteRequestsPage = lazy(() => import("./pages/QuoteRequestsPage"));
const SuppliersPage = lazy(() => import("./pages/SuppliersPage"));
const ProjectProcurementPage = lazy(() => import("./pages/ProjectProcurementPage"));
const ProjectSchedulePage = lazy(() => import("./pages/ProjectSchedulePage"));
const PracticeOfficePage = lazy(() => import("./pages/PracticeOfficePage"));
const SiteManagementPage = lazy(() => import("./pages/SiteManagementPage"));

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return <LoadingState fullScreen />;
  }
  if (!user) return <Navigate to="/login" replace />;
  // Antes só o menu escondia páginas que o perfil não devia usar — a rota em si continuava
  // acessível escrevendo o URL directamente. Agora bloqueia aqui também (o backend já recusava
  // as chamadas de escrita/leitura correspondentes, isto só evita mostrar um ecrã vazio/quebrado).
  if (!canAccessPath(user, location.pathname)) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="card card-pad max-w-sm text-center">
          <p className="text-sm font-medium text-gray-900 mb-1">Sem acesso a esta página</p>
          <p className="text-xs text-gray-500">O seu perfil não tem permissão para ver esta secção.</p>
        </div>
      </div>
    );
  }
  if (user.role !== "super_admin" && location.pathname !== "/admin" && !isModuleEnabled(location.pathname, user.enabledModules)) {
    return <Navigate to={user.enabledModules.includes("dashboard") ? "/painel" : "/perfil"} replace />;
  }
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/registar" element={<RegisterPage />} />
      <Route path="/recuperar-palavra-passe" element={<ForgotPasswordPage />} />
      <Route path="/repor-palavra-passe" element={<ResetPasswordPage />} />
      <Route path="/legal/:page" element={<LegalPage />} />
      <Route path="/obra/:token" element={<PublicProjectPage />} />
      <Route path="/" element={<PublicLandingPage />} />
      <Route path="/checkout/:planSlug" element={<CheckoutPage />} />
      <Route
        path="/painel"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/catalogo"
        element={
          <ProtectedRoute>
            <CatalogPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/catalogo/composicoes/:id"
        element={
          <ProtectedRoute>
            <CompositionDetailPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/medicoes"
        element={
          <ProtectedRoute>
            <ProjectsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/orcamentos"
        element={
          <ProtectedRoute>
            <ProjectsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/gestao"
        element={
          <ProtectedRoute>
            <SiteManagementPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/gestao/cotacoes"
        element={
          <ProtectedRoute>
            <QuoteRequestsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/gestao/fornecedores"
        element={
          <ProtectedRoute>
            <SuppliersPage />
          </ProtectedRoute>
        }
      />
      <Route path="/fornecedores" element={<Navigate to="/gestao/fornecedores" replace />} />
      <Route path="/fornecedores/pedidos" element={<Navigate to="/gestao" replace />} />
      {/* O Portal do Fornecedor (/fornecedor/*) é um site à parte — apps/supplier — nunca uma
          rota deste SPA. Ver apps/api/src/app.ts para o mapeamento de produção. */}
      <Route path="/projectos" element={<Navigate to="/orcamentos" replace />} />
      <Route
        path="/projectos/:projectId"
        element={
          <ProtectedRoute>
            <ProjectDetailPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/projectos/:projectId/cronograma"
        element={
          <ProtectedRoute>
            <ProjectSchedulePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/projectos/:projectId/financeiro"
        element={
          <ProtectedRoute>
            <ProjectFinancialPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/projectos/:projectId/diario"
        element={
          <ProtectedRoute>
            <ProjectSiteDiaryPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/projectos/:projectId/qualidade"
        element={
          <ProtectedRoute>
            <ProjectFieldQualityPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/projectos/:projectId/compras"
        element={
          <ProtectedRoute>
            <ProjectProcurementPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/documentos/:documentId"
        element={
          <ProtectedRoute>
            <BudgetDocumentPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/autos/:id"
        element={
          <ProtectedRoute>
            <MeasurementCertificatePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/plantas/:id"
        element={
          <ProtectedRoute>
            <PlantReviewPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/plantas/:id/completar"
        element={
          <ProtectedRoute>
            <PlantManualIntakePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin"
        element={
          <ProtectedRoute>
            <SuperAdminPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/empresa"
        element={
          <ProtectedRoute>
            <CompanySettingsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/creditos"
        element={
          <ProtectedRoute>
            <CreditsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/calculos-rapidos"
        element={
          <ProtectedRoute>
            <QuickCalcPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/escritorio"
        element={
          <ProtectedRoute>
            <PracticeOfficePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/perfil"
        element={
          <ProtectedRoute>
            <ProfilePage />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Suspense fallback={<LoadingState fullScreen />}><AppRoutes /></Suspense>
    </AuthProvider>
  );
}
