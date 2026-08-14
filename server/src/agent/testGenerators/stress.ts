import { DetectedModule, GeneratedTestCase } from "../../types.js";

export const STRESS_CONCURRENCY = 15;

export function generateStressTests(modules: DetectedModule[]): GeneratedTestCase[] {
  const cases: GeneratedTestCase[] = [];

  const pages = modules.filter((m) => m.type === "page");
  for (const page of pages) {
    cases.push({
      category: "stress",
      name: `Concurrent load: ${page.name}`,
      description: `Fire ${STRESS_CONCURRENCY} concurrent requests at ${page.url} and measure error rate and latency under load.`,
      moduleName: page.name,
      expectation: "Error rate should stay low (<10%) and the server should not return 5xx errors under this load.",
      testType: "positive",
    });
  }

  const forms = modules.filter((m) => m.type === "form");
  for (const form of forms) {
    cases.push({
      category: "stress",
      name: `Repeated submission load: ${form.name}`,
      description: `Submit the form at ${form.url} ${STRESS_CONCURRENCY} times concurrently with valid data and measure error rate and latency.`,
      moduleName: form.name,
      expectation:
        "Error rate should stay low (<10%); repeated concurrent submissions should be handled consistently (accepted, rate-limited, or deduplicated) without server errors.",
      testType: "positive",
    });
  }

  return cases;
}
