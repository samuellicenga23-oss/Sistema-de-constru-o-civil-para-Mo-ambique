import { createPortal } from "react-dom";
import type { ReactNode } from "react";

// Os ecrãs usam uma animação no <main> que cria um novo contexto de posicionamento. Um modal
// renderizado dentro desse contentor deixa de ser fixo ao viewport e, em páginas longas, pode
// ficar centrado muito abaixo da área visível. O portal mantém todos os painéis modais no body,
// acima da navegação e sempre centrados no ecrã.
export default function ModalPortal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}
