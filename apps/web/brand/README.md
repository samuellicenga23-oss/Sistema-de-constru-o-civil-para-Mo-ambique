# Identidade SIGO

O ficheiro `SIGO-logo-oficial-master.png` é o original aprovado da marca. Não deve ser
redesenhado, comprimido de forma destrutiva, colocado dentro de caixas ou receber fundos,
sombras e contornos.

Os ficheiros optimizados usados pela aplicação são gerados com:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/generate_sigo_brand_assets.ps1
```

Uso recomendado:

- `sigo-logo-oficial.png`: assinatura completa em áreas amplas e claras;
- `sigo-logo-compacto.png`: cabeçalhos, menu lateral e login;
- `sigo-simbolo.png`: espaços pequenos e fundos escuros;
- ícones PWA/favicon: símbolo com zona de segurança, sempre transparente.

O espaço livre à volta da marca deve ser, no mínimo, equivalente a metade da altura do
símbolo. A assinatura completa não deve ser usada abaixo de 180 px de largura; nesses casos,
usar a versão compacta ou apenas o símbolo.
