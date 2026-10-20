// Turns loose input (a form, a CSV row, a JSON object) into clean card options.

const YES = /^(1|yes|y|true|on)$/i;

export const DEFAULTS = {
  label: "FIRSTBYTE DASHBOARD",
  title: "Title",
  subtitle: "",
  chomp: false,
  theme: "dark",
  duration: 4.5,
};

export function normalizeCard(raw = {}) {
  const text = (v, fallback) => (v === undefined || v === null ? fallback : String(v).trim());
  const duration = Number(raw.duration);
  return {
    label: text(raw.label, DEFAULTS.label),
    title: text(raw.title, DEFAULTS.title) || DEFAULTS.title,
    subtitle: text(raw.subtitle, DEFAULTS.subtitle),
    chomp: typeof raw.chomp === "boolean" ? raw.chomp : YES.test(String(raw.chomp ?? "").trim()),
    theme: String(raw.theme ?? "").trim().toLowerCase() === "light" ? "light" : "dark",
    duration: Number.isFinite(duration) && duration > 0 ? Math.min(Math.max(duration, 2.5), 20) : DEFAULTS.duration,
  };
}

// The query string that card/card.html reads.
export function cardQuery(card) {
  return new URLSearchParams({
    label: card.label,
    title: card.title,
    subtitle: card.subtitle,
    chomp: card.chomp ? "yes" : "no",
    theme: card.theme,
    duration: String(card.duration),
  }).toString();
}

// "Members & Teams" -> "members-teams"
export function slugify(s) {
  return (
    String(s)
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "card"
  );
}
