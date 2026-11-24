import { useEffect, useState } from "react";
import { ChevronRight, Folder } from "lucide-react";
import { TreeFilterInput } from "@cad/ui/primitives/tree-filter";
import { useI18n } from "@cad/ui/i18n";
import { compareExplorerRows, ExplorerSort } from "./ExplorerSort.jsx";
import type { FileEntry, FileSource, RecentDocument } from "../types.js";

type Listing = NonNullable<FileSource["list"]>;
type Expansion = { expanded: ReadonlySet<string>; onExpandedChange(key: string, open: boolean): void };
type Open = (model: string, toolpath?: string, showToolpath?: boolean) => void;
type Project = { name: string; modified?: number; printed?: FileEntry; files: FileEntry[]; models: RecentDocument[] };
const legacyVersion = (name: string) => name.match(/_v(\d+)(?=[_.-])/i)?.[1];
const isSlice = (name: string) => /\.gcode(?:\.3mf)?$/i.test(name);
const isModel = (name: string) => !isSlice(name) && /\.(?:3mf|stl|step|stp|xbf|glb|obj)$/i.test(name);
const groupStyle = "[details[open]>&>svg:first-child]:rotate-90 flex w-full cursor-pointer list-none items-center gap-1.5 rounded-sm px-2 py-1 text-left text-xs hover:bg-sidebar-accent [&::-webkit-details-marker]:hidden";
const entryStyle = "flex w-full items-center truncate rounded-sm px-2 py-1 text-left text-xs hover:bg-sidebar-accent aria-[current=true]:bg-accent aria-[current=true]:text-accent-foreground";

function useEntries(list: Listing, path?: string, projects = false) {
  const [state, setState] = useState<{ path: string; entries?: readonly FileEntry[] }>({ path: "" });
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    let pending = false;
    const read = async () => {
      if (pending || controller.signal.aborted || (projects && document.hidden)) return;
      pending = true;
      try {
        const entries = await list(path, { signal: controller.signal, ...(projects ? { projects: true } : { toolpaths: true }) });
        if (!controller.signal.aborted) setState({ path, entries });
      } catch {
        if (!controller.signal.aborted) setState(previous => previous.path === path ? previous : { path });
      } finally {
        pending = false;
      }
    };
    void read();
    if (!projects) return () => controller.abort();
    const timer = window.setInterval(read, 5000);
    document.addEventListener("visibilitychange", read);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", read);
    };
  }, [list, path, projects]);
  return state.path === path ? state.entries ?? null : undefined;
}

function Artifacts({ entries, onOpen, activePath, registered, sort }: { registered?: readonly RecentDocument[]; sort: string; entries: readonly FileEntry[]; onOpen: Open; activePath: string }) {
  const { locale } = useI18n();
  const models = entries.filter(entry => registered ? !isSlice(entry.name) : isModel(entry.name));
  const slices = entries.filter(entry => isSlice(entry.name));
  const modelFor = (slice: FileEntry) => {
    const base = slice.name.replace(/\.gcode(?:\.3mf)?$/i, "").toLowerCase();
    const exact = models.find(model => base === model.name.replace(/\.[^.]+$/, "").toLowerCase());
    return exact ?? (models.length === 1 ? models[0] : undefined);
  };
  const rows = [
    ...(registered ?? []).map(model => ({ ...model, modified: model.updated, open: () => onOpen(model.path) })),
    ...models.map(model => ({ ...model, open: () => onOpen(model.path, slices.find(slice => modelFor(slice) === model)?.path) })),
    ...slices.map(slice => ({ ...slice, open: () => onOpen(modelFor(slice)?.path ?? "", slice.path, true) })),
  ];
  return rows.sort(compareExplorerRows(sort, locale)).map(row =>
    <button key={row.path} className={entryStyle} title={row.name} aria-current={row.path === activePath || undefined}
      onClick={row.open}>{row.name}</button>);
}

