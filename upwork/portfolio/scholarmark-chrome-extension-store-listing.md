# ScholarMark Chrome Web Store Listing Draft

## Single Purpose

ScholarMark saves selected webpage text and source metadata into a user's ScholarMark research workspace for annotation, citation, and writing.

## Short Description

Highlight and annotate any webpage. Save to your ScholarMark research projects.

## Detailed Description

ScholarMark is a web clipper for students, researchers, and writers who need to preserve source evidence while they read online.

After connecting a ScholarMark account, select text on a webpage and choose **Save to ScholarMark** from the context menu or keyboard shortcut. The extension saves the selected passage, page URL, page title, available source metadata, surrounding context, category, and default project destination to your ScholarMark account. In ScholarMark, clips can be reviewed, organized, cited, and promoted into research projects.

The extension does not run ads, alter search results, replace the new tab page, or collect browsing content in the background. Page content is sent to ScholarMark only after a user-initiated save action.

Requires a ScholarMark account. Some web clip features may require a paid ScholarMark plan.

## Category

Productivity

## Permission Justifications

activeTab: Gives ScholarMark temporary access to the current tab only after the user chooses the save action from the context menu or keyboard shortcut.

scripting: Reads the selected text and source metadata from the active page after a user-initiated save action, then shows a short confirmation on the page.

storage: Stores the ScholarMark server URL, default project, and local extension authentication token.

contextMenus: Adds the **Save to ScholarMark** option when text is selected.

Host permission for app.scholarmark.ai: Communicates with ScholarMark for authentication, project listing, web clip creation, and extension API-key revocation.

## Remote Code Declaration

No. The extension does not execute remotely hosted code. JavaScript used by the extension is packaged with the extension.

## Data Collection Disclosure

The extension collects website content only when the user saves a clip. Data collected can include selected text, surrounding context, page URL, page title, site name, author metadata, publication date metadata, selected category, default project ID, and account identifier. The extension stores an extension-scoped ScholarMark API key locally for authenticated clip saves.

The extension uses this data to save research clips to the user's ScholarMark account. ScholarMark does not sell this data or use it for unrelated advertising.

## Privacy Policy URL

https://app.scholarmark.ai/privacy

## Support Contact

support@scholarmark.ai

## Reviewer Test Instructions

1. Install the extension package.
2. Open the popup and choose **Connect with ScholarMark**.
3. Sign in to the provided ScholarMark test account, or use the reviewer credentials supplied in the Chrome Web Store dashboard.
4. Select text on any normal webpage.
5. Right-click and choose **Save to ScholarMark**.
6. Open ScholarMark and verify the saved clip appears under Web Clips with the selected text, source URL, page title, and citation metadata.
