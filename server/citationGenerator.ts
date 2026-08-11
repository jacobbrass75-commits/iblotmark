import type { CitationData, CitationStyle } from "@shared/schema";

function formatAuthors(authors: CitationData['authors'], isFirst: boolean): string {
  if (!authors || authors.length === 0) return "";
  
  if (isFirst) {
    if (authors.length === 1) {
      const a = authors[0];
      const suffix = a.suffix ? ` ${a.suffix}` : "";
      return `${a.firstName} ${a.lastName}${suffix}`;
    }
    if (authors.length === 2) {
      return `${authors[0].firstName} ${authors[0].lastName} and ${authors[1].firstName} ${authors[1].lastName}`;
    }
    if (authors.length === 3) {
      return `${authors[0].firstName} ${authors[0].lastName}, ${authors[1].firstName} ${authors[1].lastName}, and ${authors[2].firstName} ${authors[2].lastName}`;
    }
    return `${authors[0].firstName} ${authors[0].lastName} et al.`;
  } else {
    if (authors.length === 1) {
      return authors[0].lastName;
    }
    if (authors.length <= 3) {
      return authors.map(a => a.lastName).join(", ");
    }
    return `${authors[0].lastName} et al.`;
  }
}

function formatAuthorsForBibliography(authors: CitationData['authors']): string {
  if (!authors || authors.length === 0) return "";
  
  if (authors.length === 1) {
    const a = authors[0];
    const suffix = a.suffix ? ` ${a.suffix}` : "";
    return `${a.lastName}, ${a.firstName}${suffix}`;
  }
  
  const first = authors[0];
  const suffix = first.suffix ? ` ${first.suffix}` : "";
  let result = `${first.lastName}, ${first.firstName}${suffix}`;
  
  for (let i = 1; i < authors.length; i++) {
    const a = authors[i];
    const aSuffix = a.suffix ? ` ${a.suffix}` : "";
    if (i === authors.length - 1) {
      result += `, and ${a.firstName} ${a.lastName}${aSuffix}`;
    } else {
      result += `, ${a.firstName} ${a.lastName}${aSuffix}`;
    }
  }
  
  return result;
}

function getShortTitle(title: string): string {
  const words = title.split(' ');
  if (words.length <= 4) return title;
  return words.slice(0, 4).join(' ');
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return "";
  const parts = dateStr.split('-');
  if (parts.length === 1) return parts[0];
  
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December'];
  
  const year = parts[0];
  const month = months[parseInt(parts[1], 10) - 1] || '';
  const day = parts[2] ? parseInt(parts[2], 10) : null;
  
  if (day && month) {
    return `${month} ${day}, ${year}`;
  }
  if (month) {
    return `${month} ${year}`;
  }
  return year;
}

function getYear(dateStr?: string): string {
  if (!dateStr) return "";
  return dateStr.split('-')[0];
}