function Version({ sort, name, path, files, list, onOpen, open, setOpen, activePath }: {
  sort: string; name: string; path?: string; files?: FileEntry[]; list: Listing; onOpen: Open; activePath: string; open: boolean; setOpen(open: boolean): void;
}) {
  const { t } = useI18n();
  const entries = useEntries(list, open ? path : undefined);
  return <details open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className={groupStyle}><ChevronRight className="size-3 shrink-0 motion-safe:transition-transform" />{name}</summary>
    {open && <div className="pl-3">
      {files || entries ? <Artifacts sort={sort} entries={files ?? entries ?? []} onOpen={onOpen} activePath={activePath} />
        : <p className="m-2 text-xs text-muted-foreground">{t(entries === null ? "explorer.readFailed" : "explorer.loading")}</p>}
    </div>}
  </details>;
}

function ProjectRow({ project, list, onOpen, sort, expanded, onExpandedChange, activePath }: {
  project: Project; list: Listing; onOpen: Open; sort: string; activePath: string;
} & Expansion) {
  const { t, locale } = useI18n();
  const open = expanded.has(project.name);
  const entries = useEntries(list, open ? project.printed?.path : undefined);
  const releases = entries?.find(entry => entry.kind === "directory" && entry.name === "releases");
  const saved = useEntries(list, releases?.path);
  const versions = new Map<string, { path?: string; files?: FileEntry[]; modified?: number }>();
  const loose: FileEntry[] = [];
  for (const entry of saved ?? []) {
    if (entry.kind === "directory" && /^v\d+$/i.test(entry.name)) versions.set(entry.name.toLowerCase(), { path: entry.path, modified: entry.modified });
  }
  for (const entry of entries ?? []) {
    if (entry.kind !== "file") continue;
    const version = legacyVersion(entry.name);
    if (!version) { loose.push(entry); continue; }
    const key = "v" + version;
    const group = versions.get(key);
    if (group?.path) continue;
    if (group?.files) {
      group.files.push(entry);
      group.modified = Math.max(group.modified ?? 0, entry.modified ?? 0);
    } else versions.set(key, { files: [entry], modified: entry.modified });
  }
  const groups = [...versions].map(([name, version]) => ({
    name, modified: version.modified,
    node: <Version sort={sort} key={name} name={name} list={list} onOpen={onOpen} activePath={activePath} {...version}
      open={expanded.has(`${project.name}/${name}`)} setOpen={value => onExpandedChange(`${project.name}/${name}`, value)} />,
  }));
  if (project.models.length || project.files.length) {
    const working = t("explorer.working");
    groups.push({
      name: working,
      modified: Math.max(...project.models.map(model => model.updated ?? 0), ...project.files.map(file => file.modified ?? 0)),
      node: <details key="working" open={expanded.has(`${project.name}/working`)}
        onToggle={event => onExpandedChange(`${project.name}/working`, event.currentTarget.open)}>
        <summary className={groupStyle}><ChevronRight className="size-3 shrink-0 motion-safe:transition-transform" />{working}</summary>
        <div className="pl-3">
          <Artifacts sort={sort} registered={project.models} entries={project.files} onOpen={onOpen} activePath={activePath} />
        </div>
      </details>,
    });
  }
  groups.sort(compareExplorerRows(sort, locale));
  return <details open={open} onToggle={event => onExpandedChange(project.name, event.currentTarget.open)}>
    <summary className={groupStyle} data-project-row="">
      <ChevronRight className="size-3 shrink-0 motion-safe:transition-transform" /><Folder className="size-3.5 shrink-0" />
      <span className="truncate">{project.name}</span>
    </summary>
    {open && <div className="pl-3">
      {groups.map(group => group.node)}
      <Artifacts sort={sort} entries={loose} onOpen={onOpen} activePath={activePath} />
      {project.printed && !entries && <p className="m-2 text-xs text-muted-foreground">{t(entries === null ? "explorer.readFailed" : "explorer.loading")}</p>}
    </div>}
  </details>;
}

