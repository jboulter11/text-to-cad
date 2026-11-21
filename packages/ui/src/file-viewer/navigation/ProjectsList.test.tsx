import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectsList } from "../../../dist/file-viewer/navigation/ProjectsList.js";

afterEach(() => { cleanup(); vi.useRealTimers(); });

it("discovers and removes working files while open, alongside registered models and saved versions", async () => {
  vi.useFakeTimers();
  const prefix = "/models/widget/";
  const file = (name: string) => ({ path: prefix + name, name, kind: "file" as const });
  let files = [file("housing.step"), file("housing.gcode.3mf")];
  const list = vi.fn(async (path: string, options: { projects?: boolean }) => {
    if (path === "/models" && options.projects) return files;
    if (path === "/prints") return [{ name: "widget", path: "/prints/widget", kind: "directory" as const }];
    return [{ name: "widget_v1.stl", path: "/prints/widget/widget_v1.stl", kind: "file" as const }];
  });
  const recent = { list: async () => [{ name: "Editable housing", path: "model-id", kind: "model", script: prefix + "model.py" }] };
  const onOpen = vi.fn();
  await act(async () => { render(<ProjectsList root="/models" list={list} recent={recent} onOpen={onOpen}
    activePath={prefix + "housing.step"} expanded={new Set(["widget", "widget/working", "widget/v1"])} onExpandedChange={() => {}} />); });
  expect(document.querySelectorAll("[data-project-row]")).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Editable housing" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "widget_v1.stl" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "housing.gcode.3mf" }));
  expect(onOpen).toHaveBeenCalledWith(prefix + "housing.step", prefix + "housing.gcode.3mf", true);
  files = [file("sketch.dxf")];
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(screen.queryByText("housing.step")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "sketch.dxf" }));
  expect(onOpen).toHaveBeenCalledWith(prefix + "sketch.dxf", undefined);
});
