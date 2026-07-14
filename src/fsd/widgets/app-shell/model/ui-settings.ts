export type UiTheme = "blue" | "green" | "violet" | "red";
export type UiMode = "light" | "dark";
export type UiDensity = "comfortable" | "compact";

export type UiSettings = {
  theme: UiTheme;
  mode: UiMode;
  density: UiDensity;
  confirmBeforeSubmit: boolean;
  focusProductSearch: boolean;
  stickySummary: boolean;
  accentColor: string;
  sidebarColor: string;
};

export const defaultUiSettings: UiSettings = {
  theme: "blue",
  mode: "light",
  density: "comfortable",
  confirmBeforeSubmit: true,
  focusProductSearch: true,
  stickySummary: true,
  accentColor: "#3038a4",
  sidebarColor: "#15182b",
};

export const themeAccents: Record<UiTheme, string> = {
  blue: "#3038a4",
  green: "#0f9f6e",
  violet: "#7c3aed",
  red: "#e11d48",
};

const themes: UiTheme[] = ["blue", "green", "violet", "red"];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function normalizeHexColor(value: unknown) {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : "";
}

function isTooDarkSidebar(color: string) {
  const hex = normalizeHexColor(color);
  if (!hex) return false;
  const red = Number.parseInt(hex.slice(1, 3), 16);
  const green = Number.parseInt(hex.slice(3, 5), 16);
  const blue = Number.parseInt(hex.slice(5, 7), 16);
  return red + green + blue < 120;
}

export function normalizeUiSettings(value: unknown): UiSettings {
  const input = asRecord(value);
  const theme = themes.includes(input.theme as UiTheme) ? (input.theme as UiTheme) : defaultUiSettings.theme;
  const mode: UiMode = input.mode === "dark" ? "dark" : "light";
  const density: UiDensity = input.density === "compact" ? "compact" : "comfortable";
  const accentColor = normalizeHexColor(input.accentColor) || themeAccents[theme];
  const rawSidebarColor = normalizeHexColor(input.sidebarColor);
  const sidebarColor = rawSidebarColor && !isTooDarkSidebar(rawSidebarColor) ? rawSidebarColor : defaultUiSettings.sidebarColor;

  return {
    ...defaultUiSettings,
    theme,
    mode,
    density,
    accentColor,
    sidebarColor,
    confirmBeforeSubmit:
      typeof input.confirmBeforeSubmit === "boolean"
        ? input.confirmBeforeSubmit
        : defaultUiSettings.confirmBeforeSubmit,
    focusProductSearch:
      typeof input.focusProductSearch === "boolean" ? input.focusProductSearch : defaultUiSettings.focusProductSearch,
    stickySummary: typeof input.stickySummary === "boolean" ? input.stickySummary : defaultUiSettings.stickySummary,
  };
}

export function readLocalUiSettings() {
  if (typeof window === "undefined") return defaultUiSettings;

  try {
    const raw = window.localStorage.getItem("mysrsUiSettings");
    return raw ? normalizeUiSettings(JSON.parse(raw)) : defaultUiSettings;
  } catch {
    return defaultUiSettings;
  }
}

export function writeLocalUiSettings(settings: UiSettings) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem("mysrsUiSettings", JSON.stringify(normalizeUiSettings(settings)));
}
