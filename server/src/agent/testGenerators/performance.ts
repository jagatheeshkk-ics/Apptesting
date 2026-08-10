import { DetectedModule, GeneratedTestCase } from "../../types.js";

export function generatePerformanceTests(modules: DetectedModule[]): GeneratedTestCase[] {
  const pages = modules.filter((m) => m.type === "page");
  return pages.map((page) => ({
    category: "performance" as const,
    name: `Performance: ${page.name}`,
    description: `Measure navigation timing and page weight for ${page.url}.`,
    moduleName: page.name,
    expectation: "DOMContentLoaded under 3s, load event under 5s, and a reasonable number/size of downloaded resources.",
  }));
}
