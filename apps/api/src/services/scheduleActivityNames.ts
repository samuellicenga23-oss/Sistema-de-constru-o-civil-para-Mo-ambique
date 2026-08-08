/**
 * O orçamento descreve entregáveis; o cronograma descreve acções executáveis.
 * Estes nomes alteram apenas a apresentação da tarefa. Código, quantidade, preço e ligação ao
 * item original do Mapa de Quantidades permanecem intactos.
 */
const STANDARD_ACTIVITY_NAMES: Record<string, string> = {
  "1.1": "Limpar e regularizar o terreno",
  "1.2": "Implantar e marcar a obra",
  "1.3": "Aplicar tratamento anti-térmitas",
  "2.1": "Escavar as fundações",
  "2.2": "Reaterrar e compactar as fundações",
  "2.3": "Executar aterro com solo de empréstimo",
  "2.4": "Executar enrocamento",
  "2.5": "Aplicar membrana sob o pavimento",
  "3.1": "Executar betão de limpeza",
  "3.2": "Betonar sapatas",
  "3.3": "Armar, cofrar e betonar pilares",
  "3.4": "Armar, cofrar e betonar vigas e lintéis",
  "3.5": "Armar, cofrar e betonar a laje",
  "3.6": "Cortar, dobrar e montar armaduras",
  "3.7": "Montar malha de armadura da laje",
  "3.8": "Montar e desmontar cofragens",
  "4.1": "Elevar paredes em bloco de 20 cm",
  "4.2": "Elevar paredes em bloco de 15 cm",
  "5.1": "Executar betonilhas",
  "5.2": "Rebocar paredes interiores",
  "5.3": "Rebocar fachadas",
  "6.1": "Assentar revestimento de pavimentos",
  "6.2": "Assentar revestimento de paredes",
  "7.1": "Pintar fachadas",
  "7.2": "Pintar paredes interiores",
  "7.3": "Pintar tectos",
  "8.1": "Instalar colectores de esgoto Ø110 mm",
  "8.2": "Instalar ramais de esgoto Ø40 mm",
  "8.3": "Executar caixas de visita",
  "9.1": "Instalar tubos de queda pluvial",
  "10.1": "Impermeabilizar a cobertura",
  "10.2": "Montar a cobertura metálica",
  "10.3": "Aplicar cumeeiras e remates",
  "11.1": "Instalar sanitas",
  "11.2": "Instalar lavatórios",
  "11.3": "Instalar chuveiros",
  "11.4": "Instalar lava-louças",
  "11.5": "Instalar tanques de lavandaria",
  "11.6": "Instalar a rede de água fria",
  "11.7": "Instalar o reservatório de água",
  "12.1": "Instalar a fossa séptica",
  "12.2": "Executar o sistema de infiltração",
  "13.1": "Montar e ensaiar o quadro eléctrico",
  "13.2": "Executar pontos de iluminação",
  "13.3": "Executar pontos de tomada",
  "13.4": "Executar e ensaiar a rede de terra",
  "15.1": "Montar portas interiores",
  "15.2": "Montar portas exteriores",
  "15.3": "Montar janelas e caixilharias",
  "15.4": "Executar vergas e peitoris",
};

export function executionActivityName(source: { code: string | null; name: string }): string {
  if (source.code && STANDARD_ACTIVITY_NAMES[source.code]) return STANDARD_ACTIVITY_NAMES[source.code];

  // Mapas importados podem usar qualquer codificação. A biblioteca executiva serve aqui como
  // vocabulário de acções, sem inventar trabalho fora do âmbito medido nem depender do número do
  // capítulo. Conservamos a especificação original no BOQ e produzimos um nome curto para o Gantt.
  const original = source.name.replace(/\s+/g, " ").trim();
  const compact = original
    .split(/\s+[—–-]\s+|;|\s+incluindo\s+|\s+conforme\s+(?:o\s+)?projecto/i)[0]
    .trim()
    .slice(0, 110);
  if (!compact) return original;
  if (/^(executar|instalar|montar|aplicar|preparar|marcar|implantar|betonar|armar|cofrar|descofrar|assentar|elevar|pintar|testar|ensaiar|inspeccionar|verificar|ligar|fornecer|mobilizar|desmobilizar|limpar|escavar|compactar|impermeabilizar|regularizar)\b/i.test(compact)) {
    return compact;
  }

  const value = compact.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const verb = /ensaio|teste|comissionamento|verificacao|inspeccao/.test(value) ? "Executar"
    : /armadura|aco|ferro|vergalhao/.test(value) ? "Cortar, dobrar e montar"
      : /cofragem|escoramento/.test(value) ? "Montar e desmontar"
        : /betao|betonagem/.test(value) ? "Executar"
          : /alvenaria|parede|bloco/.test(value) ? "Executar"
            : /tubo|tubagem|rede|cabo|quadro|louca|sanita|janela|porta|caixilharia|equipamento/.test(value) ? "Instalar"
              : /pintura|tinta|primario|impermeabiliza/.test(value) ? "Aplicar"
                : /escavacao|aterro|terraplenagem|drenagem|pavimento|revestimento|reboco|betonilha|cobertura/.test(value) ? "Executar"
                  : "Executar";
  return `${verb} ${compact.charAt(0).toLocaleLowerCase("pt")}${compact.slice(1)}`;
}
