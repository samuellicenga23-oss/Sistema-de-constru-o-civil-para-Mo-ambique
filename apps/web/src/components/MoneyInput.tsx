import { useEffect, useState, type InputHTMLAttributes } from "react";
import { formatMoneyAmount, parseMoneyAmount } from "../lib/moneyFormat";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
  /** Valor técnico em string (ex.: "6842150.46") ou número. */
  value: string | number;
  /** Devolve sempre string com ponto decimal (pronta para Number(...) / API). */
  onValueChange: (value: string) => void;
  fractionDigits?: number;
};

/**
 * Campo de dinheiro: mostra 6 842 150,46 ao sair do foco;
 * ao editar aceita vírgula ou ponto e não fecha modais ao seleccionar texto.
 */
export default function MoneyInput({
  value,
  onValueChange,
  fractionDigits = 2,
  className = "input",
  onFocus,
  onBlur,
  ...rest
}: Props) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState("");

  const numeric = typeof value === "number" ? value : value.trim() === "" ? null : Number(value);
  const display = focused
    ? draft
    : numeric != null && Number.isFinite(numeric)
      ? formatMoneyAmount(numeric, fractionDigits)
      : "";

  useEffect(() => {
    if (focused) return;
    if (numeric != null && Number.isFinite(numeric)) {
      setDraft(formatMoneyAmount(numeric, fractionDigits));
    } else {
      setDraft("");
    }
  }, [focused, numeric, fractionDigits]);

  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      className={`${className} tabular-nums`}
      value={display}
      onFocus={(event) => {
        setFocused(true);
        const next = numeric != null && Number.isFinite(numeric)
          ? formatMoneyAmount(numeric, fractionDigits)
          : "";
        setDraft(next);
        // Facilita substituir o valor completo ao começar a escrever/seleccionar.
        requestAnimationFrame(() => event.target.select());
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        const parsed = parseMoneyAmount(draft);
        if (parsed == null) {
          onValueChange("");
          setDraft("");
        } else {
          const fixed = parsed.toFixed(fractionDigits);
          onValueChange(fixed);
          setDraft(formatMoneyAmount(parsed, fractionDigits));
        }
        onBlur?.(event);
      }}
      onChange={(event) => {
        const next = event.target.value;
        setDraft(next);
        const parsed = parseMoneyAmount(next);
        if (parsed == null) {
          if (!next.trim()) onValueChange("");
          return;
        }
        onValueChange(String(parsed));
      }}
    />
  );
}
