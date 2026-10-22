import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { NavLink, Link, useLocation } from "react-router-dom";
import { Menu, ChevronRight, type LucideIcon } from "lucide-react";
import { Button, Modal } from "@personal/ui-core";

export interface NavigationItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  count?: string;
}
export interface ShellConfig {
  name: string;
  subtitle: string;
  mark: string;
  home: string;
  contextLabel: string;
  pageLabel?: string;
  navigation: NavigationItem[];
  productNavigation?: NavigationItem[];
  navigationMode?: "sidebar" | "top";
  workspaceLabel?: string;
  environment?: string;
  backLink?: { to: string; label: string };
  theme?: { accent: string; accentSoft: string; sidebar: string };
  footer?: { title: string; detail: string; href: string };
}
export interface AppModule {
  id: string;
  path: string;
  label: string;
  element: ReactNode;
}

/** Owns navigation presentation only. Applications own routes and workspace content. */
export function AppShell({
  config,
  children,
  actions,
}: {
  config: ShellConfig;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const top = config.navigationMode === "top";
  useEffect(() => {
    window.scrollTo(0, 0);
    setOpen(false);
  }, [location.pathname, location.search]);
  const current = [
    ...config.navigation,
    ...(config.productNavigation || []),
  ].find((n) =>
    n.end
      ? location.pathname === n.to.split("?")[0]
      : location.pathname.startsWith(n.to.split("?")[0]),
  );
  const theme = config.theme
    ? ({
        "--accent": config.theme.accent,
        "--accent-soft": config.theme.accentSoft,
        "--sidebar": config.theme.sidebar,
      } as CSSProperties)
    : undefined;
  const renderNav = (items: NavigationItem[]) =>
    items.map(({ icon: Icon, ...item }) => (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.end}
        onClick={() => setOpen(false)}
        className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
      >
        <Icon size={17} strokeWidth={1.7} />
        <span>{item.label}</span>
        {item.count && <small>{item.count}</small>}
      </NavLink>
    ));
  const brand = (
    <Link to={config.home} className="wordmark">
      <span className="brand-mark">{config.mark}</span>
      <span>
        <strong>{config.name}</strong>
        <small>{config.subtitle}</small>
      </span>
    </Link>
  );
  const menu = (
    <>
      <div className="nav-label">
        {config.workspaceLabel || config.contextLabel}
      </div>
      <nav aria-label="工作导航">{renderNav(config.navigation)}</nav>
      {!!config.productNavigation?.length && (
        <>
          <div className="nav-label product-label">应用视图</div>
          <nav aria-label="产品导航">{renderNav(config.productNavigation)}</nav>
        </>
      )}
    </>
  );
  return (
    <div
      className={`app-shell ${top ? "shell-top" : "shell-sidebar"}`}
      style={theme}
    >
      <a className="skip-link" href="#main">
        跳至主要内容
      </a>
      {!top && (
        <aside className="sidebar" aria-label="应用导航">
          {brand}
          {menu}
          <div className="sidebar-bottom">
            {config.footer && (
              <Link to={config.footer.href} className="sidebar-note">
                <strong>{config.footer.title}</strong>
                <span>{config.footer.detail}</span>
              </Link>
            )}
            <div className="profile">
              <span className="profile-avatar">我</span>
              <span>
                本机工作区<small>{config.environment || "本机应用"}</small>
              </span>
            </div>
          </div>
        </aside>
      )}
      <div className="shell-body">
        {top ? (
          <header className="product-header">
            <div className="product-header-main">
              {brand}
              <div className="product-header-actions">
                <span className="environment">
                  {config.environment || "本机应用"}
                </span>
                {config.backLink && (
                  <Link className="return-link" to={config.backLink.to}>
                    {config.backLink.label}
                  </Link>
                )}
                {actions}
              </div>
            </div>
            <nav className="product-module-nav" aria-label="业务模块">
              {renderNav(config.navigation)}
            </nav>
          </header>
        ) : (
          <header className="topbar">
            <div className="breadcrumb">
              <Button
                className="mobile-menu"
                variant="ghost"
                onClick={() => setOpen(true)}
                aria-label="打开导航"
              >
                <Menu size={18} />
                <span>导航</span>
              </Button>
              <span>{config.contextLabel}</span>
              <ChevronRight size={13} />
              <strong>{config.pageLabel || current?.label || "工作区"}</strong>
            </div>
            <div className="topbar-actions">
              <span className="environment">
                {config.environment || "本机应用"}
              </span>
              {actions}
            </div>
          </header>
        )}
        <main id="main" tabIndex={-1}>
          {children}
        </main>
        <footer className="app-footer">
          <span>{config.name}</span>
          <span>{config.environment || "本机应用"}</span>
        </footer>
      </div>
      {open && (
        <Modal title={config.name} onClose={() => setOpen(false)}>
          {menu}
        </Modal>
      )}
    </div>
  );
}

/** A product may replace the entire children workspace without adopting a dashboard. */
export function BusinessShell(props: {
  config: ShellConfig;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <AppShell {...props} config={{ ...props.config, navigationMode: "top" }} />
  );
}
