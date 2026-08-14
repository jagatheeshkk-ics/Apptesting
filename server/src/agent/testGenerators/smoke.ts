import { DetectedModule, GeneratedTestCase } from "../../types.js";

export function generateSmokeTests(modules: DetectedModule[]): GeneratedTestCase[] {
  const cases: GeneratedTestCase[] = [];
  const pages = modules.filter((m) => m.type === "page");

  for (const page of pages) {
    cases.push({
      category: "smoke",
      name: `Page loads: ${page.name}`,
      description: `Navigate to ${page.url} and verify it returns a successful response with no console errors.`,
      moduleName: page.name,
      expectation: "HTTP 2xx/3xx status, no uncaught console errors, page renders visible content.",
      testType: "positive",
    });
  }

  const forms = modules.filter((m) => m.type === "form");
  for (const form of forms) {
    cases.push({
      category: "smoke",
      name: `Form renders: ${form.name}`,
      description: `Verify all ${form.fields.length} field(s) on the form are present and interactable.`,
      moduleName: form.name,
      expectation: "All detected fields are visible and enabled.",
      testType: "positive",
    });
  }

  return cases;
}
