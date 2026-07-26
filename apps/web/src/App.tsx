import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
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

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-gray-400">A carregar...</div>;
  }
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
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
        path="/projectos"
        element={
          <ProtectedRoute>
            <ProjectsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/projectos/:projectId"
        element={
          <ProtectedRoute>
            <ProjectDetailPage />
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
