import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import {
  X,
  ArrowUpRight,
  CircleAlert,
  FileText,
  FlaskConical,
} from "lucide-react";

export const cn = (...values: ClassValue[]) => twMerge(clsx(values));
const buttonVariants = cva("ui-button", {
  variants: {
    variant: {
      primary: "button-primary",
      secondary: "button-secondary",
      ghost: "button-ghost",
      danger: "button-danger",
    },
    size: { default: "", sm: "button-small", icon: "button-icon" },
  },
  defaultVariants: { variant: "primary", size: "default" },
});
export function Button({
  className,
  variant,
  size,
  asChild,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "blue" | "green" | "amber" | "red";
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
export function DemoNotice({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`demo-notice ${compact ? "compact" : ""}`}>
      <FlaskConical size={15} />
      <span>
        <strong>演示数据</strong>
        {!compact && " · 未执行后端或模型调用"}
      </span>
    </div>
  );
}
export function SectionHeading({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
export function EmptyState({
  title,
  detail,
  action,
  error = false,
}: {
  title: string;
  detail: string;
  action?: ReactNode;
  error?: boolean;
}) {
  const Icon = error ? CircleAlert : FileText;
  return (
    <div
      className={`empty-state ${error ? "error-state" : ""}`}
      role={error ? "alert" : undefined}
    >
      <span className="empty-icon">
        <Icon size={24} />
      </span>
      <h3>{title}</h3>
      <p>{detail}</p>
      {action}
    </div>
  );
}
export function TextLink({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="text-link" onClick={onClick}>
      {children}
      <ArrowUpRight size={14} />
    </button>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const el = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    el?.showModal();
    return () => {
      el?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      className={`ui-dialog ${wide ? "dialog-wide" : ""}`}
      ref={ref}
      aria-labelledby={id}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog-heading">
        <h2 id={id}>{title}</h2>
        <Button variant="ghost" size="icon" aria-label="关闭" onClick={onClose}>
          <X size={19} />
        </Button>
      </div>
      <div className="dialog-content">{children}</div>
    </dialog>
  );
}
export function DataTable({
  columns,
  rows,
  mobileHiddenColumns = [],
}: {
  columns: string[];
  rows: ReactNode[][];
  mobileHiddenColumns?: number[];
}) {
  return (
    <div className="table-scroll">
      <table
        className={cn(
          "data-table",
          mobileHiddenColumns.length > 0 && "responsive-table",
        )}
      >
        <thead>
          <tr>
            {columns.map((c, index) => (
              <th
                key={c}
                scope="col"
                className={
                  mobileHiddenColumns.includes(index)
                    ? "mobile-hidden-column"
                    : undefined
                }
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td
                  key={j}
                  className={
                    mobileHiddenColumns.includes(j)
                      ? "mobile-hidden-column"
                      : undefined
                  }
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function StatePanel({
  state,
  children,
  onRetry,
  errorTitle = "暂时无法加载内容",
  emptyTitle = "暂无内容",
  detail = "请稍后重试。",
}: {
  state: "loading" | "error" | "empty" | "ready";
  children: ReactNode;
  onRetry?: () => void;
  errorTitle?: string;
  emptyTitle?: string;
  detail?: string;
}) {
  if (state === "loading")
    return (
      <div aria-busy="true">
        <EmptyState title="正在读取内容" detail="正在获取当前数据，请稍候。" />
      </div>
    );
  if (state === "error")
    return (
      <EmptyState
        error
        title={errorTitle}
        detail={detail}
        action={onRetry && <Button onClick={onRetry}>重新读取</Button>}
      />
    );
  if (state === "empty")
    return <EmptyState title={emptyTitle} detail={detail} />;
  return <>{children}</>;
}
export function TabBar({
  id,
  value,
  items,
  onChange,
  label,
}: {
  id: string;
  value: string;
  items: { id: string; label: string }[];
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <div
      className="tabs"
      role="tablist"
      aria-label={label}
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();
        const focusedId = (event.target as HTMLElement).closest(
          '[role="tab"]',
        )?.id;
        const focusedIndex = items.findIndex(
          (item) => `${id}-tab-${item.id}` === focusedId,
        );
        const current =
          focusedIndex >= 0
            ? focusedIndex
            : items.findIndex((item) => item.id === value);
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : (current +
                  (event.key === "ArrowRight" ? 1 : -1) +
                  items.length) %
                items.length;
        onChange(items[next].id);
        requestAnimationFrame(() =>
          document.getElementById(`${id}-tab-${items[next].id}`)?.focus(),
        );
      }}
    >
      {items.map((item) => (
        <button
          key={item.id}
          id={`${id}-tab-${item.id}`}
          role="tab"
          aria-selected={value === item.id}
          aria-controls={`${id}-panel`}
          tabIndex={value === item.id ? 0 : -1}
          className={value === item.id ? "active" : ""}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
export function downloadPreview(filename: string, content: string) {
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/plain;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Related content and optional context, never a fixed property grid. */
export function ContentReviewList({
  items,
  contextLabel = "查看来源",
}: {
  items: { id: string; title: string; body?: string; context?: ReactNode }[];
  contextLabel?: string;
}) {
  return (
    <div className="content-review-list">
      {items.map((item) => (
        <article className="review-content-item" key={item.id}>
          <h3>{item.title}</h3>
          {item.body && <p>{item.body}</p>}
          {item.context && (
            <details className="content-context">
              <summary>{contextLabel}</summary>
              <div>{item.context}</div>
            </details>
          )}
        </article>
      ))}
    </div>
  );
}