export function ProjectsList({ root, list, recent, onOpen, expanded, onExpandedChange, activePath }: {
  root: string;
  list: Listing;
  recent?: { list(): Promise<readonly RecentDocument[]> };
  onOpen: Open;
  activePath: string;
} & Expansion) {
  const { t, locale } = useI18n();
  const [sort, setSort] = useState("modified");
  const [query, setQuery] = useState("");
  const [models, setModels] = useState<readonly RecentDocument[]>([]);
  const working = useEntries(list, root, true);
  const printed = useEntries(list, "/prints");
  useEffect(() => {
    let active = true;
    void recent?.list().then(found => { if (active) setModels(found); }, () => {});
    return () => { active = false; };
  }, [recent]);
  const prefix = root.replace(/\/$/, "") + "/";
  useEffect(() => {
    if (activePath.startsWith("/prints/")) {
      const [project, folder, version] = activePath.slice("/prints/".length).split("/");
      if (!project || !folder) return;
      onExpandedChange(project, true);
      if (folder === "releases" && /^v\d+$/i.test(version ?? "")) {
        onExpandedChange(`${project}/${version.toLowerCase()}`, true);
      } else if (!version) {
        const number = legacyVersion(folder);
        if (number) onExpandedChange(`${project}/v${number}`, true);
      }
      return;
    }
    const script = models.find(model => model.path === activePath && model.kind === "model" && !model.missing)?.script;
    const location = script ?? activePath;
    if (!location.startsWith(prefix)) return;
    const relative = location.slice(prefix.length);
    if (!relative.includes("/")) return;
    const project = relative.split("/")[0];
    onExpandedChange(project, true);
    onExpandedChange(`${project}/working`, true);
  }, [activePath, models, onExpandedChange, prefix]);

  const projects = new Map<string, Project>();
  for (const entry of printed ?? []) {
    if (entry.kind === "directory") projects.set(entry.name, { name: entry.name, modified: entry.modified, printed: entry, models: [], files: [] });
  }
  for (const file of working ?? []) {
    if (file.kind !== "file" || !file.path.startsWith(prefix)) continue;
    const name = file.path.slice(prefix.length).split("/")[0];
    const project = projects.get(name) ?? { name, files: [], models: [] };
    project.files.push(file);
    project.modified = Math.max(project.modified ?? 0, file.modified ?? 0);
    projects.set(name, project);
  }
  for (const model of models) {
    if (model.kind !== "model" || model.missing || !model.script?.startsWith(prefix)) continue;
    const relative = model.script.slice(prefix.length);
    const name = relative.split("/")[0];
    if (!relative.includes("/")) continue;
    const project = projects.get(name) ?? { name, models: [], files: [] };
    project.models.push(model);
    project.modified = Math.max(project.modified ?? 0, model.updated ?? 0);
    projects.set(name, project);
  }
  const rows = [...projects.values()].filter(project => project.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort(compareExplorerRows(sort, locale));
  return <div className="flex min-h-0 flex-1 flex-col" data-project-list="">
    <ExplorerSort value={sort} onChange={setSort} />
    <TreeFilterInput label={t("explorer.filterProjects")} placeholder={t("explorer.filterProjects")} value={query}
      onChange={setQuery} onKeyDown={undefined} inputRef={undefined} trailing={undefined} clearLabel={undefined} className={undefined} />
    <div className="min-h-0 flex-1 overflow-y-auto p-1">
      {rows.map(project => <ProjectRow key={project.name} project={project} sort={sort} list={list} onOpen={onOpen}
        expanded={expanded} onExpandedChange={onExpandedChange} activePath={activePath} />)}
      {!rows.length && <p className="m-2 text-xs text-muted-foreground">{t(printed === undefined || working === undefined ? "explorer.loading" : "explorer.noMatches")}</p>}
    </div>
  </div>;
}
