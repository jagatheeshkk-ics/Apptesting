import { DetectedModule, GeneratedTestCase } from "../../types.js";

export function generateAccessibilityTests(modules: DetectedModule[]): GeneratedTestCase[] {
  const pages = modules.filter((m) => m.type === "page");
  return pages.map((page) => ({
    category: "accessibility" as const,
    name: `Accessibility: ${page.name}`,
    description: `Check ${page.url} for common accessibility and usability issues (missing alt text, unlabeled controls, missing document language/title).`,
    moduleName: page.name,
    expectation: "Images have alt text, form controls are labeled, the document declares a language and a title.",
    testType: "positive" as const,
  }));
}
