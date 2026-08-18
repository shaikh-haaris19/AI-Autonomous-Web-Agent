import { describe, expect, it } from "vitest";
import { extractReadableTextFromHtml } from "./webTools";

describe("readable page extraction", () => {
  it("keeps substantive headings and paragraphs while dropping navigation noise", () => {
    const html = `
      <html>
        <head><title>Example policy</title><style>.hidden { display: none; }</style></head>
        <body>
          <header>Website name and global navigation</header>
          <nav>Home About Contact Sign in</nav>
          <main>
            <h1>Residential energy policy</h1>
            <p>The program provides a rebate for eligible households that install qualifying equipment before the stated deadline.</p>
            <p>Applicants must submit the required documentation and meet the income and property criteria described by the agency.</p>
          </main>
          <footer>Copyright and privacy links</footer>
        </body>
      </html>`;

    const text = extractReadableTextFromHtml(html);
    expect(text).toContain("The program provides a rebate for eligible households");
    expect(text).toContain("Applicants must submit the required documentation");
    expect(text).not.toContain("global navigation");
    expect(text).not.toContain("Copyright and privacy links");
  });
});
