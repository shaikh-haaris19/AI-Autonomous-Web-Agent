import { describe, expect, it } from "vitest";
import { sanitizeExtractedText, selectRelevantText } from "./webTools";
import { fallbackSynthesis, isReaderSafeSynthesis } from "./workflow";
import type { ResearchRunSnapshot } from "@shared/agent";

describe("research content quality", () => {
  const task = "What is the best laptop under 60k INR for AIML students?";
  const rawPage = `
    Home Mobiles Laptops Gaming Electronics News Reviews Login Signup Contact Us
    Best Laptops Under Rs 60,000 in India
    The Lenovo IdeaPad Slim 5 has a Ryzen 7 processor, 16GB RAM and 512GB SSD. It is priced near ₹58,000 and is a strong option for machine-learning students who need memory for local development.
    Samsung Galaxy Z Fold 8 Redmi Note 17 Latest mobiles Upcoming mobiles
    The Acer Aspire 7 includes a dedicated GPU but costs ₹62,000 in this configuration, above the stated budget.
    Advertise Privacy Terms About Us Contact Us
  `;

  it("removes navigation boilerplate before the content is used", () => {
    const cleaned = sanitizeExtractedText(rawPage);
    expect(cleaned.text).not.toContain("Login Signup");
    expect(cleaned.text).not.toContain("Advertise Privacy");
    expect(cleaned.text).toContain("Lenovo IdeaPad Slim 5");
  });

  it("keeps query-relevant product passages and rejects unrelated metadata", () => {
    const focused = selectRelevantText(sanitizeExtractedText(rawPage).text, task);
    expect(focused).toContain("Lenovo IdeaPad Slim 5");
    expect(focused).toContain("Acer Aspire 7");
    expect(focused).not.toContain("Samsung Galaxy Z Fold 8");
  });

  it("never turns raw scraped evidence into the visible fallback answer", () => {
    const run = { evidence: [{ claim: "Home Mobiles Laptops Gaming", excerpt: rawPage }] } as unknown as ResearchRunSnapshot;
    const result = fallbackSynthesis(run);
    expect(result.answer).not.toContain("Mobiles Laptops Gaming");
    expect(result.conclusion).toContain("No dependable recommendation");
  });

  it("rejects model output that repeats source navigation or website metadata", () => {
    expect(isReaderSafeSynthesis({
      answer: "Largest Gadget Discovery Site in India. Login/Signup. Latest mobiles and upcoming mobiles.",
      conclusion: "Home > Gadgets",
    })).toBe(false);
    expect(isReaderSafeSynthesis({
      answer: "For an AIML student under ₹60,000, prioritize 16GB RAM, a recent processor and a 512GB SSD.",
      conclusion: "Choose the option that meets those specifications within budget.",
    })).toBe(true);
  });
});
