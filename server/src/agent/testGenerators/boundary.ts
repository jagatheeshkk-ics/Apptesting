import { DetectedField, DetectedModule, GeneratedTestCase, TestType } from "../../types.js";

function repeat(char: string, n: number): string {
  return char.repeat(n);
}

interface BoundaryCase {
  suffix: string;
  value: string;
  expectation: string;
  testType: TestType;
}

function boundaryValuesFor(field: DetectedField): BoundaryCase[] {
  const cases: BoundaryCase[] = [];

  // Empty value
  cases.push({
    suffix: "empty value",
    value: "",
    expectation: field.required
      ? "Required field: submission should be rejected with a validation message."
      : "Optional field: submission should be accepted.",
    testType: field.required ? "negative" : "positive",
  });

  // Whitespace-only
  cases.push({
    suffix: "whitespace only",
    value: "   ",
    expectation: "Whitespace-only input should be treated as empty / rejected if required.",
    testType: "negative",
  });

  if (field.minLength !== undefined) {
    cases.push({
      suffix: `min length (${field.minLength})`,
      value: repeat("a", field.minLength),
      expectation: "Exactly at minLength: should be accepted.",
      testType: "positive",
    });
    cases.push({
      suffix: `min length - 1 (${field.minLength - 1})`,
      value: repeat("a", Math.max(0, field.minLength - 1)),
      expectation: "Below minLength: should be rejected with validation error.",
      testType: "negative",
    });
  }

  if (field.maxLength !== undefined) {
    cases.push({
      suffix: `max length (${field.maxLength})`,
      value: repeat("a", field.maxLength),
      expectation: "Exactly at maxLength: should be accepted.",
      testType: "positive",
    });
    cases.push({
      suffix: `max length + 1 (${field.maxLength + 1})`,
      value: repeat("a", field.maxLength + 1),
      expectation: "Above maxLength: should be truncated or rejected, never silently stored beyond the limit.",
      testType: "negative",
    });
  }

  // Generic overflow case even when no maxLength is declared
  cases.push({
    suffix: "very long input (10,000 chars)",
    value: repeat("a", 10000),
    expectation: "Extremely long input should not crash the page or the backend; should be rejected or gracefully truncated.",
    testType: "negative",
  });

  if (field.type === "number") {
    if (field.min !== undefined) {
      cases.push({
        suffix: `min value (${field.min})`,
        value: String(field.min),
        expectation: "At minimum: accepted.",
        testType: "positive",
      });
      cases.push({
        suffix: `below min (${field.min - 1})`,
        value: String(field.min - 1),
        expectation: "Below minimum: should be rejected.",
        testType: "negative",
      });
    }
    if (field.max !== undefined) {
      cases.push({
        suffix: `max value (${field.max})`,
        value: String(field.max),
        expectation: "At maximum: accepted.",
        testType: "positive",
      });
      cases.push({
        suffix: `above max (${field.max + 1})`,
        value: String(field.max + 1),
        expectation: "Above maximum: should be rejected.",
        testType: "negative",
      });
    }
    cases.push({
      suffix: "zero",
      value: "0",
      expectation: "Zero should be handled explicitly, not misinterpreted.",
      testType: "positive",
    });
    cases.push({
      suffix: "negative number",
      value: "-1",
      expectation: "Negative numbers should be validated per business rules.",
      testType: "negative",
    });
    cases.push({
      suffix: "non-numeric text",
      value: "abc",
      expectation: "Non-numeric text in a number field should be rejected.",
      testType: "negative",
    });
  }

  if (field.type === "email") {
    cases.push({
      suffix: "malformed email",
      value: "not-an-email",
      expectation: "Should be rejected as invalid email.",
      testType: "negative",
    });
    cases.push({
      suffix: "missing domain",
      value: "user@",
      expectation: "Should be rejected as invalid email.",
      testType: "negative",
    });
    cases.push({
      suffix: "valid edge-case email",
      value: "a@b.co",
      expectation: "Short valid email should be accepted.",
      testType: "positive",
    });
  }

  if (field.type === "date") {
    cases.push({
      suffix: "far past date",
      value: "1900-01-01",
      expectation: "Should be handled per business rules (accept or reject).",
      testType: "negative",
    });
    cases.push({
      suffix: "far future date",
      value: "2999-12-31",
      expectation: "Should be handled per business rules (accept or reject).",
      testType: "negative",
    });
    cases.push({
      suffix: "invalid date",
      value: "2024-02-30",
      expectation: "Invalid calendar date should be rejected.",
      testType: "negative",
    });
  }

  // Unicode / special characters relevant to boundary + encoding correctness
  cases.push({
    suffix: "unicode characters",
    value: "テスト😀Ω",
    expectation: "Unicode input should be stored/displayed correctly, not mangled.",
    testType: "positive",
  });
  cases.push({
    suffix: "special characters",
    value: "!@#$%^&*()_+-=[]{}|;':\",./<>?",
    expectation: "Special characters should be handled without breaking the UI or request.",
    testType: "negative",
  });

  return cases;
}

export function generateBoundaryTests(modules: DetectedModule[]): GeneratedTestCase[] {
  const cases: GeneratedTestCase[] = [];
  const forms = modules.filter((m) => m.type === "form");

  for (const form of forms) {
    for (const field of form.fields) {
      if (field.type === "checkbox" || field.type === "radio" || field.type === "select") continue;
      for (const bv of boundaryValuesFor(field)) {
        cases.push({
          category: "boundary",
          name: `${form.name} / ${field.name}: ${bv.suffix}`,
          description: `Submit "${field.name}" with ${bv.suffix}.`,
          moduleName: form.name,
          targetField: field.name,
          input: { [field.name]: bv.value },
          expectation: bv.expectation,
          testType: bv.testType,
        });
      }
    }
  }

  return cases;
}
