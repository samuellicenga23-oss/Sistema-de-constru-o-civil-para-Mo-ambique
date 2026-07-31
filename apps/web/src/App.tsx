import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { canAccessPath } from "./permissions";
import LoadingState from "./components/LoadingState";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import CatalogPage from "./pages/CatalogPage";
import ProjectsPage from "./pages/ProjectsPage";
import ProjectDetailPage from "./pages/ProjectDetailPage";
import BudgetDocumentPage from "./pages/BudgetDocumentPage";
import MeasurementCertificatePage from "./pages/MeasurementCertificatePage";
import PlantReviewPage from "./pages/PlantReviewPage";
import SuperAdminPage from "./pages/SuperAdminPage";
import CompositionDetailPage from "./pages/CompositionDetailPage";
import CompanySettingsPage from "./pages/CompanySettingsPage";
import ProfilePage from "./pages/ProfilePage";
import QuickCalcPage from "./pages/QuickCalcPage";
import ProjectFinancialPage from "./pages/ProjectFinancialPage";
import ProjectSiteDiaryPage from "./pages/ProjectSiteDiaryPage";
import SuppliersPage from "./pages/SuppliersPage";
import ProjectPurchasingPage from "./pages/ProjectPurchasingPage";
import ProjectSchedulePage from "./pages/ProjectSchedulePage";
import PublicLandingPage from "./pages/PublicLandingPage";
import CheckoutPage from "./pages/CheckoutPage";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return <LoadingState fullScreen />;
  }
  if (!user) return <Navigate to="/login" replace />;
  if (user.mustChangePassword && location.pathname !== "/perfil") {
    return <Navigate to="/perfil?password=required" replace />;
  }
  // Antes só o menu escondia páginas que o perfil não devia usar — a rota em si continuava
  // acessível escrevendo o URL directamente. Agora bloqueia aqui também (o backend já recusava
  // as chamadas de escrita/leitura correspondentes, isto só evita mostrar um ecrã vazio/quebrado).
  if (!canAccessPath(user.role, location.pathname)) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="card card-pad max-w-sm text-center">
          <p className="text-sm font-medium text-gray-900 mb-1">Sem acesso a esta página</p>
          <p className="text-xs text-gray-500">O seu perfil não tem permissão para ver esta secção.</p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
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
        path="/fornecedores"
        element={
          <ProtectedRoute>
            <SuppliersPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/projectos/:projectId/compras"
        element={
          <ProtectedRoute>
            <ProjectPurchasingPage />
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
        path="/calculos-rapidos"
        element={
          <ProtectedRoute>
            <QuickCalcPage />
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
      <AppRoutes />
    </AuthProvider>
  );
}
