import { useI18n } from "@cad/ui/i18n";

export function ExplorerSort({ value, onChange }) {
  const { t } = useI18n();
  return <label className="flex shrink-0 items-center gap-2 px-2 pt-1 text-xs text-muted-foreground">
    {t("explorer.sort")}
    <select className="min-w-0 flex-1 rounded border border-border bg-sidebar px-1 py-0.5 text-foreground"
      value={value} onChange={event => onChange(event.target.value)}>
      <option value="modified">{t("explorer.sortModified")}</option>
      <option value="oldest">{t("explorer.sortOldest")}</option>
      <option value="name">{t("explorer.sortName")}</option>
    </select>
  </label>;
}

export function compareExplorerRows(sort, locale) {
  const byName = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  return (a, b) => {
    const directories = Number(b.kind === "directory") - Number(a.kind === "directory");
    if (directories) return directories;
    if (sort !== "name") {
      const aKnown = Number.isFinite(a.modified), bKnown = Number.isFinite(b.modified);
      if (aKnown !== bKnown) return Number(bKnown) - Number(aKnown);
      if (aKnown && a.modified !== b.modified) return sort === "oldest" ? a.modified - b.modified : b.modified - a.modified;
    }
    return byName.compare(a.name, b.name);
  };
}
