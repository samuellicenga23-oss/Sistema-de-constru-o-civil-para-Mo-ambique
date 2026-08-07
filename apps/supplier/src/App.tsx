import { Navigate, Route, Routes } from "react-router-dom";
import SupplierLoginPage from "./pages/SupplierLoginPage";
import SupplierAcceptInvitePage from "./pages/SupplierAcceptInvitePage";
import SupplierDashboardPage from "./pages/SupplierDashboardPage";
import SupplierQuoteRequestPage from "./pages/SupplierQuoteRequestPage";

// Router próprio, sem qualquer rota do sistema principal — este site só sabe destas 4 páginas.
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<SupplierLoginPage />} />
      <Route path="/aceitar-convite" element={<SupplierAcceptInvitePage />} />
      <Route path="/painel" element={<SupplierDashboardPage />} />
      <Route path="/pedidos/:id" element={<SupplierQuoteRequestPage />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
