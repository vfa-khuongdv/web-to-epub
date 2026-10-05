import { ArrowLeft, ArrowRight, Braces, LayoutTemplate, Minus, PanelBottom, PanelLeft, Search, Square, X } from "lucide-react";
import { useLang } from "../../i18n";

const MENUS = ["File", "Edit", "Selection", "View", "Go", "Run", "Terminal", "Help"];
// Menus that open a real drop-down (the app's actions, the looks); the rest open the palette.
export type TitleMenu = "File" | "View" | "Layout";
const REAL_MENUS: string[] = ["File", "View"];

const BUTTON =
  "grid h-[22px] w-[26px] place-items-center rounded-[4px] text-code-fg hover:bg-code-hover outline-none focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-code-focus";

/**
 * The window's title bar: the menu, the command centre in the middle (opens the
 * palette), layout toggles and window buttons. File and View open a real drop-down (the
 * normal view, the looks, settings, hide — no shortcut needed), as does the layout button
 * on the right; the other menus open the palette. Window buttons are drawn, not working.
 * Without handlers (the decoy) nothing in it acts.
 */
export function TitleBar({
  onPalette,
  onMenu,
  onToggleSidebar,
  onTogglePanel,
  sidebarOpen = true,
  panelOpen = false,
}: {
  onPalette?: () => void;
  onMenu?: (menu: TitleMenu, element: HTMLElement) => void;
  onToggleSidebar?: () => void;
  onTogglePanel?: () => void;
  sidebarOpen?: boolean;
  panelOpen?: boolean;
}) {
  const { t } = useLang();
  return (
    <div className="flex h-[30px] flex-none select-none items-center bg-code-title text-[13px] text-code-fg">
      <div className="flex min-w-0 flex-1 items-center">
        <span className="grid w-[35px] flex-none place-items-center text-code-status" aria-hidden="true">
          <Braces size={16} strokeWidth={2.25} />
        </span>
        <div className="flex min-w-0 items-center overflow-hidden">
          {MENUS.map((menu) =>
            onMenu && REAL_MENUS.includes(menu) ? (
              <button
                key={menu}
                type="button"
                aria-haspopup="menu"
                className="rounded-[4px] px-[7px] py-[2px] outline-none hover:bg-code-hover focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-code-focus"
                onClick={(event) => onMenu(menu as TitleMenu, event.currentTarget)}
              >
                {menu}
              </button>
            ) : (
              <span
                key={menu}
                aria-hidden="true"
                className="rounded-[4px] px-[7px] py-[2px] hover:bg-code-hover"
                onClick={onPalette}
              >
                {menu}
              </span>
            )
          )}
        </div>
      </div>
      <div className="flex w-[min(600px,44vw)] flex-none items-center gap-1.5">
        <span className="flex text-code-dim" aria-hidden="true">
          <span className="grid h-[22px] w-[22px] place-items-center">
            <ArrowLeft size={15} />
          </span>
          <span className="grid h-[22px] w-[22px] place-items-center opacity-50">
            <ArrowRight size={15} />
          </span>
        </span>
        <button
          type="button"
          className="flex h-[22px] min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[6px] border border-code-border bg-code-side px-2 text-[12px] text-code-fg outline-none hover:bg-code-hover focus-visible:border-code-focus"
          aria-label={t("Show and run commands")}
          onClick={onPalette}
          tabIndex={onPalette ? 0 : -1}
        >
          <Search size={13} aria-hidden="true" className="flex-none" />
          <span className="truncate">workspace</span>
        </button>
      </div>
      <div className="flex min-w-0 flex-1 items-center justify-end">
        <div className="mr-2 flex items-center gap-0.5">
          <button
            type="button"
            className={BUTTON}
            aria-label={t("Toggle sidebar")}
            aria-pressed={sidebarOpen}
            onClick={onToggleSidebar}
            tabIndex={onToggleSidebar ? 0 : -1}
          >
            <PanelLeft size={15} aria-hidden="true" className={sidebarOpen ? "" : "opacity-60"} />
          </button>
          <button
            type="button"
            className={BUTTON}
            aria-label={t("Toggle panel")}
            aria-pressed={panelOpen}
            onClick={onTogglePanel}
            tabIndex={onTogglePanel ? 0 : -1}
          >
            <PanelBottom size={15} aria-hidden="true" className={panelOpen ? "" : "opacity-60"} />
          </button>
          {/* "Customize Layout" in the real editor: here, the looks. */}
          <button
            type="button"
            className={BUTTON}
            aria-label={t("Change look")}
            title={t("Change look")}
            aria-haspopup="menu"
            onClick={(event) => onMenu?.("Layout", event.currentTarget)}
            tabIndex={onMenu ? 0 : -1}
          >
            <LayoutTemplate size={15} aria-hidden="true" />
          </button>
        </div>
        <div className="flex h-[30px] items-stretch" aria-hidden="true">
          <span className="grid w-[46px] place-items-center">
            <Minus size={15} strokeWidth={1.25} />
          </span>
          <span className="grid w-[46px] place-items-center">
            <Square size={12} strokeWidth={1.25} />
          </span>
          <span className="grid w-[46px] place-items-center">
            <X size={16} strokeWidth={1.25} />
          </span>
        </div>
      </div>
    </div>
  );
}
