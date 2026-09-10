import { DetectedModule, GeneratedTestCase, ViewportPreset } from "../../types.js";

export const VIEWPORT_PRESETS: ViewportPreset[] = [
  { name: "mobile", width: 375, height: 667 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

export function generateCompatibilityTests(modules: DetectedModule[]): GeneratedTestCase[] {
  const pages = modules.filter((m) => m.type === "page");
  const cases: GeneratedTestCase[] = [];

  for (const page of pages) {
    for (const vp of VIEWPORT_PRESETS) {
      cases.push({
        category: "compatibility",
        name: `Compatibility: ${page.name} @ ${vp.name} (${vp.width}x${vp.height})`,
        description: `Render ${page.url} at the ${vp.name} viewport and check for layout/console issues.`,
        moduleName: page.name,
        input: { width: String(vp.width), height: String(vp.height) },
        expectation: "No horizontal overflow beyond the viewport width and no console errors at this size.",
        testType: "positive",
      });
    }
  }

  return cases;
}
