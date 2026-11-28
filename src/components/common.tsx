import {
  useEffect,
  useMemo,
  useRef,
  useId,
  cloneElement,
  type ReactElement,
  type ReactNode,
  type FormEvent,
} from "react";
import { createPortal } from "react-dom";
import { keys, labels } from "../domain/model";
import { type NutrientStrings } from "./form-values";
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const fieldId = useId();
  return (
    <div className="field">
      <label htmlFor={fieldId}>{label}</label>
      {cloneElement(children as ReactElement<{ id?: string }>, { id: fieldId })}
      {hint && <small>{hint}</small>}
    </div>
  );
}
export function Decimal({
  id,
  value,
  onChange,
  required = false,
  placeholder = "Esim. 12,5",
  autoFocus = false,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <input
      id={id}
      inputMode="decimal"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      required={required}
      placeholder={placeholder}
      autoComplete="off"
      autoFocus={autoFocus}
    />
  );
}
export function NutrientFields({
  value,
  onChange,
}: {
  value: NutrientStrings;
  onChange: (v: NutrientStrings) => void;
}) {
  return (
    <div className="fields">
      {keys.map((k) => (
        <Field
          key={k}
          label={`${labels[k]} (${k === "energy" ? "kcal" : "g"})`}
        >
          <Decimal
            value={value[k]}
            onChange={(v) => onChange({ ...value, [k]: v })}
            placeholder="Ei tiedossa"
          />
        </Field>
      ))}
    </div>
  );
}
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const modalRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    modalRef.current?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const topModal = Array.from(
        document.querySelectorAll<HTMLElement>(".modal"),
      ).at(-1);
      if (topModal !== modalRef.current) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      if (e.key === "Tab" && topModal) {
        const focusable = Array.from(
          topModal.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]',
          ),
        ).filter((el) => el.getClientRects().length > 0);
        const first = focusable[0],
          last = focusable.at(-1);
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === topModal)
        ) {
          e.preventDefault();
          last?.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last ||
            document.activeElement === topModal)
        ) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  // Bodyn lapsena: sivun rungon välit ja pinot eivät koske ikkunaa.
  return createPortal(
    <div className="modal-backdrop">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={modalRef}
      >
        <header>
          <h2>{title}</h2>
          <button className="btn--quiet" onClick={onClose}>
            Sulje
          </button>
        </header>
        {children}
      </section>
    </div>,
    document.body,
  );
}
export function Form({
  children,
  error,
  onSubmit,
  busy = false,
  submit = "Tallenna",
}: {
  children: ReactNode;
  error?: string;
  onSubmit: (e: FormEvent) => void;
  busy?: boolean;
  submit?: string;
}) {
  return (
    <form onSubmit={onSubmit}>
      {children}
      {error && (
        <p className="note note--stop" role="alert">
          {error}
        </p>
      )}
      <div className="actions form-actions">
        <button className="btn btn--primary" type="submit" disabled={busy}>
          {busy ? "Tallennetaan…" : submit}
        </button>
      </div>
    </form>
  );
}
export function BlobImage({
  blob,
  alt,
  className,
}: {
  blob: Blob;
  alt: string;
  className?: string;
}) {
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <img src={url} alt={alt} className={className} />;
}
