import { Navigate, Route, Routes } from "react-router-dom";
import SupplierLoginPage from "./pages/SupplierLoginPage";
import SupplierRegisterPage from "./pages/SupplierRegisterPage";
import SupplierAcceptInvitePage from "./pages/SupplierAcceptInvitePage";
import SupplierDashboardPage from "./pages/SupplierDashboardPage";
import SupplierQuoteRequestPage from "./pages/SupplierQuoteRequestPage";
import MarketplacePricesPage from "./pages/MarketplacePricesPage";
import SupplierOfferingsPage from "./pages/SupplierOfferingsPage";
import SupplierProfilePage from "./pages/SupplierProfilePage";

// Router próprio, sem qualquer rota do sistema principal — este site só sabe destas páginas.
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<SupplierLoginPage />} />
      <Route path="/registar" element={<SupplierRegisterPage />} />
      <Route path="/aceitar-convite" element={<SupplierAcceptInvitePage />} />
      <Route path="/painel" element={<SupplierDashboardPage />} />
      <Route path="/pedidos/:id" element={<SupplierQuoteRequestPage />} />
      <Route path="/precos" element={<MarketplacePricesPage />} />
      <Route path="/oferta" element={<SupplierOfferingsPage />} />
      <Route path="/perfil" element={<SupplierProfilePage />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
