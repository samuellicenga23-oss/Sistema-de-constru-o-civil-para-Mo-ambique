const LEGACY_TECHNICAL_DESCRIPTIONS = new Map<string, string>([
  [
    "Pintura acrílica em paredes exteriores (2 demãos, incl. primário)",
    "Pintura exterior 100% acrílica, resistente a intempéries/UV, primário e mínimo 2 demãos; acabamento e cor conforme projecto; ou equivalente aprovado",
  ],
  [
    "Pintura de esmalte aquoso em paredes interiores (2 demãos, incl. primário)",
    "Pintura interior estireno-acrílica lavável, esfrega tipo II ou superior, primário e mínimo 2 demãos; acabamento mate e cor conforme projecto; ou equivalente",
  ],
  [
    "Pintura de esmalte aquoso em tectos interiores (2 demãos, incl. primário)",
    "Pintura de tectos estireno-acrílica lavável, primário e mínimo 2 demãos; acabamento mate branco ou cor conforme projecto; ou equivalente",
  ],
  [
    "Fornecimento e montagem de sanita completa com autoclismo",
    "Sanita de louça vitrificada branca, autoclismo dual 3/6 L, assento, ligações e ensaio; saída conforme projecto; ou equivalente aprovado",
  ],
  [
    "Fornecimento e montagem de lavatório com torneira",
    "Lavatório de louça vitrificada 50–60 cm com torneira monocomando, sifão, ligações e ensaio; pedestal/suporte conforme projecto; ou equivalente",
  ],
  [
    "Fornecimento e montagem de base de duche/chuveiro com misturadora",
    "Misturadora de duche cromada, ligações 1/2 polegada, chuveiro, flexível, acessórios e ensaio; ou equivalente aprovado",
  ],
  [
    "Fornecimento e montagem de pia de cozinha com torneira",
    "Lava-louça em aço inox AISI 304, cuba e dimensões conforme projecto, torneira monocomando, sifão, ligações e ensaio; ou equivalente",
  ],
]);

export function technicalDescription(description: string): string {
  return LEGACY_TECHNICAL_DESCRIPTIONS.get(description) ?? description;
}
