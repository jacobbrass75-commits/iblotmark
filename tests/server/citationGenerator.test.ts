import type { CitationData } from "../../shared/schema";
import {
  generateChicagoBibliography,
  generateChicagoFootnote,
  generateFootnoteWithQuote,
  generateInlineCitation,
} from "../../server/citationGenerator";

const bookCitation: CitationData = {
  sourceType: "book",
  authors: [{ firstName: "John", lastName: "Doe" }],
  title: "History of Things",
  publicationPlace: "New York",
  publisher: "Acme Press",
  publicationDate: "2024-05-01",
};

const journalCitation: CitationData = {
  sourceType: "journal",
  authors: [{ firstName: "Jane", lastName: "Smith" }],
  title: "Archival Patterns in Modern Research",
  containerTitle: "Journal of Research Systems",
  volume: "12",
  issue: "3",
  pageStart: "101",
  pageEnd: "119",
  publicationDate: "2023-01-15",
  doi: "10.1234/example",
};

describe("citation generator", () => {
  it("formats full and subsequent Chicago book footnotes", () => {
    expect(generateChicagoFootnote(bookCitation, "42")).toBe(
      "John Doe, History of Things (New York: Acme Press, 2024), 42."
    );
    expect(generateChicagoFootnote(bookCitation, "42", true)).toBe("Doe, History of Things, 42.");
  });

  it("formats inline citations and bibliography entries", () => {
    expect(generateInlineCitation(bookCitation, "42")).toBe("(Doe, History of Things, 42)");
    expect(generateChicagoBibliography(bookCitation)).toBe(
      "Doe, John. History of Things. New York: Acme Press, 2024."
    );
  });

  it("formats journal bibliography entries with issue, pages, and DOI", () => {
    expect(generateChicagoBibliography(journalCitation)).toBe(
      'Smith, Jane. "Archival Patterns in Modern Research." Journal of Research Systems 12, no. 3 (2023): 101-119. https://doi.org/10.1234/example.'
    );
  });

  it("embeds quotes in footnotes and truncates very long quotes", () => {
    const longQuote = "A".repeat(180);
    const result = generateFootnoteWithQuote(bookCitation, longQuote, "55");

    expect(result).toContain(': "');
    expect(result).toContain("...");
    expect(result.startsWith("John Doe, History of Things")).toBe(true);
    expect(result.length).toBeLessThan(260);
  });

  it("formats quoted evidence using the requested citation style", () => {
    expect(generateFootnoteWithQuote(bookCitation, "A concise finding", "42", "mla")).toBe(
      '"A concise finding." (Doe 42)'
    );
    expect(generateFootnoteWithQuote(bookCitation, "A concise finding.", "42", "apa")).toBe(
      '"A concise finding." (Doe, 2024, p. 42)'
    );
  });
});