export function generateChicagoFootnote(
  citation: CitationData,
  pageNumber?: string,
  isSubsequent?: boolean
): string {
  const pageRef = pageNumber ? `, ${pageNumber}` : "";
  
  if (isSubsequent) {
    const author = formatAuthors(citation.authors, false);
    const shortTitle = getShortTitle(citation.title);
    
    if (citation.sourceType === 'journal' || citation.sourceType === 'chapter' || citation.sourceType === 'newspaper') {
      return `${author}, "${shortTitle}"${pageRef}.`;
    }
    return `${author}, ${shortTitle}${pageRef}.`;
  }
  
  const author = formatAuthors(citation.authors, true);
  
  switch (citation.sourceType) {
    case 'book': {
      const title = citation.subtitle ? `${citation.title}: ${citation.subtitle}` : citation.title;
      const edition = citation.edition ? `, ${citation.edition} ed.` : "";
      const place = citation.publicationPlace || "";
      const publisher = citation.publisher || "";
      const year = getYear(citation.publicationDate);
      const pubInfo = place && publisher ? `(${place}: ${publisher}, ${year})` : `(${year})`;
      return `${author}, ${title}${edition} ${pubInfo}${pageRef}.`;
    }
    
    case 'journal': {
      const title = `"${citation.title}"`;
      const journal = citation.containerTitle || "";
      const vol = citation.volume || "";
      const issue = citation.issue ? `, no. ${citation.issue}` : "";
      const year = getYear(citation.publicationDate);
      return `${author}, ${title} ${journal} ${vol}${issue} (${year})${pageRef.replace(',', ':')}.`;
    }
    
    case 'chapter': {
      const chapterTitle = `"${citation.title}"`;
      const bookTitle = citation.containerTitle || "";
      const editors = citation.editors && citation.editors.length > 0
        ? `, edited by ${citation.editors.map(e => `${e.firstName} ${e.lastName}`).join(" and ")}`
        : "";
      const place = citation.publicationPlace || "";
      const publisher = citation.publisher || "";
      const year = getYear(citation.publicationDate);
      const pubInfo = place && publisher ? `(${place}: ${publisher}, ${year})` : `(${year})`;
      return `${author}, ${chapterTitle} in ${bookTitle}${editors} ${pubInfo}${pageRef}.`;
    }
    
    case 'website': {
      const title = `"${citation.title}"`;
      const site = citation.containerTitle || "";
      const accessed = citation.accessDate ? `accessed ${formatDate(citation.accessDate)}` : "";
      const url = citation.url || "";
      return `${title}${site ? `, ${site}` : ""}, ${accessed}, ${url}.`;
    }
    
    case 'newspaper': {
      const title = `"${citation.title}"`;
      const paper = citation.containerTitle || "";
      const date = formatDate(citation.publicationDate);
      const url = citation.url ? `, ${citation.url}` : "";
      return `${author}, ${title} ${paper}, ${date}${url}.`;
    }
    
    case 'thesis': {
      const title = `"${citation.title}"`;
      const type = "PhD diss.";
      const institution = citation.publisher || "";
      const year = getYear(citation.publicationDate);
      return `${author}, ${title} (${type}, ${institution}, ${year})${pageRef}.`;
    }
    
    default: {
      const title = citation.containerTitle ? `"${citation.title}"` : citation.title;
      const container = citation.containerTitle ? `, ${citation.containerTitle}` : "";
      const year = getYear(citation.publicationDate);
      return `${author}, ${title}${container} (${year})${pageRef}.`;
    }
  }
}

/**
 * Generate a Chicago-style footnote with an embedded quote
 * Format: Author, Title (Publication Info), page, "quoted text."
 */
export function generateFootnoteWithQuote(
  citation: CitationData,
  quote: string,
  pageNumber?: string,
  style: CitationStyle = "chicago"
): string {
  // Clean up the quote - remove excessive whitespace, ensure proper formatting
  const cleanQuote = quote.trim().replace(/\s+/g, ' ');

  // Truncate very long quotes for footnote readability (keep first ~150 chars)
  const displayQuote = cleanQuote.length > 150
    ? cleanQuote.substring(0, 147) + '...'
    : cleanQuote;
  const quoteWithPunctuation = /[.!?…]$/.test(displayQuote) ? displayQuote : `${displayQuote}.`;

  if (style !== "chicago") {
    return `"${quoteWithPunctuation}" ${generateInTextCitation(citation, style, pageNumber)}`;
  }

  // Chicago uses a full note followed by the quoted passage.
  const baseFootnote = generateChicagoFootnote(citation, pageNumber, false);
  const footnoteWithoutPeriod = baseFootnote.replace(/\.$/, "");
  return `${footnoteWithoutPeriod}: "${quoteWithPunctuation}"`;
}

/**
 * Generate a short citation for inline use
 * Format: (Author, "Short Title," page)
 */
export function generateInlineCitation(
  citation: CitationData,
  pageNumber?: string
): string {
  const author = citation.authors && citation.authors.length > 0
    ? citation.authors[0].lastName
    : "Unknown";
  const shortTitle = getShortTitle(citation.title);
  const page = pageNumber ? `, ${pageNumber}` : "";

  if (citation.sourceType === 'journal' || citation.sourceType === 'chapter' || citation.sourceType === 'newspaper') {
    return `(${author}, "${shortTitle}"${page})`;
  }
  return `(${author}, ${shortTitle}${page})`;
}

