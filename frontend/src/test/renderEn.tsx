import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { LangProvider } from "../i18n";

// Component tests assert the English source strings: the provider reads the language from
// localStorage when it mounts, so set it first and wrap the tree.
export function renderEn(ui: ReactElement) {
  localStorage.setItem("lang", "en");
  const wrap = (node: ReactElement) => <LangProvider>{node}</LangProvider>;
  const result = render(wrap(ui));
  return { ...result, rerender: (next: ReactElement) => result.rerender(wrap(next)) };
}
