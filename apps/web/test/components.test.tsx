import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import RoleBadge, { roleLabel } from "../src/components/RoleBadge";
import EmptyState from "../src/components/EmptyState";
import StatusBadge from "../src/components/StatusBadge";
import ConfirmDialog from "../src/components/ConfirmDialog";
import LoadingState from "../src/components/LoadingState";

describe("RoleBadge", () => {
  it("mostra o rótulo e a descrição do perfil", () => {
    render(<RoleBadge role="engenheiro_fiscal" />);
    expect(screen.getByText("Engenheiro/Fiscal")).toBeInTheDocument();
    expect(screen.getByText(/diário de obra/i)).toBeInTheDocument();
  });

  it("esconde a descrição quando showDescription=false", () => {
    render(<RoleBadge role="visualizador" showDescription={false} />);
    expect(screen.getByText("Visualizador")).toBeInTheDocument();
    expect(screen.queryByText(/sem permissão/i)).not.toBeInTheDocument();
  });

  it("roleLabel devolve o mesmo rótulo para todos os perfis", () => {
    expect(roleLabel("super_admin")).toBe("Super Admin");
    expect(roleLabel("admin_empresa")).toBe("Administrador da Empresa");
  });
});

describe("EmptyState", () => {
  it("mostra o título, descrição e acção", () => {
    render(<EmptyState title="Sem projectos" description="Crie o primeiro." action={<button>Criar</button>} />);
    expect(screen.getByText("Sem projectos")).toBeInTheDocument();
    expect(screen.getByText("Crie o primeiro.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Criar" })).toBeInTheDocument();
  });
});

describe("LoadingState", () => {
  it("mostra o rótulo por omissão", () => {
    render(<LoadingState />);
    expect(screen.getByText("A carregar...")).toBeInTheDocument();
  });
});

describe("StatusBadge", () => {
  it("aplica a classe de cor correspondente ao tom", () => {
    render(<StatusBadge label="Activo" tone="green" />);
    expect(screen.getByText("Activo")).toHaveClass("badge-green");
  });
});

describe("ConfirmDialog", () => {
  it("chama onConfirm/onCancel ao clicar nos botões", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog title="Remover?" message="Tem a certeza?" onConfirm={onConfirm} onCancel={onCancel} />);

    const title = screen.getByText("Remover?");
    expect(title).toBeInTheDocument();
    // Os modais precisam de sair do <main> animado. Caso contrário, em páginas longas o
    // `position: fixed` passa a usar a altura do conteúdo e o painel fica fora do viewport.
    expect(title.closest(".fixed")?.parentElement).toBe(document.body);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("desactiva os botões e mostra 'A processar...' quando busy", () => {
    render(<ConfirmDialog title="Remover?" message="..." busy onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole("button", { name: "A processar..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
  });
});