export function generateChicagoBibliography(citation: CitationData): string {
  const author = formatAuthorsForBibliography(citation.authors);
  
  switch (citation.sourceType) {
    case 'book': {
      const title = citation.subtitle ? `${citation.title}: ${citation.subtitle}` : citation.title;
      const edition = citation.edition ? ` ${citation.edition} ed.` : "";
      const place = citation.publicationPlace || "";
      const publisher = citation.publisher || "";
      const year = getYear(citation.publicationDate);
      const pubInfo = place && publisher ? `${place}: ${publisher}, ${year}` : year;
      return `${author}. ${title}.${edition} ${pubInfo}.`;
    }
    
    case 'journal': {
      const title = `"${citation.title}."`;
      const journal = citation.containerTitle || "";
      const vol = citation.volume || "";
      const issue = citation.issue ? `, no. ${citation.issue}` : "";
      const year = getYear(citation.publicationDate);
      const pages = citation.pageStart && citation.pageEnd 
        ? `: ${citation.pageStart}-${citation.pageEnd}` 
        : citation.pageStart ? `: ${citation.pageStart}` : "";
      const doi = citation.doi ? ` https://doi.org/${citation.doi}.` : "";
      return `${author}. ${title} ${journal} ${vol}${issue} (${year})${pages}.${doi}`;
    }
    
    case 'chapter': {
      const chapterTitle = `"${citation.title}."`;
      const bookTitle = citation.containerTitle || "";
      const editors = citation.editors && citation.editors.length > 0
        ? `Edited by ${citation.editors.map(e => `${e.firstName} ${e.lastName}`).join(" and ")}. `
        : "";
      const pages = citation.pageStart && citation.pageEnd 
        ? `${citation.pageStart}-${citation.pageEnd}. ` 
        : "";
      const place = citation.publicationPlace || "";
      const publisher = citation.publisher || "";
      const year = getYear(citation.publicationDate);
      const pubInfo = place && publisher ? `${place}: ${publisher}, ${year}` : year;
      return `${author}. ${chapterTitle} In ${bookTitle}. ${editors}${pages}${pubInfo}.`;
    }
    
    case 'website': {
      const title = `"${citation.title}."`;
      const site = citation.containerTitle || "";
      const accessed = citation.accessDate ? `Accessed ${formatDate(citation.accessDate)}. ` : "";
      const url = citation.url || "";
      return `${site}. ${title} ${accessed}${url}.`;
    }
    
    case 'newspaper': {
      const title = `"${citation.title}."`;
      const paper = citation.containerTitle || "";
      const date = formatDate(citation.publicationDate);
      const url = citation.url ? ` ${citation.url}` : "";
      return `${author}. ${title} ${paper}, ${date}.${url}`;
    }
    
    case 'thesis': {
      const title = `"${citation.title}."`;
      const institution = citation.publisher || "";
      const year = getYear(citation.publicationDate);
      return `${author}. ${title} PhD diss., ${institution}, ${year}.`;
    }
    
    default: {
      const title = citation.containerTitle ? `"${citation.title}."` : `${citation.title}.`;
      const container = citation.containerTitle ? ` ${citation.containerTitle}.` : "";
      const year = getYear(citation.publicationDate);
      return `${author}. ${title}${container} ${year}.`;
    }
  }
}

// === MLA 9th Edition ===

const MLA_MONTH_ABBREVS = [
  'Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June',
  'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'
];

function formatMLADate(dateStr?: string): string {
  if (!dateStr) return "";
  const parts = dateStr.split('-');
  if (parts.length === 1) return parts[0];

  const year = parts[0];
  const monthIndex = parseInt(parts[1], 10) - 1;
  const month = MLA_MONTH_ABBREVS[monthIndex] || '';
  const day = parts[2] ? parseInt(parts[2], 10) : null;

  if (day && month) {
    return `${day} ${month} ${year}`;
  }
  if (month) {
    return `${month} ${year}`;
  }
  return year;
}

function formatMLAAuthorsInText(authors: CitationData['authors']): string {
  if (!authors || authors.length === 0) return "";
  if (authors.length === 1) return authors[0].lastName;
  if (authors.length === 2) return `${authors[0].lastName} and ${authors[1].lastName}`;
  return `${authors[0].lastName} et al.`;
}

function formatMLAAuthorsWorksCited(authors: CitationData['authors']): string {
  if (!authors || authors.length === 0) return "";

  if (authors.length === 1) {
    const a = authors[0];
    const suffix = a.suffix ? ` ${a.suffix}` : "";
    return `${a.lastName}, ${a.firstName}${suffix}`;
  }

  if (authors.length === 2) {
    const first = authors[0];
    const second = authors[1];
    const suffix = first.suffix ? ` ${first.suffix}` : "";
    return `${first.lastName}, ${first.firstName}${suffix}, and ${second.firstName} ${second.lastName}`;
  }

  // 3+ authors: first author + et al.
  const first = authors[0];
  const suffix = first.suffix ? ` ${first.suffix}` : "";
  return `${first.lastName}, ${first.firstName}${suffix}, et al.`;
}

function stripUrl(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

/**
 * MLA in-text citation
 * Format: (Author PageNumber) or (Author)
 */
export function generateMLAInText(citation: CitationData, pageNumber?: string): string {
  const author = formatMLAAuthorsInText(citation.authors);
  const page = pageNumber ? ` ${pageNumber}` : "";

  if (author) {
    return `(${author}${page})`;
  }

  // No author: use shortened title
  const shortTitle = getShortTitle(citation.title);
  if (citation.sourceType === 'journal' || citation.sourceType === 'chapter' ||
      citation.sourceType === 'website' || citation.sourceType === 'newspaper') {
    return `("${shortTitle}"${page})`;
  }
  return `(${shortTitle}${page})`;
}

/**
 * MLA Works Cited entry
 * Core elements in order: Author. Title. Container, Contributors, Version,
 * Number, Publisher, Date, Location.
 */
export function generateMLAWorksCited(citation: CitationData): string {
  const author = formatMLAAuthorsWorksCited(citation.authors);

  switch (citation.sourceType) {
    case 'book': {
      const title = citation.subtitle
        ? `${citation.title}: ${citation.subtitle}`
        : citation.title;
      const edition = citation.edition ? ` ${citation.edition} ed.,` : "";
      const publisher = citation.publisher ? ` ${citation.publisher},` : "";
      const year = getYear(citation.publicationDate);
      if (author) {
        return `${author}. ${title}.${edition}${publisher} ${year}.`;
      }
      return `${title}.${edition}${publisher} ${year}.`;
    }

    case 'journal': {
      const articleTitle = `"${citation.title}."`;
      const journal = citation.containerTitle || "";
      const vol = citation.volume ? `vol. ${citation.volume}` : "";
      const issue = citation.issue ? `no. ${citation.issue}` : "";
      const year = getYear(citation.publicationDate);
      const pages = citation.pageStart && citation.pageEnd
        ? `pp. ${citation.pageStart}-${citation.pageEnd}`
        : citation.pageStart ? `p. ${citation.pageStart}` : "";

      const parts = [vol, issue, year, pages].filter(Boolean).join(", ");
      const location = citation.doi
        ? ` doi:${citation.doi}`
        : citation.url ? ` ${stripUrl(citation.url)}` : "";

      if (author) {
        return `${author}. ${articleTitle} ${journal}, ${parts}.${location ? location + "." : ""}`;
      }
      return `${articleTitle} ${journal}, ${parts}.${location ? location + "." : ""}`;
    }

    case 'chapter': {
      const chapterTitle = `"${citation.title}."`;
      const bookTitle = citation.containerTitle || "";
      const editors = citation.editors && citation.editors.length > 0
        ? `edited by ${citation.editors.map(e => `${e.firstName} ${e.lastName}`).join(" and ")}, `
        : "";
      const publisher = citation.publisher ? `${citation.publisher}, ` : "";
      const year = getYear(citation.publicationDate);
      const pages = citation.pageStart && citation.pageEnd
        ? `pp. ${citation.pageStart}-${citation.pageEnd}`
        : citation.pageStart ? `p. ${citation.pageStart}` : "";

      const parts = [editors + publisher + year, pages].filter(Boolean).join(", ");

      if (author) {
        return `${author}. ${chapterTitle} ${bookTitle}, ${parts}.`;
      }
      return `${chapterTitle} ${bookTitle}, ${parts}.`;
    }

    case 'website': {
      const title = `"${citation.title}."`;
      const site = citation.containerTitle || "";
      const publisher = citation.publisher && citation.publisher !== citation.containerTitle
        ? `${citation.publisher}, `
        : "";
      const date = formatMLADate(citation.publicationDate);
      const url = citation.url ? stripUrl(citation.url) : "";

      const datePart = date ? `${publisher}${date}` : publisher.replace(/, $/, '');
      if (author) {
        return site
          ? `${author}. ${title} ${site}, ${datePart}${datePart ? ", " : ""}${url}.`
          : `${author}. ${title} ${datePart}${datePart ? ", " : ""}${url}.`;
      }
      return site
        ? `${title} ${site}, ${datePart}${datePart ? ", " : ""}${url}.`
        : `${title} ${datePart}${datePart ? ", " : ""}${url}.`;
    }

    case 'newspaper': {
      const title = `"${citation.title}."`;
      const paper = citation.containerTitle || "";
      const date = formatMLADate(citation.publicationDate);
      const pages = citation.pageStart && citation.pageEnd
        ? `, pp. ${citation.pageStart}-${citation.pageEnd}`
        : citation.pageStart ? `, p. ${citation.pageStart}` : "";
      const url = citation.url ? ` ${stripUrl(citation.url)}` : "";

      if (author) {
        return `${author}. ${title} ${paper}, ${date}${pages}.${url ? url + "." : ""}`;
      }
      return `${title} ${paper}, ${date}${pages}.${url ? url + "." : ""}`;
    }

    case 'thesis': {
      const title = citation.title;
      const institution = citation.publisher || "";
      const year = getYear(citation.publicationDate);
      if (author) {
        return `${author}. ${title}. ${institution}, ${year}.`;
      }
      return `${title}. ${institution}, ${year}.`;
    }

    default: {
      const title = citation.containerTitle ? `"${citation.title}."` : `${citation.title}.`;
      const container = citation.containerTitle ? ` ${citation.containerTitle},` : "";
      const year = getYear(citation.publicationDate);
      if (author) {
        return `${author}. ${title}${container} ${year}.`;
      }
      return `${title}${container} ${year}.`;
    }
  }
}

// === APA 7th Edition ===

function getInitials(firstName: string): string {
  if (!firstName) return "";
  return firstName
    .split(/[\s-]+/)
    .map(part => part.charAt(0).toUpperCase() + ".")
    .join(" ");
}

function formatAPAAuthorsInText(authors: CitationData['authors']): string {
  if (!authors || authors.length === 0) return "";
  if (authors.length === 1) return authors[0].lastName;
  if (authors.length === 2) return `${authors[0].lastName} & ${authors[1].lastName}`;
  return `${authors[0].lastName} et al.`;
}

function formatAPAAuthorsReference(authors: CitationData['authors']): string {
  if (!authors || authors.length === 0) return "";

  if (authors.length === 1) {
    const a = authors[0];
    const suffix = a.suffix ? ` ${a.suffix}` : "";
    return `${a.lastName}, ${getInitials(a.firstName)}${suffix}`;
  }

  // Up to 20 authors: list all with & before last
  if (authors.length <= 20) {
    const formatted = authors.map(a => {
      const suffix = a.suffix ? ` ${a.suffix}` : "";
      return `${a.lastName}, ${getInitials(a.firstName)}${suffix}`;
    });
    if (formatted.length === 2) {
      return `${formatted[0]}, & ${formatted[1]}`;
    }
    const allButLast = formatted.slice(0, -1).join(", ");
    return `${allButLast}, & ${formatted[formatted.length - 1]}`;
  }

  // 21+ authors: first 19, ..., last
  const first19 = authors.slice(0, 19).map(a => {
    const suffix = a.suffix ? ` ${a.suffix}` : "";
    return `${a.lastName}, ${getInitials(a.firstName)}${suffix}`;
  });
  const last = authors[authors.length - 1];
  const lastSuffix = last.suffix ? ` ${last.suffix}` : "";
  return `${first19.join(", ")}, . . . ${last.lastName}, ${getInitials(last.firstName)}${lastSuffix}`;
}

function formatAPADate(dateStr?: string): string {
  if (!dateStr) return "n.d.";
  const parts = dateStr.split('-');
  if (parts.length === 1) return parts[0];

  const months = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December'];

  const year = parts[0];
  const monthIndex = parseInt(parts[1], 10) - 1;
  const month = months[monthIndex] || '';
  const day = parts[2] ? parseInt(parts[2], 10) : null;

  if (day && month) {
    return `${year}, ${month} ${day}`;
  }
  if (month) {
    return `${year}, ${month}`;
  }
  return year;
}

function toSentenceCase(title: string): string {
  if (!title) return "";
  // Capitalize first character, lowercase the rest (preserving after colons)
  return title.replace(/^(.)/, (m) => m.toUpperCase())
    .replace(/: (.)/g, (_m, c: string) => `: ${c.toUpperCase()}`);
}

/**
 * APA in-text citation
 * Format: (Author, Year) or (Author, Year, p. X)
 */
export function generateAPAInText(citation: CitationData, pageNumber?: string): string {
  const author = formatAPAAuthorsInText(citation.authors);
  const year = getYear(citation.publicationDate) || "n.d.";
  const page = pageNumber ? `, p. ${pageNumber}` : "";

  if (author) {
    return `(${author}, ${year}${page})`;
  }

  // No author: use shortened title
  const shortTitle = getShortTitle(citation.title);
  if (citation.sourceType === 'journal' || citation.sourceType === 'chapter' ||
      citation.sourceType === 'website' || citation.sourceType === 'newspaper') {
    return `("${shortTitle}," ${year}${page})`;
  }
  return `(${shortTitle}, ${year}${page})`;
}

/**
 * APA Reference List entry
 * Format: Author, A. A. (Year). Title. Source. DOI/URL
 */
export function generateAPAReference(citation: CitationData): string {
  const author = formatAPAAuthorsReference(citation.authors);

  switch (citation.sourceType) {
    case 'book': {
      const year = getYear(citation.publicationDate) || "n.d.";
      const title = citation.subtitle
        ? `${toSentenceCase(citation.title)}: ${toSentenceCase(citation.subtitle)}`
        : toSentenceCase(citation.title);
      const edition = citation.edition ? ` (${citation.edition} ed.)` : "";
      const publisher = citation.publisher ? ` ${citation.publisher}.` : "";
      const doi = citation.doi ? ` https://doi.org/${citation.doi}` : "";
      const url = !citation.doi && citation.url ? ` ${citation.url}` : "";

      if (author) {
        return `${author} (${year}). ${title}${edition}.${publisher}${doi}${url}`;
      }
      return `${title}${edition}. (${year}).${publisher}${doi}${url}`;
    }

    case 'journal': {
      const year = getYear(citation.publicationDate) || "n.d.";
      const title = toSentenceCase(citation.title);
      const journal = citation.containerTitle || "";
      const vol = citation.volume || "";
      const issue = citation.issue ? `(${citation.issue})` : "";
      const pages = citation.pageStart && citation.pageEnd
        ? `, ${citation.pageStart}-${citation.pageEnd}`
        : citation.pageStart ? `, ${citation.pageStart}` : "";
      const doi = citation.doi ? ` https://doi.org/${citation.doi}` : "";
      const url = !citation.doi && citation.url ? ` ${citation.url}` : "";

      if (author) {
        return `${author} (${year}). ${title}. ${journal}, ${vol}${issue}${pages}.${doi}${url}`;
      }
      return `${title}. (${year}). ${journal}, ${vol}${issue}${pages}.${doi}${url}`;
    }

    case 'chapter': {
      const year = getYear(citation.publicationDate) || "n.d.";
      const title = toSentenceCase(citation.title);
      const bookTitle = citation.containerTitle ? toSentenceCase(citation.containerTitle) : "";
      const editors = citation.editors && citation.editors.length > 0
        ? `In ${citation.editors.map(e => `${getInitials(e.firstName)} ${e.lastName}`).join(" & ")} (${citation.editors.length === 1 ? "Ed." : "Eds."}), `
        : "In ";
      const pages = citation.pageStart && citation.pageEnd
        ? ` (pp. ${citation.pageStart}-${citation.pageEnd})`
        : citation.pageStart ? ` (p. ${citation.pageStart})` : "";
      const publisher = citation.publisher ? `. ${citation.publisher}.` : ".";
      const doi = citation.doi ? ` https://doi.org/${citation.doi}` : "";

      if (author) {
        return `${author} (${year}). ${title}. ${editors}${bookTitle}${pages}${publisher}${doi}`;
      }
      return `${title}. (${year}). ${editors}${bookTitle}${pages}${publisher}${doi}`;
    }

    case 'website': {
      const date = formatAPADate(citation.publicationDate);
      const title = toSentenceCase(citation.title);
      const site = citation.containerTitle || "";
      const url = citation.url ? ` ${citation.url}` : "";

      if (author) {
        return site
          ? `${author} (${date}). ${title}. ${site}.${url}`
          : `${author} (${date}). ${title}.${url}`;
      }
      return site
        ? `${title}. (${date}). ${site}.${url}`
        : `${title}. (${date}).${url}`;
    }

    case 'newspaper': {
      const date = formatAPADate(citation.publicationDate);
      const title = toSentenceCase(citation.title);
      const paper = citation.containerTitle || "";
      const pages = citation.pageStart && citation.pageEnd
        ? `, ${citation.pageStart}-${citation.pageEnd}`
        : citation.pageStart ? `, ${citation.pageStart}` : "";
      const url = citation.url ? ` ${citation.url}` : "";

      if (author) {
        return `${author} (${date}). ${title}. ${paper}${pages}.${url}`;
      }
      return `${title}. (${date}). ${paper}${pages}.${url}`;
    }

    case 'thesis': {
      const year = getYear(citation.publicationDate) || "n.d.";
      const title = toSentenceCase(citation.title);
      const institution = citation.publisher || "";
      const url = citation.url ? ` ${citation.url}` : "";

      if (author) {
        return `${author} (${year}). ${title} [Doctoral dissertation, ${institution}].${url}`;
      }
      return `${title}. (${year}). [Doctoral dissertation, ${institution}].${url}`;
    }

    default: {
      const year = getYear(citation.publicationDate) || "n.d.";
      const title = citation.containerTitle
        ? toSentenceCase(citation.title)
        : toSentenceCase(citation.title);
      const container = citation.containerTitle ? ` ${citation.containerTitle}.` : "";
      const doi = citation.doi ? ` https://doi.org/${citation.doi}` : "";
      const url = !citation.doi && citation.url ? ` ${citation.url}` : "";

      if (author) {
        return `${author} (${year}). ${title}.${container}${doi}${url}`;
      }
      return `${title}. (${year}).${container}${doi}${url}`;
    }
  }
}

// === Unified Citation Interface ===

/**
 * Unified interface for generating in-text citations in any style
 */
export function generateInTextCitation(
  citation: CitationData,
  style: CitationStyle,
  pageNumber?: string
): string {
  switch (style) {
    case "mla": return generateMLAInText(citation, pageNumber);
    case "apa": return generateAPAInText(citation, pageNumber);
    case "chicago": return generateInlineCitation(citation, pageNumber);
  }
}

/**
 * Unified interface for generating bibliography/reference entries in any style
 */
export function generateBibliographyEntry(
  citation: CitationData,
  style: CitationStyle
): string {
  switch (style) {
    case "mla": return generateMLAWorksCited(citation);
    case "apa": return generateAPAReference(citation);
    case "chicago": return generateChicagoBibliography(citation);
  }
}

/**
 * Unified interface for generating footnotes in any style.
 * Only Chicago uses footnotes. MLA and APA use in-text citations instead.
 */
export function generateFootnote(
  citation: CitationData,
  style: CitationStyle,
  pageNumber?: string,
  isSubsequent?: boolean
): string {
  if (style === "chicago") {
    return generateChicagoFootnote(citation, pageNumber, isSubsequent);
  }
  // For MLA/APA, return in-text citation as they don't use footnotes
  return generateInTextCitation(citation, style, pageNumber);
}
